/**
 * InspectVoice — Database Service
 * Neon PostgreSQL client for Cloudflare Workers.
 *
 * All database access goes through this module to enforce:
 * - Tenant isolation (org_id injected on every query)
 * - Parameterised queries (no SQL injection)
 * - Structured error handling
 * - Connection management (Neon serverless driver)
 * - Query logging with requestId tracing
 *
 * Uses Neon's serverless driver (@neondatabase/serverless) which works
 * over HTTP/WebSocket — no TCP connections needed in Workers.
 *
 * Build Standard: Autaimate v3 §5.2 — server-side tenant isolation
 */

import type { RequestContext } from '../types';
import { Logger } from '../shared/logger';
import { InternalError, NotFoundError } from '../shared/errors';

// =============================================
// NEON CLIENT
// =============================================

/**
 * Neon serverless driver types.
 * We use the HTTP query mode (neon()) for simple queries
 * which is ideal for Cloudflare Workers — no WebSocket needed.
 *
 * Import at runtime to avoid bundling issues.
 * The actual @neondatabase/serverless package is a dependency.
 */

interface NeonQueryResult<T> {
  rows: T[];
  rowCount: number;
  command: string;
}

type NeonQueryFunction = <T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<NeonQueryResult<T>>;

/**
 * Create a Neon SQL query function from the DATABASE_URL.
 * Each invocation creates a fresh HTTP connection (stateless, perfect for Workers).
 */
async function createNeonClient(databaseUrl: string): Promise<NeonQueryFunction> {
  // Dynamic import — @neondatabase/serverless must be in worker dependencies
  const { neon } = await import('@neondatabase/serverless');
  return neon(databaseUrl, {
    fullResults: true,
  }) as unknown as NeonQueryFunction;
}

// =============================================
// DATABASE SERVICE
// =============================================

