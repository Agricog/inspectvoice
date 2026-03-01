/**
 * InspectVoice — Sync Service
 * Batch 17 + Dependency-Ordered Processing
 *
 * Background sync engine that processes the IndexedDB sync queue.
 * Uploads media to R2, syncs inspection data to the API,
 * handles retries with exponential backoff, and dead-letters
 * permanently failed operations.
 *
 * Architecture:
 *   - Singleton service (one instance per app lifecycle)
 *   - Processes queue in DEPENDENCY ORDER (not FIFO)
 *   - Pauses automatically when offline
 *   - Resumes automatically when connectivity returns
 *   - Never blocks the UI — all work is async
 *   - Uses secureFetch for all API calls (SSRF + CSRF protected)
 *
 * Dependency chain (lower number = higher priority):
 *   0: CREATE_ASSET         → assets must exist before items reference them
 *   1: SYNC_INSPECTION      → inspections must exist before items reference them
 *   2: SYNC_INSPECTION_ITEM → items must exist before media links to them
 *   3: UPLOAD_PHOTO         → depends on inspection_item_id
 *   3: UPLOAD_AUDIO         → depends on inspection_item_id
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */

import { secureFetch, FetchError } from '@hooks/useFetch';
import {
  syncQueue,
  inspections,
  inspectionItems,
  pendingPhotos,
  pendingAudio,
  runStorageMaintenance,
} from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import {
  SyncOperationType,
  SyncStatus,
} from '@/types';
import type {
  SyncQueueEntry,
} from '@/types';

// =============================================
// CONFIGURATION
// =============================================

/** How often to poll the sync queue when online (ms) */
const POLL_INTERVAL_MS = 15_000;

/** Minimum delay between processing individual queue entries (ms) */
const ENTRY_PROCESSING_DELAY_MS = 500;

/** Base delay for exponential backoff on retries (ms) */
const BACKOFF_BASE_MS = 2_000;

/** Maximum backoff delay cap (ms) */
const BACKOFF_MAX_MS = 60_000;

/** How often to run storage maintenance (ms) — every 30 min */
const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000;

/** Maximum number of entries to process per poll cycle */
const MAX_ENTRIES_PER_CYCLE = 20;

// =============================================
// DEPENDENCY ORDERING
// =============================================

/**
 * Priority map for sync operation types.
 * Lower number = processed first.
 *
 * The dependency chain requires:
 *   Assets → Inspections → Inspection Items → Media (photos/audio)
 *
 * Processing out of order causes FK violations on the server.
 */
const SYNC_PRIORITY: Record<SyncOperationType, number> = {
  [SyncOperationType.CREATE_ASSET]: 0,
  [SyncOperationType.SYNC_INSPECTION]: 1,
  [SyncOperationType.SYNC_INSPECTION_ITEM]: 2,
  [SyncOperationType.UPLOAD_PHOTO]: 3,
  [SyncOperationType.UPLOAD_AUDIO]: 3,
};

/**
 * Sort sync queue entries by dependency priority.
 * Within the same priority level, preserves FIFO order (by queue id).
 */
function sortByDependency(
  entries: Array<SyncQueueEntry & { id: number }>,
): Array<SyncQueueEntry & { id: number }> {
  return [...entries].sort((a, b) => {
    const priorityDiff = SYNC_PRIORITY[a.type] - SYNC_PRIORITY[b.type];
    if (priorityDiff !== 0) return priorityDiff;
    // Same priority — preserve FIFO by queue insertion order
    return a.id - b.id;
  });
}

// =============================================
// TYPES
// =============================================

/** Listener callback for sync status changes */
type SyncStatusListener = (status: SyncStatus, detail?: SyncStatusDetail) => void;

/** Detail info passed with status updates */
export interface SyncStatusDetail {
  pendingCount: number;
  currentOperation?: string;
  lastError?: string;
  lastSyncedAt?: number;
}

/** R2 signed URL response from the API */
interface R2SignedUrlResponse {
  upload_url: string;
  r2_key: string;
  r2_url: string;
}

/** API response for synced entities */
interface SyncEntityResponse {
  id: string;
  updated_at: string;
}

