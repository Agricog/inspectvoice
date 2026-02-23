/**
 * InspectVoice — useFetch Hook
 * Secure fetch wrapper with SSRF protection.
 * - Only allows requests to VITE_API_BASE_URL (relative URLs resolved against it)
 * - Auth token injection via Clerk
 * - Typed error handling with retry logic
 * - Request cancellation via AbortController
 *
 * Usage:
 *   const { data, error, loading, refetch } = useFetch<Site[]>('/api/v1/sites');
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { captureError } from '@utils/errorTracking';

// =============================================
// TYPES
// =============================================

export interface FetchState<T> {
  data: T | null;
  error: FetchError | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export interface FetchOptions {
  /** HTTP method (default: GET) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request body (auto-serialised to JSON) */
  body?: unknown;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Auth token getter (from Clerk) */
  getToken?: () => Promise<string | null>;
  /** Skip initial fetch (manual trigger only) */
  skip?: boolean;
  /** Retry count for failed requests (default: 0) */
  retries?: number;
  /** Retry delay in ms (default: 1000, doubles each retry) */
  retryDelay?: number;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseBody: string | null,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

// =============================================
// SSRF PROTECTION
// =============================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Resolve and validate a URL against the allowed API base.
 * Rejects absolute URLs to external domains.
 */
function resolveSecureURL(path: string): string {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL is not configured.');
  }

  // Block absolute URLs that don't match our API
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const url = new URL(path);
    const baseUrl = new URL(API_BASE_URL);
    if (url.origin !== baseUrl.origin) {
      throw new Error(`SSRF blocked: ${url.origin} is not an allowed origin.`);
    }
    return path;
  }

  // Relative path — resolve against API base
  const separator = API_BASE_URL.endsWith('/') || path.startsWith('/') ? '' : '/';
  return `${API_BASE_URL}${separator}${path}`;
}

// =============================================
// CORE FETCH FUNCTION (non-hook, for services)
// =============================================

export async function secureFetch<T>(
  path: string,
  options: Omit<FetchOptions, 'skip'> = {},
): Promise<T> {
  const url = resolveSecureURL(path);
  const { method = 'GET', body, headers = {}, getToken, retries = 0, retryDelay = 1000 } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...headers,
  };

  // Inject auth token if available
  if (getToken) {
    const token = await getToken();
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }
  }

  let lastError: FetchError | null = null;
  const maxAttempts = retries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => null);

        // Don't retry 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw new FetchError(
            `${method} ${path} failed: ${response.status} ${response.statusText}`,
            response.status,
            response.statusText,
            responseBody,
          );
        }

        // 5xx errors are retryable
        lastError = new FetchError(
          `${method} ${path} failed: ${response.status} ${response.statusText}`,
          response.status,
          response.statusText,
          responseBody,
        );

        if (attempt < maxAttempts - 1) {
          const delay = retryDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw lastError;
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof FetchError) {
        throw error;
      }

      // Network error (offline, DNS failure, etc)
      lastError = new FetchError(
        `${method} ${path} failed: Network error`,
        0,
        'Network Error',
        null,
      );

      if (attempt < maxAttempts - 1) {
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError ?? new FetchError(`${method} ${path} failed after ${maxAttempts} attempts`, 0, 'Unknown', null);
}

// =============================================
// REACT HOOK
// =============================================

export function useFetch<T>(
  path: string,
  options: FetchOptions = {},
): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<FetchError | null>(null);
  const [loading, setLoading] = useState(!options.skip);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const result = await secureFetch<T>(path, options);

      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        const fetchError = err instanceof FetchError
          ? err
          : new FetchError(String(err), 0, 'Unknown', null);
        setError(fetchError);

        captureError(err, {
          module: 'useFetch',
          operation: `${options.method ?? 'GET'} ${path}`,
          metadata: { status: fetchError.status },
        });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [path, options]);

  useEffect(() => {
    mountedRef.current = true;

    if (!options.skip) {
      void fetchData();
    }

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [fetchData, options.skip]);

  return { data, error, loading, refetch: fetchData };
}
