/**
 * InspectVoice — Server-Side Validation
 * Input validation for all API endpoints.
 *
 * Mirrors the frontend validation patterns but enforced server-side
 * because the frontend is untrusted (Build Standard v3 §0).
 *
 * Every route handler calls these before touching the database.
 * Validation failures throw BadRequestError with descriptive messages.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { BadRequestError } from './errors';

// =============================================
// UUID VALIDATION
// =============================================

/** UUID v4 pattern */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate a string is a valid UUID v4 */
export function validateUUID(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new BadRequestError(`${fieldName} must be a valid UUID`);
  }
  return value;
}

/** Validate an optional UUID — returns undefined if not present */
export function validateOptionalUUID(value: unknown, fieldName: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return validateUUID(value, fieldName);
}

// =============================================
// STRING VALIDATION
// =============================================

/** Validate a required string field with min/max length */
export function validateString(
  value: unknown,
  fieldName: string,
  opts: { minLength?: number; maxLength?: number } = {},
): string {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  const minLen = opts.minLength ?? 1;
  const maxLen = opts.maxLength ?? 10_000;

  if (trimmed.length < minLen) {
    throw new BadRequestError(`${fieldName} must be at least ${minLen} characters`);
  }

  if (trimmed.length > maxLen) {
    throw new BadRequestError(`${fieldName} must be at most ${maxLen} characters`);
  }

  return trimmed;
}

/** Validate an optional string field */
export function validateOptionalString(
  value: unknown,
  fieldName: string,
  opts: { maxLength?: number } = {},
): string | null {
  if (value === null || value === undefined || value === '') return null;
  return validateString(value, fieldName, { minLength: 0, ...opts });
}

// =============================================
// NUMBER VALIDATION
// =============================================

/** Validate a required number field */
export function validateNumber(
  value: unknown,
  fieldName: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const num = typeof value === 'string' ? Number(value) : value;

  if (typeof num !== 'number' || Number.isNaN(num)) {
    throw new BadRequestError(`${fieldName} must be a number`);
  }

  if (opts.integer && !Number.isInteger(num)) {
    throw new BadRequestError(`${fieldName} must be an integer`);
  }

  if (opts.min !== undefined && num < opts.min) {
    throw new BadRequestError(`${fieldName} must be at least ${opts.min}`);
  }

  if (opts.max !== undefined && num > opts.max) {
    throw new BadRequestError(`${fieldName} must be at most ${opts.max}`);
  }

  return num;
}

/** Validate an optional number field */
export function validateOptionalNumber(
  value: unknown,
  fieldName: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (value === null || value === undefined || value === '') return null;
  return validateNumber(value, fieldName, opts);
}

// =============================================
// BOOLEAN VALIDATION
// =============================================

/** Validate a required boolean field */
export function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestError(`${fieldName} must be a boolean`);
}

/** Validate an optional boolean, with default */
export function validateOptionalBoolean(
  value: unknown,
  fieldName: string,
  defaultValue: boolean = false,
): boolean {
  if (value === null || value === undefined) return defaultValue;
  return validateBoolean(value, fieldName);
}

// =============================================
// ENUM VALIDATION
// =============================================

/** Validate a value is one of the allowed enum values */
export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): T {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  if (!allowedValues.includes(value as T)) {
    throw new BadRequestError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`,
    );
  }

  return value as T;
}

/** Validate an optional enum value */
export function validateOptionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): T | null {
  if (value === null || value === undefined || value === '') return null;
  return validateEnum(value, fieldName, allowedValues);
}

// =============================================
// DATE VALIDATION
// =============================================

/** ISO 8601 date string pattern (YYYY-MM-DD or full datetime) */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Validate an ISO 8601 date string */
export function validateISODate(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be an ISO 8601 date string`);
  }

  if (!ISO_DATE_REGEX.test(value)) {
    throw new BadRequestError(`${fieldName} must be a valid ISO 8601 date`);
  }

  // Verify it parses to a valid date
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`${fieldName} contains an invalid date`);
  }

  return value;
}

/** Validate an optional ISO date */
export function validateOptionalISODate(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return validateISODate(value, fieldName);
}

// =============================================
// UK-SPECIFIC VALIDATION
// =============================================

