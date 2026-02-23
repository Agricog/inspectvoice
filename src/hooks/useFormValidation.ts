/**
 * InspectVoice — useFormValidation Hook
 * Generic form state management with validation and sanitisation.
 * Integrates with validation.ts and sanitization.ts utilities.
 *
 * Usage:
 *   const form = useFormValidation({
 *     initialValues: { name: '', postcode: '' },
 *     validate: (values) =>
 *       createValidator()
 *         .required('name', values.name, 'Site name')
 *         .check('postcode', () =>
 *           values.postcode && !isValidUKPostcode(values.postcode)
 *             ? 'Invalid UK postcode' : null,
 *           ValidationErrorCode.PATTERN)
 *         .validate(),
 *     sanitise: true,
 *     onSubmit: async (values) => { await saveSite(values); },
 *   });
 *
 *   <input value={form.values.name} onChange={form.handleChange('name')} />
 *   {form.fieldError('name') && <span>{form.fieldError('name')}</span>}
 */

import { useState, useCallback, useRef } from 'react';
import type { ValidationResult, ValidationError } from '@utils/validation';
import { sanitiseForStorage } from '@utils/sanitization';

// =============================================
// TYPES
// =============================================

interface FormConfig<T extends Record<string, unknown>> {
  /** Starting values */
  initialValues: T;
  /** Validation function — runs on submit (and optionally on blur) */
  validate: (values: T) => ValidationResult;
  /** Auto-sanitise string fields before validation and submit (default: true) */
  sanitise?: boolean;
  /** Called with clean values after successful validation */
  onSubmit: (values: T) => Promise<void>;
  /** Validate individual fields on blur (default: false) */
  validateOnBlur?: boolean;
}

interface FormState<T extends Record<string, unknown>> {
  /** Current form values */
  values: T;
  /** All validation errors from last validation run */
  errors: ValidationError[];
  /** Whether the form is currently submitting */
  submitting: boolean;
  /** Whether submit was attempted (shows errors after first attempt) */
  submitted: boolean;
  /** Whether any field has been modified */
  dirty: boolean;
  /** Get the error message for a specific field (or null) */
  fieldError: (field: keyof T) => string | null;
  /** Whether a specific field has an error */
  hasError: (field: keyof T) => boolean;
  /** Update a field value */
  setValue: (field: keyof T, value: T[keyof T]) => void;
  /** Returns an onChange handler for a text input */
  handleChange: (field: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  /** Submit the form (validates → sanitises → calls onSubmit) */
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  /** Reset form to initial values */
  reset: () => void;
  /** Set multiple values at once */
  setValues: (partial: Partial<T>) => void;
  /** Handle field blur (validates single field if validateOnBlur enabled) */
  handleBlur: (field: keyof T) => () => void;
}

// =============================================
// HOOK
// =============================================

export function useFormValidation<T extends Record<string, unknown>>(
  config: FormConfig<T>,
): FormState<T> {
  const {
    initialValues,
    validate,
    onSubmit,
    sanitise: shouldSanitise = true,
    validateOnBlur = false,
  } = config;

  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  const initialValuesRef = useRef(initialValues);

  /** Sanitise all string values in the form */
  const sanitiseValues = useCallback((vals: T): T => {
    if (!shouldSanitise) return vals;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(vals)) {
      result[key] = typeof value === 'string' ? sanitiseForStorage(value) : value;
    }
    return result as T;
  }, [shouldSanitise]);

  /** Get error for a specific field */
  const fieldError = useCallback(
    (field: keyof T): string | null => {
      if (!submitted && !touchedFields.has(field as string)) return null;
      const error = errors.find((e) => e.field === field);
      return error?.message ?? null;
    },
    [errors, submitted, touchedFields],
  );

  /** Check if field has error */
  const hasError = useCallback(
    (field: keyof T): boolean => fieldError(field) !== null,
    [fieldError],
  );

  /** Update a single field */
  const setValue = useCallback(
    (field: keyof T, value: T[keyof T]) => {
      setValuesState((prev) => ({ ...prev, [field]: value }));
      setDirty(true);
    },
    [],
  );

  /** Update multiple fields */
  const setValues = useCallback(
    (partial: Partial<T>) => {
      setValuesState((prev) => ({ ...prev, ...partial }));
      setDirty(true);
    },
    [],
  );

  /** Create onChange handler for input elements */
  const handleChange = useCallback(
    (field: keyof T) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { value, type } = e.target;

        let typedValue: unknown = value;
        if (type === 'number') {
          typedValue = value === '' ? '' : Number(value);
        } else if (type === 'checkbox' && 'checked' in e.target) {
          typedValue = (e.target as HTMLInputElement).checked;
        }

        setValue(field, typedValue as T[keyof T]);
      },
    [setValue],
  );

  /** Handle field blur — validate single field if enabled */
  const handleBlur = useCallback(
    (field: keyof T) => () => {
      setTouchedFields((prev) => new Set(prev).add(field as string));

      if (validateOnBlur) {
        const result = validate(values);
        setErrors(result.errors);
      }
    },
    [validate, validateOnBlur, values],
  );

  /** Submit handler */
  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();

      setSubmitted(true);

      // Sanitise before validation
      const cleanValues = sanitiseValues(values);

      // Validate
      const result = validate(cleanValues);
      setErrors(result.errors);

      if (!result.valid) {
        return;
      }

      setSubmitting(true);

      try {
        await onSubmit(cleanValues);
        setDirty(false);
      } finally {
        setSubmitting(false);
      }
    },
    [values, validate, sanitiseValues, onSubmit],
  );

  /** Reset to initial values */
  const reset = useCallback(() => {
    setValuesState(initialValuesRef.current);
    setErrors([]);
    setSubmitted(false);
    setSubmitting(false);
    setDirty(false);
    setTouchedFields(new Set());
  }, []);

  return {
    values,
    errors,
    submitting,
    submitted,
    dirty,
    fieldError,
    hasError,
    setValue,
    setValues,
    handleChange,
    handleSubmit,
    handleBlur,
    reset,
  };
}
