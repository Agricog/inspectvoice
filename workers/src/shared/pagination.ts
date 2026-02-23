/**
 * InspectVoice — Pagination Helpers
 * Server-side pagination for all list endpoints.
 *
 * Enforces:
 * - MAX_PAGE_SIZE from env bindings (Build Standard v3 §5.5)
 * - Default page size of 20
 * - Minimum page of 1
 * - Standardised meta response shape for frontend consumption
 *
 * Usage in route handlers:
 *   const pagination = parsePagination(request, ctx.env);
 *   const { rows, totalCount } = await db.listSites(ctx.orgId, pagination);
 *   return jsonResponse({ data: rows, meta: buildPaginationMeta(pagination, totalCount) });
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env, PaginationInput, ApiResponseMeta } from '../types';

// =============================================
// DEFAULTS
// =============================================

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const FALLBACK_MAX_PAGE_SIZE = 100;

// =============================================
// PARSE PAGINATION FROM REQUEST
// =============================================

/**
 * Extract and validate pagination parameters from the URL query string.
 * Enforces MAX_PAGE_SIZE from environment bindings.
 *
 * @param request — incoming Request (reads ?page= and ?pageSize= from URL)
 * @param env — Cloudflare env bindings (reads MAX_PAGE_SIZE)
 * @returns Validated PaginationInput
 */
export function parsePagination(request: Request, env: Env): PaginationInput {
  const url = new URL(request.url);

  const maxPageSize = parsePositiveInt(env.MAX_PAGE_SIZE, FALLBACK_MAX_PAGE_SIZE);

  // Parse page number
  let page = parsePositiveInt(url.searchParams.get('page'), DEFAULT_PAGE);
  if (page < 1) page = 1;

  // Parse page size
  let pageSize = parsePositiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);
  if (pageSize < 1) pageSize = 1;
  if (pageSize > maxPageSize) pageSize = maxPageSize;

  return { page, pageSize };
}

// =============================================
// BUILD PAGINATION META
// =============================================

/**
 * Build the standardised pagination metadata for API responses.
 *
 * @param pagination — validated pagination input
 * @param totalCount — total number of records matching the query (before pagination)
 * @returns ApiResponseMeta for the response envelope
 */
export function buildPaginationMeta(
  pagination: PaginationInput,
  totalCount: number,
): ApiResponseMeta {
  const totalPages = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalCount,
    totalPages,
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1,
  };
}

// =============================================
// SQL OFFSET/LIMIT HELPERS
// =============================================

/**
 * Calculate SQL OFFSET from pagination input.
 * Use in queries: `LIMIT $1 OFFSET $2`
 */
export function paginationToOffset(pagination: PaginationInput): {
  limit: number;
  offset: number;
} {
  return {
    limit: pagination.pageSize,
    offset: (pagination.page - 1) * pagination.pageSize,
  };
}

// =============================================
// SORT/FILTER HELPERS
// =============================================

/** Allowed sort directions */
export type SortDirection = 'asc' | 'desc';

/**
 * Parse and validate a sort direction from query string.
 * Defaults to 'desc' (newest first) if not specified or invalid.
 */
export function parseSortDirection(request: Request, defaultDir: SortDirection = 'desc'): SortDirection {
  const url = new URL(request.url);
  const raw = url.searchParams.get('sortDirection');

  if (raw === 'asc' || raw === 'desc') return raw;
  return defaultDir;
}

/**
 * Parse a sort field from query string, validating against allowed columns.
 * Prevents SQL injection by only allowing known column names.
 *
 * @param request — incoming request
 * @param allowedColumns — whitelist of column names the client can sort by
 * @param defaultColumn — fallback column if not specified or invalid
 * @returns Safe column name for use in SQL ORDER BY
 */
export function parseSortField(
  request: Request,
  allowedColumns: readonly string[],
  defaultColumn: string,
): string {
  const url = new URL(request.url);
  const raw = url.searchParams.get('sortBy');

  if (raw && allowedColumns.includes(raw)) return raw;
  return defaultColumn;
}

/**
 * Parse a filter value from query string.
 * Returns null if not present — the route handler decides what to do with it.
 */
export function parseFilterParam(request: Request, paramName: string): string | null {
  const url = new URL(request.url);
  const value = url.searchParams.get(paramName);
  return value?.trim() || null;
}

/**
 * Parse a search query from query string.
 * Sanitises for use in SQL ILIKE patterns.
 */
export function parseSearchQuery(request: Request, paramName: string = 'q'): string | null {
  const url = new URL(request.url);
  const raw = url.searchParams.get(paramName);

  if (!raw || raw.trim().length === 0) return null;

  // Sanitise for SQL LIKE — escape special characters
  const sanitised = raw.trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');

  // Cap search query length
  if (sanitised.length > 200) return sanitised.slice(0, 200);

  return sanitised;
}

// =============================================
// INTERNAL HELPERS
// =============================================

/**
 * Parse a string to a positive integer, returning defaultValue on failure.
 */
function parsePositiveInt(value: string | null | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return defaultValue;
  return parsed;
}