/** UK postcode pattern (permissive — covers all valid formats) */
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** Validate a UK postcode */
export function validatePostcode(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  const cleaned = value.trim().toUpperCase();

  if (!UK_POSTCODE_REGEX.test(cleaned)) {
    throw new BadRequestError(`${fieldName} must be a valid UK postcode`);
  }

  return cleaned;
}

/** Validate an optional UK postcode */
export function validateOptionalPostcode(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return validatePostcode(value, fieldName);
}

/** UK phone number — permissive, allows various formats */
const UK_PHONE_REGEX = /^(\+44|0)\d{9,10}$/;

/** Validate a UK phone number */
export function validateOptionalPhone(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  const cleaned = value.replace(/[\s\-()]/g, '');

  if (!UK_PHONE_REGEX.test(cleaned)) {
    throw new BadRequestError(`${fieldName} must be a valid UK phone number`);
  }

  return cleaned;
}

// =============================================
// EMAIL VALIDATION
// =============================================

/** Basic email pattern — not exhaustive but catches common errors */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate an email address */
export function validateEmail(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  const trimmed = value.trim().toLowerCase();

  if (!EMAIL_REGEX.test(trimmed) || trimmed.length > 254) {
    throw new BadRequestError(`${fieldName} must be a valid email address`);
  }

  return trimmed;
}

/** Validate an optional email */
export function validateOptionalEmail(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return validateEmail(value, fieldName);
}

// =============================================
// GEO VALIDATION
// =============================================

/** Validate latitude (-90 to 90) */
export function validateLatitude(value: unknown, fieldName: string): number {
  return validateNumber(value, fieldName, { min: -90, max: 90 });
}

/** Validate longitude (-180 to 180) */
export function validateLongitude(value: unknown, fieldName: string): number {
  return validateNumber(value, fieldName, { min: -180, max: 180 });
}

/** Validate optional latitude */
export function validateOptionalLatitude(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) return null;
  return validateLatitude(value, fieldName);
}

/** Validate optional longitude */
export function validateOptionalLongitude(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) return null;
  return validateLongitude(value, fieldName);
}

// =============================================
// ARRAY VALIDATION
// =============================================

/** Validate a value is an array */
export function validateArray(
  value: unknown,
  fieldName: string,
  opts: { minLength?: number; maxLength?: number } = {},
): unknown[] {
  if (!Array.isArray(value)) {
    throw new BadRequestError(`${fieldName} must be an array`);
  }

  if (opts.minLength !== undefined && value.length < opts.minLength) {
    throw new BadRequestError(`${fieldName} must have at least ${opts.minLength} items`);
  }

  if (opts.maxLength !== undefined && value.length > opts.maxLength) {
    throw new BadRequestError(`${fieldName} must have at most ${opts.maxLength} items`);
  }

  return value;
}

// =============================================
// REQUEST BODY PARSING
// =============================================

/**
 * Safely parse a JSON request body.
 * Returns a Record — never returns arrays or primitives directly.
 * Throws BadRequestError on malformed JSON or non-object body.
 */
export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type');

  if (!contentType?.includes('application/json')) {
    throw new BadRequestError('Content-Type must be application/json');
  }

  let body: unknown;

  try {
    const text = await request.text();

    // Guard against empty body
    if (!text || text.trim().length === 0) {
      throw new BadRequestError('Request body is empty');
    }

    // Guard against absurdly large bodies (1MB limit for JSON)
    if (text.length > 1_048_576) {
      throw new BadRequestError('Request body exceeds 1MB limit');
    }

    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError('Invalid JSON in request body');
  }

  // Must be a plain object, not an array or primitive
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body must be a JSON object');
  }

  return body as Record<string, unknown>;
}

// =============================================
// DOMAIN-SPECIFIC VALIDATION
// =============================================

/** Validate fall height in millimetres (playground equipment) */
export function validateOptionalFallHeight(value: unknown, fieldName: string): number | null {
  return validateOptionalNumber(value, fieldName, { min: 0, max: 10_000, integer: true });
}

/** Validate a cost in GBP */
export function validateOptionalCostGbp(value: unknown, fieldName: string): number | null {
  return validateOptionalNumber(value, fieldName, { min: 0, max: 10_000_000 });
}

/** Validate inspection frequency in days */
export function validateFrequencyDays(value: unknown, fieldName: string): number {
  return validateNumber(value, fieldName, { min: 1, max: 365, integer: true });
}