// =============================================
// SYNC SERVICE
// =============================================

class SyncService {
  private status: SyncStatus = SyncStatus.IDLE;
  private listeners: Set<SyncStatusListener> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  private lastSyncedAt: number | null = null;
  private getAuthToken: (() => Promise<string | null>) | null = null;
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Event handler references for cleanup
  private readonly handleOnline = (): void => {
    this.isOnline = true;
    this.updateStatus(SyncStatus.IDLE);
    void this.processQueue();
  };

  private readonly handleOffline = (): void => {
    this.isOnline = false;
    this.updateStatus(SyncStatus.OFFLINE);
  };

  // =============================================
  // LIFECYCLE
  // =============================================

  /**
   * Initialise the sync service.
   * Call once on app startup after auth is ready.
   *
   * @param getToken — Clerk token getter for authenticated API calls
   */
  start(getToken: () => Promise<string | null>): void {
    this.getAuthToken = getToken;

    // Listen for connectivity changes
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // Set initial status
    this.isOnline = navigator.onLine;
    this.updateStatus(this.isOnline ? SyncStatus.IDLE : SyncStatus.OFFLINE);

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.processQueue();
    }, POLL_INTERVAL_MS);

    // Start maintenance
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);

    // Process immediately on start
    if (this.isOnline) {
      void this.processQueue();
    }
  }

  /**
   * Stop the sync service.
   * Call on sign-out or app teardown.
   */
  stop(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    this.getAuthToken = null;
    this.isProcessing = false;
    this.updateStatus(SyncStatus.IDLE);
  }

  /**
   * Force an immediate sync cycle.
   * Useful after completing an inspection or when user taps "Sync Now".
   */
  async syncNow(): Promise<void> {
    if (!this.isOnline) {
      this.updateStatus(SyncStatus.OFFLINE);
      return;
    }
    await this.processQueue();
  }

  // =============================================
  // STATUS MANAGEMENT
  // =============================================

  /** Get current sync status */
  getStatus(): SyncStatus {
    return this.status;
  }

  /** Subscribe to status changes. Returns unsubscribe function. */
  onStatusChange(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Update status and notify listeners */
  private updateStatus(status: SyncStatus, detail?: Partial<SyncStatusDetail>): void {
    this.status = status;
    const fullDetail: SyncStatusDetail = {
      pendingCount: 0,
      ...detail,
      lastSyncedAt: this.lastSyncedAt ?? undefined,
    };
    for (const listener of this.listeners) {
      try {
        listener(status, fullDetail);
      } catch (error) {
        captureError(error, { module: 'SyncService', operation: 'notifyListener' });
      }
    }
  }

  // =============================================
  // QUEUE PROCESSING
  // =============================================

  /**
   * Main queue processing loop.
   *
   * Entries are sorted by dependency priority before processing:
   *   CREATE_ASSET (0) → SYNC_INSPECTION (1) → SYNC_INSPECTION_ITEM (2) → media (3)
   *
   * This ensures parent records exist on the server before children
   * reference them via foreign keys.
   */
  private async processQueue(): Promise<void> {
    // Guard: don't run concurrently
    if (this.isProcessing) return;

    // Guard: must be online
    if (!this.isOnline) {
      this.updateStatus(SyncStatus.OFFLINE);
      return;
    }

    // Guard: must have auth
    if (!this.getAuthToken) {
      this.updateStatus(SyncStatus.AUTH_REQUIRED);
      return;
    }

    this.isProcessing = true;

    try {
      const entries = await syncQueue.getAll();

      if (entries.length === 0) {
        this.updateStatus(SyncStatus.SYNCED, { pendingCount: 0 });
        this.isProcessing = false;
        return;
      }

      this.updateStatus(SyncStatus.SYNCING, { pendingCount: entries.length });

      // Sort by dependency priority, then take batch
      const sorted = sortByDependency(entries);
      const batch = sorted.slice(0, MAX_ENTRIES_PER_CYCLE);
      let successCount = 0;
      let blockedByDependency = false;

      for (const entry of batch) {
        // Re-check connectivity between entries
        if (!this.isOnline) {
          this.updateStatus(SyncStatus.OFFLINE);
          break;
        }

        // Skip entries that have exceeded max attempts
        if (entry.attempts >= entry.max_attempts) {
          continue;
        }

        // Calculate backoff delay for retried entries
        if (entry.attempts > 0) {
          const backoffMs = Math.min(
            BACKOFF_BASE_MS * Math.pow(2, entry.attempts - 1),
            BACKOFF_MAX_MS,
          );
          // Skip if not enough time has elapsed since last attempt
          if (entry.last_attempt_at) {
            const elapsed = Date.now() - new Date(entry.last_attempt_at).getTime();
            if (elapsed < backoffMs) {
              continue;
            }
          }
        }

        const success = await this.processEntry(entry);
        if (success) {
          successCount++;
          await syncQueue.remove(entry.id);
        } else {
          // If a parent operation fails, skip all children in this cycle.
          // E.g., if CREATE_ASSET fails, don't attempt SYNC_INSPECTION_ITEM
          // which depends on that asset existing.
          const failedPriority = SYNC_PRIORITY[entry.type];
          const remainingHasChildren = batch.some(
            (e) => SYNC_PRIORITY[e.type] > failedPriority,
          );
          if (remainingHasChildren) {
            blockedByDependency = true;
            break;
          }
        }

        // Brief pause between entries to avoid hammering the API
        await delay(ENTRY_PROCESSING_DELAY_MS);
      }

      // Update status
      const remaining = await syncQueue.count();
      if (remaining === 0) {
        this.lastSyncedAt = Date.now();
        this.updateStatus(SyncStatus.SYNCED, { pendingCount: 0 });
      } else {
        this.updateStatus(
          blockedByDependency
            ? SyncStatus.ERROR
            : successCount > 0
              ? SyncStatus.IDLE
              : SyncStatus.ERROR,
          {
            pendingCount: remaining,
            lastError: blockedByDependency
              ? 'Waiting for parent record to sync before processing dependents'
              : undefined,
          },
        );
      }
    } catch (error) {
      captureError(error, { module: 'SyncService', operation: 'processQueue' });
      this.updateStatus(SyncStatus.ERROR, {
        pendingCount: await syncQueue.count().catch(() => -1),
        lastError: error instanceof Error ? error.message : 'Unknown sync error',
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /** Process a single queue entry, routing to the correct handler */
  private async processEntry(entry: SyncQueueEntry & { id: number }): Promise<boolean> {
    try {
      switch (entry.type) {
        case SyncOperationType.UPLOAD_PHOTO:
          await this.processPhotoUpload(entry.entity_id);
          return true;

        case SyncOperationType.UPLOAD_AUDIO:
          await this.processAudioUpload(entry.entity_id);
          return true;

        case SyncOperationType.SYNC_INSPECTION:
          await this.processInspectionSync(entry.entity_id);
          return true;

        case SyncOperationType.SYNC_INSPECTION_ITEM:
          await this.processInspectionItemSync(entry.entity_id);
          return true;

        case SyncOperationType.CREATE_ASSET:
          await this.processAssetCreate(entry.entity_id, entry.payload);
          return true;

        default: {
          // Exhaustive check — if a new SyncOperationType is added,
          // TypeScript will error here until handled
          const _exhaustive: never = entry.type;
          captureError(
            new Error(`Unknown sync operation type: ${String(_exhaustive)}`),
            { module: 'SyncService', operation: 'processEntry' },
          );
          return false;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await syncQueue.recordAttempt(entry.id, errorMessage);

      // Log non-retryable errors at higher severity
      const isClientError = error instanceof FetchError && error.status >= 400 && error.status < 500;
      captureError(error, {
        module: 'SyncService',
        operation: `processEntry:${entry.type}`,
        entityId: entry.entity_id,
        attempt: entry.attempts + 1,
        isClientError,
      });

      // Client errors (4xx) should not be retried — mark as max attempts
      if (isClientError) {
        await syncQueue.recordAttempt(entry.id, `Non-retryable: ${errorMessage}`);
        await syncQueue.recordAttempt(entry.id, `Non-retryable: ${errorMessage}`);
        // Recording 3 times ensures it hits max_attempts (3) for purgeFailed()
      }

      return false;
    }
  }

  // =============================================
  // OPERATION HANDLERS
  // =============================================

  /**
   * Upload a pending photo to R2 via signed URL.
   *
   * Flow:
   *   1. Load photo from IndexedDB
   *   2. Request signed upload URL from API
   *   3. PUT base64-decoded bytes to R2
   *   4. Mark photo as uploaded with R2 key/URL
   */
  private async processPhotoUpload(photoId: string): Promise<void> {
    // 1. Load from IndexedDB
    const photos = await pendingPhotos.getUnsynced();
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) {
      // Already synced or deleted — nothing to do
      return;
    }

    // Guard: inspection_item_id must be set (linked via linkToItem)
    if (!photo.inspection_item_id) {
      throw new Error('Photo has no inspection_item_id — cannot upload until item is saved');
    }

    // 2. Request signed URL
    const signedUrl = await secureFetch<R2SignedUrlResponse>(
      '/api/v1/uploads/photo',
      {
        method: 'POST',
        getToken: this.getAuthToken!,
        body: {
          inspection_item_id: photo.inspection_item_id,
          mime_type: photo.mime_type,
          file_size_bytes: photo.file_size_bytes,
          is_reference_photo: photo.is_reference_photo,
        },
      },
    );

    // 3. Upload to R2 (direct PUT to signed URL — bypasses secureFetch SSRF as it's R2)
    const binaryData = base64ToArrayBuffer(photo.base64Data);
    const uploadResponse = await fetch(signedUrl.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': photo.mime_type,
        'Content-Length': String(binaryData.byteLength),
      },
      body: binaryData,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `R2 photo upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
      );
    }

    // 4. Mark as uploaded
    await pendingPhotos.markUploaded(photo.id, signedUrl.r2_key, signedUrl.r2_url);

    // 5. Notify API that upload is complete (links photo to inspection item)
    await secureFetch<void>(
      `/api/v1/uploads/photo/${signedUrl.r2_key}/confirm`,
      {
        method: 'POST',
        getToken: this.getAuthToken!,
        body: {
          inspection_item_id: photo.inspection_item_id,
          asset_id: photo.asset_id,
          captured_at: photo.captured_at,
          latitude: photo.latitude,
          longitude: photo.longitude,
          caption: photo.caption,
          is_reference_photo: photo.is_reference_photo,
        },
      },
    );
  }

  /**
   * Upload a pending audio recording to R2 via signed URL.
   * This triggers the Speechmatics transcription pipeline server-side.
   *
   * Flow:
   *   1. Load audio from IndexedDB
   *   2. Request signed upload URL from API
   *   3. PUT audio blob to R2
   *   4. Mark audio as uploaded with R2 key
   *   5. Notify API → triggers Speechmatics → Claude analysis queue
   */
  private async processAudioUpload(audioId: string): Promise<void> {
    const recordings = await pendingAudio.getUnsynced();
    const audio = recordings.find((a) => a.id === audioId);
    if (!audio) return;

    // Guard: inspection_item_id must be set
    if (!audio.inspection_item_id) {
      throw new Error('Audio has no inspection_item_id — cannot upload until item is saved');
    }

    // 1. Request signed URL
    const signedUrl = await secureFetch<R2SignedUrlResponse>(
      '/api/v1/uploads/audio',
      {
        method: 'POST',
        getToken: this.getAuthToken!,
        body: {
          inspection_item_id: audio.inspection_item_id,
          asset_id: audio.asset_id,
          mime_type: audio.mime_type,
          duration_seconds: audio.duration_seconds,
          asset_code: audio.asset_code,
          asset_type: audio.asset_type,
        },
      },
    );

    // 2. Upload blob to R2
    const uploadResponse = await fetch(signedUrl.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': audio.mime_type,
        'Content-Length': String(audio.audioBlob.size),
      },
      body: audio.audioBlob,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `R2 audio upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
      );
    }

    // 3. Mark as uploaded
    await pendingAudio.markUploaded(audio.id, signedUrl.r2_key);

    // 4. Notify API → triggers Speechmatics transcription → Claude analysis pipeline
    await secureFetch<void>(
      `/api/v1/uploads/audio/${signedUrl.r2_key}/confirm`,
      {
        method: 'POST',
        getToken: this.getAuthToken!,
        body: {
          inspection_item_id: audio.inspection_item_id,
          asset_id: audio.asset_id,
          asset_code: audio.asset_code,
          asset_type: audio.asset_type,
          duration_seconds: audio.duration_seconds,
          timestamp: audio.timestamp,
        },
      },
    );
  }

  /**
   * Sync a local inspection to the server.
   * Creates or updates depending on whether it exists server-side.
   */
  private async processInspectionSync(inspectionId: string): Promise<void> {
    const local = await inspections.get(inspectionId);
    if (!local) return;
    if (!local.isDirty) return;

    try {
      if (local.syncedAt === null) {
        // Never synced — create on server
        await secureFetch<SyncEntityResponse>(
          '/api/v1/inspections',
          {
            method: 'POST',
            getToken: this.getAuthToken!,
            body: local.data,
          },
        );
      } else {
        // Previously synced — update on server
        await secureFetch<SyncEntityResponse>(
          `/api/v1/inspections/${inspectionId}`,
          {
            method: 'PUT',
            getToken: this.getAuthToken!,
            body: local.data,
          },
        );
      }
      await inspections.markSynced(inspectionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      await inspections.markSyncError(inspectionId, errorMessage);
      throw error;
    }
  }

  /**
   * Sync a local inspection item to the server.
   */
  private async processInspectionItemSync(itemId: string): Promise<void> {
    const local = await inspectionItems.get(itemId);
    if (!local) return;
    if (!local.isDirty) return;

    if (local.syncedAt === null) {
      await secureFetch<SyncEntityResponse>(
        '/api/v1/inspection-items',
        {
          method: 'POST',
          getToken: this.getAuthToken!,
          body: local.data,
        },
      );
    } else {
      await secureFetch<SyncEntityResponse>(
        `/api/v1/inspection-items/${itemId}`,
        {
          method: 'PUT',
          getToken: this.getAuthToken!,
          body: local.data,
        },
      );
    }

    await inspectionItems.markSynced(itemId);
  }

  /**
   * Create a new asset on the server (added during inspection).
   */
  private async processAssetCreate(
    assetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await secureFetch<SyncEntityResponse>(
      '/api/v1/assets',
      {
        method: 'POST',
        getToken: this.getAuthToken!,
        body: { id: assetId, ...payload },
      },
    );
  }

  // =============================================
  // MAINTENANCE
  // =============================================

  /** Run periodic storage maintenance */
  private async runMaintenance(): Promise<void> {
    try {
      const result = await runStorageMaintenance();
      if (result.failedOps.length > 0) {
        captureError(
          new Error(`Dead-lettered ${result.failedOps.length} sync operations`),
          {
            module: 'SyncService',
            operation: 'runMaintenance',
            failedTypes: result.failedOps.map((op) => op.type),
          },
        );
      }
    } catch (error) {
      captureError(error, { module: 'SyncService', operation: 'runMaintenance' });
    }
  }
}

// =============================================
// HELPERS
// =============================================

/** Convert base64 string to ArrayBuffer for binary upload */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Strip data URI prefix if present
  const cleaned = base64.includes(',') ? base64.split(',')[1] ?? base64 : base64;
  const binaryString = atob(cleaned);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/** Promise-based delay */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================
// SINGLETON EXPORT
// =============================================

/** Singleton sync service instance */
export const syncService = new SyncService();

/**
 * Hook-friendly access to sync status.
 * Use in React components via useEffect + onStatusChange.
 *
 * Example:
 * ```ts
 * const [syncStatus, setSyncStatus] = useState(SyncStatus.IDLE);
 *
 * useEffect(() => {
 *   return syncService.onStatusChange((status) => setSyncStatus(status));
 * }, []);
 * ```
 */
export type { SyncStatusListener };
