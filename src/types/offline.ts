/**
 * InspectVoice — Offline & Sync Types
 * Types for IndexedDB storage, sync queue, and local draft state.
 * These wrap the server entities with offline metadata.
 */

import type {
  Inspection,
  InspectionItem,
  Site,
  Asset,
} from './entities';

// =============================================
// SYNC STATUS
// =============================================

export enum SyncStatus {
  SYNCED = 'synced',
  SYNCING = 'syncing',
  OFFLINE = 'offline',
  ERROR = 'error',
  AUTH_REQUIRED = 'auth_required',
  IDLE = 'idle',
}

// =============================================
// LOCAL DRAFT RECORDS (IndexedDB)
// =============================================

/** Inspection stored locally with sync metadata */
export interface LocalInspection {
  readonly id: string;
  data: Inspection;
  isDirty: boolean;
  lastModified: number;
  syncedAt: number | null;
  syncError: string | null;
}

/** Inspection item stored locally before sync */
export interface LocalInspectionItem {
  readonly id: string;
  data: InspectionItem;
  isDirty: boolean;
  lastModified: number;
  syncedAt: number | null;
}

// =============================================
// PENDING MEDIA (awaiting upload to R2)
// =============================================

/** Photo stored as base64 in IndexedDB, awaiting R2 upload */
export interface PendingPhoto {
  readonly id: string;
  inspection_item_id: string;
  asset_id: string | null;
  /** Base64 image data (JPEG) */
  base64Data: string;
  mime_type: string;
  file_size_bytes: number;
  /** Capture metadata */
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  is_reference_photo: boolean;
  caption: string | null;
  /** Sync state */
  synced: boolean;
  r2_key: string | null;
  r2_url: string | null;
}

/** Audio recording stored as blob in IndexedDB, awaiting Speechmatics transcription */
export interface PendingAudio {
  readonly id: string;
  inspection_item_id: string;
  asset_id: string;
  /** Audio data */
  audioBlob: Blob;
  duration_seconds: number;
  mime_type: string;
  /** Context for AI processing */
  asset_code: string;
  asset_type: string;
  /** Capture metadata */
  timestamp: string;
  /** Sync state */
  synced: boolean;
  r2_key: string | null;
}

// =============================================
// SYNC QUEUE
// =============================================

export enum SyncOperationType {
  UPLOAD_AUDIO = 'upload_audio',
  UPLOAD_PHOTO = 'upload_photo',
  SYNC_INSPECTION = 'sync_inspection',
  SYNC_INSPECTION_ITEM = 'sync_inspection_item',
  CREATE_ASSET = 'create_asset',
}

export interface SyncQueueEntry {
  readonly id?: number;
  type: SyncOperationType;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
}

// =============================================
// CACHED DATA (for offline access)
// =============================================

/** Site data cached for offline inspection workflow */
export interface CachedSite {
  readonly id: string;
  data: Site;
  cachedAt: number;
}

/** Asset data cached for offline inspection workflow */
export interface CachedAsset {
  readonly id: string;
  site_id: string;
  data: Asset;
  cachedAt: number;
}

// =============================================
// INDEXEDDB STORE NAMES
// =============================================

export const IDB_STORE_NAMES = {
  INSPECTIONS: 'inspections',
  INSPECTION_ITEMS: 'inspection_items',
  PHOTOS_PENDING: 'photos_pending',
  AUDIO_PENDING: 'audio_pending',
  SYNC_QUEUE: 'sync_queue',
  SITES_CACHE: 'sites_cache',
  ASSETS_CACHE: 'assets_cache',
} as const;

export const IDB_DATABASE_NAME = 'inspectvoice-offline';
export const IDB_VERSION = 1;