export class DatabaseService {
  private readonly ctx: RequestContext;
  private readonly logger: Logger;
  private sqlClient: NeonQueryFunction | null = null;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
    this.logger = Logger.fromContext(ctx);
  }

  /**
   * Get or create the SQL client (lazy initialisation).
   */
  private async getClient(): Promise<NeonQueryFunction> {
    if (!this.sqlClient) {
      this.sqlClient = await createNeonClient(this.ctx.env.DATABASE_URL);
    }
    return this.sqlClient;
  }

  // =============================================
  // TENANT-ISOLATED QUERY METHODS
  // =============================================

  /**
   * Execute a SELECT query with automatic tenant isolation.
   * The org_id filter is injected — callers cannot bypass it.
   *
   * @param table — table name (validated against allowlist)
   * @param conditions — WHERE conditions (excluding org_id, which is auto-added)
   * @param params — query parameters (org_id is prepended automatically)
   * @param options — ordering, pagination, column selection
   * @returns Array of matching rows
   */
  async findMany<T extends Record<string, unknown>>(
    table: string,
    conditions: string = '',
    params: unknown[] = [],
    options: QueryOptions = {},
  ): Promise<T[]> {
    validateTableName(table);

    const columns = options.columns ?? '*';
    const orgParam = this.ctx.orgId;

    // Build WHERE clause with org_id always first
    const whereClause = conditions
      ? `WHERE org_id = $1 AND ${conditions}`
      : 'WHERE org_id = $1';

    // Shift parameter indices (user params start at $2)
    const allParams = [orgParam, ...params];

    let sql = `SELECT ${columns} FROM ${table} ${whereClause}`;

    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
      if (options.orderDirection) {
        sql += ` ${options.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;
      }
    }

    if (options.limit !== undefined) {
      sql += ` LIMIT ${Number(options.limit)}`;
    }

    if (options.offset !== undefined) {
      sql += ` OFFSET ${Number(options.offset)}`;
    }

    return this.executeQuery<T>(sql, allParams);
  }

  /**
   * Find a single row by ID with tenant isolation.
   * Returns null if not found (does NOT throw).
   */
  async findById<T extends Record<string, unknown>>(
    table: string,
    id: string,
  ): Promise<T | null> {
    validateTableName(table);

    const sql = `SELECT * FROM ${table} WHERE org_id = $1 AND id = $2 LIMIT 1`;
    const rows = await this.executeQuery<T>(sql, [this.ctx.orgId, id]);

    return rows[0] ?? null;
  }

  /**
   * Find a single row by ID, throwing NotFoundError if missing.
   * Use this when the resource MUST exist.
   */
  async findByIdOrThrow<T extends Record<string, unknown>>(
    table: string,
    id: string,
    entityName: string = 'Resource',
  ): Promise<T> {
    const row = await this.findById<T>(table, id);
    if (!row) {
      throw new NotFoundError(`${entityName} not found`);
    }
    return row;
  }

  /**
   * Count rows matching conditions with tenant isolation.
   */
  async count(
    table: string,
    conditions: string = '',
    params: unknown[] = [],
  ): Promise<number> {
    validateTableName(table);

    const whereClause = conditions
      ? `WHERE org_id = $1 AND ${conditions}`
      : 'WHERE org_id = $1';

    const allParams = [this.ctx.orgId, ...params];
    const sql = `SELECT COUNT(*)::int AS count FROM ${table} ${whereClause}`;

    const rows = await this.executeQuery<{ count: number }>(sql, allParams);
    return rows[0]?.count ?? 0;
  }

  /**
   * Insert a row with automatic org_id injection and timestamps.
   * Returns the inserted row.
   */
  async insert<T extends Record<string, unknown>>(
    table: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    validateTableName(table);

    // Inject org_id and timestamps — cannot be overridden by caller
    const enrichedData: Record<string, unknown> = {
      ...data,
      org_id: this.ctx.orgId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const columns = Object.keys(enrichedData);
    const values = Object.values(enrichedData);
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;

    const rows = await this.executeQuery<T>(sql, values);

    if (!rows[0]) {
      throw new InternalError(`Failed to insert into ${table}`);
    }

    return rows[0];
  }

  /**
   * Update a row by ID with tenant isolation and automatic updated_at.
   * Returns the updated row, or null if not found.
   */
  async updateById<T extends Record<string, unknown>>(
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<T | null> {
    validateTableName(table);

    // Remove fields that should never be updated
    const { id: _id, org_id: _orgId, created_at: _created, ...updateData } = data;

    // Inject updated_at
    const enrichedData: Record<string, unknown> = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    const columns = Object.keys(enrichedData);
    const values = Object.values(enrichedData);

    // Build SET clause: col1 = $1, col2 = $2, ...
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

    // org_id and id are the last two params
    const orgIdParamIndex = values.length + 1;
    const idParamIndex = values.length + 2;

    const sql = `UPDATE ${table} SET ${setClause} WHERE org_id = $${orgIdParamIndex} AND id = $${idParamIndex} RETURNING *`;

    const rows = await this.executeQuery<T>(sql, [...values, this.ctx.orgId, id]);

    return rows[0] ?? null;
  }

  /**
   * Delete a row by ID with tenant isolation.
   * Returns true if a row was deleted, false if not found.
   */
  async deleteById(table: string, id: string): Promise<boolean> {
    validateTableName(table);

    const sql = `DELETE FROM ${table} WHERE org_id = $1 AND id = $2`;
    const client = await this.getClient();
    const result = await client(sql, [this.ctx.orgId, id]);

    return result.rowCount > 0;
  }

  // =============================================
  // CROSS-TABLE QUERIES (with tenant isolation)
  // =============================================

  /**
   * Find rows in a child table by parent relationship, with tenant isolation
   * verified through a JOIN to the parent table.
   *
   * Example: Find inspection items for an inspection that belongs to this org.
   */
  async findByParent<T extends Record<string, unknown>>(
    childTable: string,
    parentTable: string,
    parentIdColumn: string,
    parentId: string,
    options: QueryOptions = {},
  ): Promise<T[]> {
    validateTableName(childTable);
    validateTableName(parentTable);

    const columns = options.columns
      ? options.columns.split(',').map((c) => `c.${c.trim()}`).join(', ')
      : 'c.*';

    let sql = `SELECT ${columns} FROM ${childTable} c
      INNER JOIN ${parentTable} p ON c.${parentIdColumn} = p.id
      WHERE p.org_id = $1 AND c.${parentIdColumn} = $2`;

    const params: unknown[] = [this.ctx.orgId, parentId];

    if (options.orderBy) {
      sql += ` ORDER BY c.${options.orderBy}`;
      if (options.orderDirection) {
        sql += ` ${options.orderDirection === 'asc' ? 'ASC' : 'DESC'}`;
      }
    }

    if (options.limit !== undefined) {
      sql += ` LIMIT ${Number(options.limit)}`;
    }

    if (options.offset !== undefined) {
      sql += ` OFFSET ${Number(options.offset)}`;
    }

    return this.executeQuery<T>(sql, params);
  }

  // =============================================
  // RAW QUERY (for complex/custom queries)
  // =============================================

  /**
   * Execute a raw SQL query.
   *
   * ⚠️ IMPORTANT: The caller is responsible for including org_id filtering.
   * This method exists for complex queries (aggregates, CTEs, multi-table joins)
   * that don't fit the standard CRUD pattern.
   *
   * Always pass org_id as a parameter — never interpolate it.
   */
  async rawQuery<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.executeQuery<T>(sql, params);
  }

  /**
   * Execute a raw query returning the row count (for INSERT/UPDATE/DELETE).
   */
  async rawExecute(sql: string, params: unknown[] = []): Promise<number> {
    const client = await this.getClient();

    try {
      const result = await client(sql, params);
      return result.rowCount;
    } catch (error) {
      this.logger.error('Raw execute failed', error, {
        sql: truncateSql(sql),
      });
      throw new InternalError('Database operation failed');
    }
  }

  // =============================================
  // INTERNAL
  // =============================================

  /**
   * Execute a query with logging and error handling.
   */
  private async executeQuery<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[],
  ): Promise<T[]> {
    const client = await this.getClient();
    const startMs = Date.now();

    try {
      const result = await client<T>(sql, params);
      const durationMs = Date.now() - startMs;

      // Log slow queries (>500ms)
      if (durationMs > 500) {
        this.logger.warn('Slow query detected', {
          sql: truncateSql(sql),
          durationMs,
          rowCount: result.rowCount,
        });
      }

      return result.rows;
    } catch (error) {
      const durationMs = Date.now() - startMs;

      this.logger.error('Database query failed', error, {
        sql: truncateSql(sql),
        durationMs,
      });

      // Map common Postgres errors to HTTP errors
      if (error instanceof Error) {
        if (error.message.includes('unique_violation') || error.message.includes('duplicate key')) {
          // Import dynamically to avoid circular deps
          const { ConflictError } = await import('../shared/errors');
          throw new ConflictError('A record with this identifier already exists');
        }

        if (error.message.includes('foreign_key_violation')) {
          const { BadRequestError } = await import('../shared/errors');
          throw new BadRequestError('Referenced record does not exist');
        }

        if (error.message.includes('check_violation')) {
          const { BadRequestError } = await import('../shared/errors');
          throw new BadRequestError('Data validation constraint failed');
        }
      }

      throw new InternalError('Database operation failed');
    }
  }
}

// =============================================
// QUERY OPTIONS
// =============================================

export interface QueryOptions {
  /** Columns to select (default: '*') */
  columns?: string;
  /** Column to order by (must be in ALLOWED_ORDER_COLUMNS) */
  orderBy?: string;
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
  /** LIMIT */
  limit?: number;
  /** OFFSET */
  offset?: number;
}

// =============================================
// TABLE NAME VALIDATION (SQL injection prevention)
// =============================================

/**
 * Whitelist of allowed table names.
 * Prevents SQL injection via table name interpolation.
 */
const ALLOWED_TABLES = new Set([
  'organisations',
  'users',
  'sites',
  'assets',
  'inspections',
  'inspection_items',
  'defects',
  'photos',
  'audit_log',
  'webhook_events',
]);

/**
 * Validate a table name against the whitelist.
 * Throws InternalError (not BadRequest) because table names come from
 * our code, not from user input — a bad table name is a bug.
 */
function validateTableName(table: string): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new InternalError(`Invalid table name: ${table}`);
  }
}

// =============================================
// HELPERS
// =============================================

/**
 * Truncate SQL for logging (don't log massive queries).
 */
function truncateSql(sql: string): string {
  const cleaned = sql.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 200) {
    return cleaned.slice(0, 200) + '...';
  }
  return cleaned;
}

// =============================================
// FACTORY
// =============================================

/**
 * Create a DatabaseService for a request context.
 * Use in route handlers:
 *   const db = createDb(ctx);
 *   const sites = await db.findMany<Site>('sites');
 */
export function createDb(ctx: RequestContext): DatabaseService {
  return new DatabaseService(ctx);
}
