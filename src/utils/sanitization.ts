/**
 * InspectVoice — Input Sanitisation
 * DOMPurify wrapper for XSS prevention.
 * Every user-provided string rendered in the DOM must pass through sanitise().
 * Every string sent to the API should pass through sanitiseForStorage().
 */

import DOMPurify from 'dompurify';

// =============================================
// CORE SANITISATION
// =============================================

/**
 * Sanitise a string for safe DOM rendering.
 * Strips all HTML tags and attributes by default.
 */
export function sanitise(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  }).trim();
}

/**
 * Sanitise with limited formatting (bold, italic, lists).
 * Use only for rich-text fields like inspector notes where
 * formatting is explicitly allowed.
 */
export function sanitiseRichText(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'br', 'p'],
    ALLOWED_ATTR: [],
  }).trim();
}

/**
 * Sanitise for database storage.
 * Strips all HTML, normalises whitespace, trims.
 * Use for all text fields before API calls.
 */
export function sanitiseForStorage(input: string): string {
  const stripped = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });

  return stripped
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitise a multiline string for storage.
 * Preserves intentional line breaks but strips HTML and excess whitespace.
 */
export function sanitiseMultiline(input: string): string {
  const stripped = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });

  return stripped
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

// =============================================
// OBJECT SANITISATION
// =============================================

/**
 * Recursively sanitise all string values in an object.
 * Use before sending form data to the API.
 */
export function sanitiseObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitiseForStorage(value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitiseObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') return sanitiseForStorage(item);
        if (item !== null && typeof item === 'object') {
          return sanitiseObject(item as Record<string, unknown>);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

// =============================================
// URL SANITISATION
// =============================================

/**
 * Sanitise and validate a URL.
 * Only allows https: protocol. Returns null if invalid.
 */
export function sanitiseURL(input: string): string | null {
  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'https:') {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

// =============================================
// FILENAME SANITISATION
// =============================================

/**
 * Sanitise a filename for safe storage.
 * Removes path traversal, special chars, limits length.
 */
export function sanitiseFilename(input: string): string {
  return input
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200)
    .trim();
}
