/**
 * InspectVoice — Input Validation
 * Pure functions for validating user input.
 * Used by useFormValidation hook and server-side Workers.
 * No side effects — returns typed ValidationResult.
 */

// =============================================
// CORE TYPES
// =============================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: ValidationErrorCode;
}

export enum ValidationErrorCode {
  REQUIRED = 'required',
  MIN_LENGTH = 'min_length',
  MAX_LENGTH = 'max_length',
  PATTERN = 'pattern',
  RANGE = 'range',
  INVALID_FORMAT = 'invalid_format',
  INVALID_TYPE = 'invalid_type',
  CUSTOM = 'custom',
}

// =============================================
// FIELD VALIDATORS
// =============================================

/** Check a value is present and non-empty after trimming */
export function isRequired(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** String length within bounds (after trimming) */
export function isLengthInRange(
  value: string,
  min: number,
  max: number,
): boolean {
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max;
}

/** Numeric value within range (inclusive) */
export function isInRange(value: number, min: number, max: number): boolean {
  return !isNaN(value) && value >= min && value <= max;
}

/** Valid email format (RFC 5322 simplified) */
export function isValidEmail(value: string): boolean {
  const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return pattern.test(value.trim());
}

/** Valid UK phone number */
export function isValidUKPhone(value: string): boolean {
  const cleaned = value.replace(/[\s\-()]/g, '');
  return /^(?:0|\+44)\d{9,10}$/.test(cleaned);
}

/** Valid UK postcode */
export function isValidUKPostcode(value: string): boolean {
  const pattern = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  return pattern.test(value.trim());
}

/** Valid UUID v4 */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Valid ISO 8601 date string */
export function isValidISODate(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime()) && date.toISOString().startsWith(value.substring(0, 10));
}

/** Valid latitude (-90 to 90) */
export function isValidLatitude(value: number): boolean {
  return isInRange(value, -90, 90);
}

/** Valid longitude (-180 to 180) */
export function isValidLongitude(value: number): boolean {
  return isInRange(value, -180, 180);
}

/** Positive integer (for measurements like fall height) */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Non-negative decimal (for costs) */
export function isNonNegativeDecimal(value: number): boolean {
  return !isNaN(value) && isFinite(value) && value >= 0;
}

// =============================================
// VALIDATION BUILDER
// =============================================

type ValidatorFn = () => ValidationError | null;

/**
 * Fluent validation builder.
 * Usage:
 *   const result = createValidator()
 *     .check('name', () => !isRequired(name) ? 'Site name is required' : null, ValidationErrorCode.REQUIRED)
 *     .check('postcode', () => postcode && !isValidUKPostcode(postcode) ? 'Invalid UK postcode' : null, ValidationErrorCode.PATTERN)
 *     .validate();
 */
export function createValidator(): Validator {
  return new Validator();
}

class Validator {
  private readonly checks: ValidatorFn[] = [];

  /** Add a validation check */
  check(
    field: string,
    testFn: () => string | null,
    code: ValidationErrorCode = ValidationErrorCode.CUSTOM,
  ): this {
    this.checks.push(() => {
      const message = testFn();
      if (message) {
        return { field, message, code };
      }
      return null;
    });
    return this;
  }

  /** Add a required field check */
  required(field: string, value: unknown, label?: string): this {
    return this.check(
      field,
      () => !isRequired(value) ? `${label ?? field} is required` : null,
      ValidationErrorCode.REQUIRED,
    );
  }

  /** Add a string length check */
  length(field: string, value: string, min: number, max: number, label?: string): this {
    return this.check(
      field,
      () => {
        if (!isRequired(value)) return null; // skip if empty — use .required() for that
        return !isLengthInRange(value, min, max)
          ? `${label ?? field} must be between ${min} and ${max} characters`
          : null;
      },
      ValidationErrorCode.MAX_LENGTH,
    );
  }

  /** Add a numeric range check */
  range(field: string, value: number, min: number, max: number, label?: string): this {
    return this.check(
      field,
      () => !isInRange(value, min, max)
        ? `${label ?? field} must be between ${min} and ${max}`
        : null,
      ValidationErrorCode.RANGE,
    );
  }

  /** Run all checks and return result */
  validate(): ValidationResult {
    const errors: ValidationError[] = [];

    for (const check of this.checks) {
      const error = check();
      if (error) {
        errors.push(error);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// =============================================
// DOMAIN-SPECIFIC VALIDATORS
// =============================================

/** Validate asset code format (alphanumeric, spaces, hyphens, 1-50 chars) */
export function isValidAssetCode(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9\s\-]{0,49}$/.test(value.trim());
}

/** Validate fall height in mm (0-10000mm = 0-10m, sensible range) */
export function isValidFallHeight(value: number): boolean {
  return isInRange(value, 0, 10000);
}

/** Validate temperature in Celsius (-30 to 50, UK climate range) */
export function isValidTemperature(value: number): boolean {
  return isInRange(value, -30, 50);
}

/** Validate cost in GBP (0 to 1,000,000) */
export function isValidCostGBP(value: number): boolean {
  return isNonNegativeDecimal(value) && value <= 1_000_000;
}
