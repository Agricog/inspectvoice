/**
 * InspectVoice — Analytics
 * Privacy-respecting event tracking.
 * NEVER sends PII (names, emails, locations, postcodes).
 * Tracks feature usage patterns for product decisions.
 */

// =============================================
// TYPES
// =============================================

interface AnalyticsEvent {
  name: string;
  properties?: Record<string, string | number | boolean>;
}

type AnalyticsProvider = (event: AnalyticsEvent) => void;

// =============================================
// STATE
// =============================================

let isInitialised = false;
let provider: AnalyticsProvider = noopProvider;

function noopProvider(_event: AnalyticsEvent): void {
  // No-op — used when analytics not configured or in dev
}

function consoleProvider(event: AnalyticsEvent): void {
  console.debug('[Analytics]', event.name, event.properties ?? {});
}

// =============================================
// INITIALISATION
// =============================================

interface AnalyticsConfig {
  /** Enable console logging in development */
  debug?: boolean;
  /** Custom provider (e.g. PostHog, Plausible) */
  customProvider?: AnalyticsProvider;
}

export function initAnalytics(config: AnalyticsConfig = {}): void {
  if (isInitialised) return;

  if (config.customProvider) {
    provider = config.customProvider;
  } else if (config.debug && !import.meta.env.PROD) {
    provider = consoleProvider;
  }

  isInitialised = true;
}

// =============================================
// CORE TRACKING
// =============================================

/**
 * Track an analytics event.
 * All property values must be non-PII (no names, emails, postcodes).
 */
export function trackEvent(
  name: string,
  properties?: Record<string, string | number | boolean>,
): void {
  try {
    provider({ name, properties });
  } catch {
    // Analytics must never break the app
  }
}

/**
 * Track a page view.
 * Path only — no query params (may contain tokens).
 */
export function trackPageView(path: string): void {
  const cleanPath = path.split('?')[0] ?? path;
  trackEvent('page_view', { path: cleanPath });
}

// =============================================
// PREDEFINED EVENTS (type-safe)
// =============================================

/** Inspection lifecycle events */
export const InspectionEvents = {
  started: (inspectionType: string) =>
    trackEvent('inspection_started', { inspection_type: inspectionType }),

  itemRecorded: (method: 'voice' | 'manual') =>
    trackEvent('inspection_item_recorded', { method }),

  photoTaken: (type: 'defect' | 'reference' | 'overview') =>
    trackEvent('photo_captured', { photo_type: type }),

  aiAnalysisRequested: () =>
    trackEvent('ai_analysis_requested'),

  aiAnalysisCompleted: (durationMs: number) =>
    trackEvent('ai_analysis_completed', { duration_ms: durationMs }),

  aiAnalysisOverridden: (field: string) =>
    trackEvent('ai_analysis_overridden', { field }),

  reviewed: () =>
    trackEvent('inspection_reviewed'),

  signed: () =>
    trackEvent('inspection_signed'),

  exported: (format: 'pdf' | 'csv') =>
    trackEvent('inspection_exported', { format }),
} as const;

/** Asset register events */
export const AssetEvents = {
  created: (method: 'voice' | 'manual' | 'import') =>
    trackEvent('asset_created', { method }),

  referencePhotoSet: () =>
    trackEvent('reference_photo_set'),
} as const;

/** Offline/sync events */
export const SyncEvents = {
  wentOffline: () =>
    trackEvent('went_offline'),

  cameOnline: () =>
    trackEvent('came_online'),

  syncStarted: (pendingItems: number) =>
    trackEvent('sync_started', { pending_items: pendingItems }),

  syncCompleted: (durationMs: number, itemsSynced: number) =>
    trackEvent('sync_completed', { duration_ms: durationMs, items_synced: itemsSynced }),

  syncFailed: (reason: string) =>
    trackEvent('sync_failed', { reason }),
} as const;

/** Site management events */
export const SiteEvents = {
  created: () =>
    trackEvent('site_created'),

  assetsImported: (count: number) =>
    trackEvent('assets_imported', { count }),
} as const;
