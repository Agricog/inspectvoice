/**
 * InspectVoice — Offline Store (IndexedDB)
 * Foundation for offline-first inspection workflow.
 * All inspection data captured locally first, synced when online.
 *
 * Database: 'inspectvoice-offline' v1
 * Stores: inspections, inspection_items, photos_pending, audio_pending,
 *         sync_queue, sites_cache, assets_cache
 *
 * Uses 'idb' library for typed IndexedDB access.
 */

import { openDB, type IDBPDatabase } from 'idb';
import { v4 as uuid } from 'uuid';
import { captureError } from '@utils/errorTracking';
import {
  IDB_DATABASE_NAME,
  IDB_VERSION,
  IDB_STORE_NAMES,
  SyncOperationType,
  type LocalInspection,
  type LocalInspectionItem,
  type PendingPhoto,
  type PendingAudio,
  type SyncQueueEntry,
  type CachedSite,
  type CachedAsset,
} from '@/types';

// =============================================
// DATABASE SCHEMA & INITIALISATION
// =============================================

interface InspectVoiceDB {
  [IDB_STORE_NAMES.INSPECTIONS]: {
    key: string;
    value: LocalInspection;
    indexes: {
      'site_id': string;
      'status': string;
      'isDirty': number;
    };
  };
  [IDB_STORE_NAMES.INSPECTION_ITEMS]: {
    key: string;
    value: LocalInspectionItem;
    indexes: {
      'inspection_id': string;
      'isDirty': number;
    };
  };
  [IDB_STORE_NAMES.PHOTOS_PENDING]: {
    key: string;
    value: PendingPhoto;
    indexes: {
      'inspection_item_id': string;
      'synced': number;
    };
  };
  [IDB_STORE_NAMES.AUDIO_PENDING]: {
    key: string;
    value: PendingAudio;
    indexes: {
      'inspection_item_id': string;
      'synced': number;
    };
  };
  [IDB_STORE_NAMES.SYNC_QUEUE]: {
    key: number;
    value: SyncQueueEntry;
  };
  [IDB_STORE_NAMES.SITES_CACHE]: {
    key: string;
    value: CachedSite;
  };
  [IDB_STORE_NAMES.ASSETS_CACHE]: {
    key: string;
    value: CachedAsset;
    indexes: {
      'site_id': string;
    };
  };
}

let dbInstance: IDBPDatabase<InspectVoiceDB> | null = null;

/**
 * Get or create the database connection.
 * Handles schema migrations via version upgrades.
 */
async function getDB(): Promise<IDBPDatabase<InspectVoiceDB>> {
  if (dbInstance) return dbInstance;

  try {
    dbInstance = await openDB<InspectVoiceDB>(IDB_DATABASE_NAME, IDB_VERSION, {
      upgrade(db, oldVersion) {
        // Version 1: Initial schema
        if (oldVersion < 1) {
          // Inspections (drafts)
          const inspectionStore = db.createObjectStore(IDB_STORE_NAMES.INSPECTIONS, {
            keyPath: 'id',
          });
          inspectionStore.createIndex('site_id', 'data.site_id');
          inspectionStore.createIndex('status', 'data.status');
          inspectionStore.createIndex('isDirty', 'isDirty');

          // Inspection items
          const itemStore = db.createObjectStore(IDB_STORE_NAMES.INSPECTION_ITEMS, {
            keyPath: 'id',
          });
          itemStore.createIndex('inspection_id', 'data.inspection_id');
          itemStore.createIndex('isDirty', 'isDirty');

          // Photos pending upload
          const photoStore = db.createObjectStore(IDB_STORE_NAMES.PHOTOS_PENDING, {
            keyPath: 'id',
          });
          photoStore.createIndex('inspection_item_id', 'inspection_item_id');
          photoStore.createIndex('synced', 'synced');

          // Audio pending transcription
          const audioStore = db.createObjectStore(IDB_STORE_NAMES.AUDIO_PENDING, {
            keyPath: 'id',
          });
          audioStore.createIndex('inspection_item_id', 'inspection_item_id');
          audioStore.createIndex('synced', 'synced');

          // Sync queue (FIFO, auto-increment key)
          db.createObjectStore(IDB_STORE_NAMES.SYNC_QUEUE, {
            autoIncrement: true,
          });

          // Sites cache (for offline access)
          db.createObjectStore(IDB_STORE_NAMES.SITES_CACHE, {
            keyPath: 'id',
          });

          // Assets cache
          const assetStore = db.createObjectStore(IDB_STORE_NAMES.ASSETS_CACHE, {
            keyPath: 'id',
          });
          assetStore.createIndex('site_id', 'site_id');
        }
      },

      blocked() {
        console.warn('[OfflineStore] Database upgrade blocked — close other tabs.');
      },

      blocking() {
        dbInstance?.close();
        dbInstance = null;
      },

      terminated() {
        dbInstance = null;
      },
    });

    return dbInstance;
  } catch (error) {
    captureError(error, {
      module: 'offlineStore',
      operation: 'getDB',
    });
    throw error;
  }
}

// =============================================
// INSPECTIONS
// =============================================

export const inspections = {
  /** Create a new draft inspection locally */
  async create(data: LocalInspection['data']): Promise<LocalInspection> {
    const db = await getDB();
    const record: LocalInspection = {
      id: data.id || uuid(),
      data: { ...data, id: data.id || uuid() },
      isDirty: true,
      lastModified: Date.now(),
      syncedAt: null,
      syncError: null,
    };

    await db.put(IDB_STORE_NAMES.INSPECTIONS, record);

    // Enqueue sync
    await enqueueSync(SyncOperationType.SYNC_INSPECTION, record.id);

    return record;
  },

  /** Get a single inspection by ID */
  async get(id: string): Promise<LocalInspection | undefined> {
    const db = await getDB();
    return db.get(IDB_STORE_NAMES.INSPECTIONS, id);
  },

  /** Get all inspections for a site */
  async getBySite(siteId: string): Promise<LocalInspection[]> {
    const db = await getDB();
    return db.getAllFromIndex(IDB_STORE_NAMES.INSPECTIONS, 'site_id', siteId);
  },

  /** Get all draft inspections */
  async getDrafts(): Promise<LocalInspection[]> {
    const db = await getDB();
    return db.getAllFromIndex(IDB_STORE_NAMES.INSPECTIONS, 'status', 'draft');
  },

  /** Get all dirty (unsynced) inspections */
  async getDirty(): Promise<LocalInspection[]> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.INSPECTIONS);
    return all.filter((record) => record.isDirty);
  },

  /** Update an existing inspection */
  async update(id: string, data: Partial<LocalInspection['data']>): Promise<LocalInspection | null> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.INSPECTIONS, id);

    if (!existing) return null;

    // Prevent editing signed inspections (immutability rule)
    if (existing.data.status === 'signed' || existing.data.status === 'exported') {
      console.warn('[OfflineStore] Cannot modify signed/exported inspection.');
      return existing;
    }

    const updated: LocalInspection = {
      ...existing,
      data: { ...existing.data, ...data },
      isDirty: true,
      lastModified: Date.now(),
    };

    await db.put(IDB_STORE_NAMES.INSPECTIONS, updated);
    await enqueueSync(SyncOperationType.SYNC_INSPECTION, id);

    return updated;
  },

  /** Mark inspection as synced (called after successful API sync) */
  async markSynced(id: string): Promise<void> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.INSPECTIONS, id);

    if (!existing) return;

    const updated: LocalInspection = {
      ...existing,
      isDirty: false,
      syncedAt: Date.now(),
      syncError: null,
    };

    await db.put(IDB_STORE_NAMES.INSPECTIONS, updated);
  },

  /** Record a sync error */
  async markSyncError(id: string, error: string): Promise<void> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.INSPECTIONS, id);

    if (!existing) return;

    const updated: LocalInspection = {
      ...existing,
      syncError: error,
    };

    await db.put(IDB_STORE_NAMES.INSPECTIONS, updated);
  },

  /** Delete a draft inspection (only drafts — signed are immutable) */
  async deleteDraft(id: string): Promise<boolean> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.INSPECTIONS, id);

    if (!existing) return false;

    if (existing.data.status !== 'draft') {
      console.warn('[OfflineStore] Can only delete draft inspections.');
      return false;
    }

    await db.delete(IDB_STORE_NAMES.INSPECTIONS, id);
    return true;
  },

  /** Get count of all local inspections */
  async count(): Promise<number> {
    const db = await getDB();
    return db.count(IDB_STORE_NAMES.INSPECTIONS);
  },
};

// =============================================
// INSPECTION ITEMS
// =============================================

export const inspectionItems = {
  /** Create a new inspection item */
  async create(data: LocalInspectionItem['data']): Promise<LocalInspectionItem> {
    const db = await getDB();
    const record: LocalInspectionItem = {
      id: data.id || uuid(),
      data: { ...data, id: data.id || uuid() },
      isDirty: true,
      lastModified: Date.now(),
      syncedAt: null,
    };

    await db.put(IDB_STORE_NAMES.INSPECTION_ITEMS, record);
    await enqueueSync(SyncOperationType.SYNC_INSPECTION_ITEM, record.id);

    return record;
  },

  /** Get all items for an inspection */
  async getByInspection(inspectionId: string): Promise<LocalInspectionItem[]> {
    const db = await getDB();
    return db.getAllFromIndex(IDB_STORE_NAMES.INSPECTION_ITEMS, 'inspection_id', inspectionId);
  },

  /** Get a single item */
  async get(id: string): Promise<LocalInspectionItem | undefined> {
    const db = await getDB();
    return db.get(IDB_STORE_NAMES.INSPECTION_ITEMS, id);
  },

  /** Update an inspection item */
  async update(id: string, data: Partial<LocalInspectionItem['data']>): Promise<LocalInspectionItem | null> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.INSPECTION_ITEMS, id);

    if (!existing) return null;

    const updated: LocalInspectionItem = {
      ...existing,
      data: { ...existing.data, ...data },
      isDirty: true,
      lastModified: Date.now(),
    };

    await db.put(IDB_STORE_NAMES.INSPECTION_ITEMS, updated);
    await enqueueSync(SyncOperationType.SYNC_INSPECTION_ITEM, id);

    return updated;
  },

  /** Mark as synced */
  async markSynced(id: string): Promise<void> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.INSPECTION_ITEMS, id);

    if (!existing) return;

    await db.put(IDB_STORE_NAMES.INSPECTION_ITEMS, {
      ...existing,
      isDirty: false,
      syncedAt: Date.now(),
    });
  },

  /** Get all dirty items */
  async getDirty(): Promise<LocalInspectionItem[]> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.INSPECTION_ITEMS);
    return all.filter((record) => record.isDirty);
  },

  /** Delete an item */
  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(IDB_STORE_NAMES.INSPECTION_ITEMS, id);
  },
};

// =============================================
// PENDING PHOTOS
// =============================================

export const pendingPhotos = {
  /** Store a photo for later upload to R2 */
  async add(photo: Omit<PendingPhoto, 'id' | 'synced' | 'r2_key' | 'r2_url'>): Promise<PendingPhoto> {
    const db = await getDB();
    const record: PendingPhoto = {
      ...photo,
      id: uuid(),
      synced: false,
      r2_key: null,
      r2_url: null,
    };

    await db.put(IDB_STORE_NAMES.PHOTOS_PENDING, record);
    await enqueueSync(SyncOperationType.UPLOAD_PHOTO, record.id);

    return record;
  },

  /** Get all photos for an inspection item */
  async getByItem(inspectionItemId: string): Promise<PendingPhoto[]> {
    const db = await getDB();
    return db.getAllFromIndex(IDB_STORE_NAMES.PHOTOS_PENDING, 'inspection_item_id', inspectionItemId);
  },

  /** Get all unsynced photos */
  async getUnsynced(): Promise<PendingPhoto[]> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.PHOTOS_PENDING);
    return all.filter((p) => !p.synced);
  },

  /** Mark photo as uploaded (store R2 references) */
  async markUploaded(id: string, r2Key: string, r2Url: string): Promise<void> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.PHOTOS_PENDING, id);

    if (!existing) return;

    await db.put(IDB_STORE_NAMES.PHOTOS_PENDING, {
      ...existing,
      synced: true,
      r2_key: r2Key,
      r2_url: r2Url,
    });
  },

  /** Remove synced photos to free storage */
  async purgeSynced(): Promise<number> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.PHOTOS_PENDING);
    const synced = all.filter((p) => p.synced);

    const tx = db.transaction(IDB_STORE_NAMES.PHOTOS_PENDING, 'readwrite');
    for (const photo of synced) {
      await tx.store.delete(photo.id);
    }
    await tx.done;

    return synced.length;
  },

  /** Delete a single photo */
  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(IDB_STORE_NAMES.PHOTOS_PENDING, id);
  },
};

// =============================================
// PENDING AUDIO
// =============================================

export const pendingAudio = {
  /** Store an audio recording for later transcription */
  async add(audio: Omit<PendingAudio, 'id' | 'synced' | 'r2_key'>): Promise<PendingAudio> {
    const db = await getDB();
    const record: PendingAudio = {
      ...audio,
      id: uuid(),
      synced: false,
      r2_key: null,
    };

    await db.put(IDB_STORE_NAMES.AUDIO_PENDING, record);
    await enqueueSync(SyncOperationType.UPLOAD_AUDIO, record.id);

    return record;
  },

  /** Get all unsynced audio recordings */
  async getUnsynced(): Promise<PendingAudio[]> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.AUDIO_PENDING);
    return all.filter((a) => !a.synced);
  },

  /** Get audio for a specific inspection item */
  async getByItem(inspectionItemId: string): Promise<PendingAudio[]> {
    const db = await getDB();
    return db.getAllFromIndex(IDB_STORE_NAMES.AUDIO_PENDING, 'inspection_item_id', inspectionItemId);
  },

  /** Mark audio as uploaded */
  async markUploaded(id: string, r2Key: string): Promise<void> {
    const db = await getDB();
    const existing = await db.get(IDB_STORE_NAMES.AUDIO_PENDING, id);

    if (!existing) return;

    await db.put(IDB_STORE_NAMES.AUDIO_PENDING, {
      ...existing,
      synced: true,
      r2_key: r2Key,
    });
  },

  /** Remove synced audio to free storage */
  async purgeSynced(): Promise<number> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.AUDIO_PENDING);
    const synced = all.filter((a) => a.synced);

    const tx = db.transaction(IDB_STORE_NAMES.AUDIO_PENDING, 'readwrite');
    for (const audio of synced) {
      await tx.store.delete(audio.id);
    }
    await tx.done;

    return synced.length;
  },
};

// =============================================
// SYNC QUEUE
// =============================================

/** Add an operation to the sync queue */
async function enqueueSync(
  type: SyncOperationType,
  entityId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const db = await getDB();
  const entry: SyncQueueEntry = {
    type,
    entity_id: entityId,
    payload,
    attempts: 0,
    max_attempts: 3,
    last_attempt_at: null,
    last_error: null,
    created_at: new Date().toISOString(),
  };

  await db.add(IDB_STORE_NAMES.SYNC_QUEUE, entry);
}

export const syncQueue = {
  /** Get all pending sync operations (FIFO order) */
  async getAll(): Promise<Array<SyncQueueEntry & { id: number }>> {
    const db = await getDB();
    const tx = db.transaction(IDB_STORE_NAMES.SYNC_QUEUE, 'readonly');
    const entries: Array<SyncQueueEntry & { id: number }> = [];

    let cursor = await tx.store.openCursor();
    while (cursor) {
      entries.push({ ...cursor.value, id: cursor.key as number });
      cursor = await cursor.continue();
    }

    return entries;
  },

  /** Get count of pending operations */
  async count(): Promise<number> {
    const db = await getDB();
    return db.count(IDB_STORE_NAMES.SYNC_QUEUE);
  },

  /** Remove a completed sync entry */
  async remove(id: number): Promise<void> {
    const db = await getDB();
    await db.delete(IDB_STORE_NAMES.SYNC_QUEUE, id);
  },

  /** Update attempt count and error for a failed entry */
  async recordAttempt(id: number, error: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(IDB_STORE_NAMES.SYNC_QUEUE, 'readwrite');

    let cursor = await tx.store.openCursor(id);
    if (cursor) {
      const entry = cursor.value;
      await cursor.update({
        ...entry,
        attempts: entry.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: error,
      });
    }

    await tx.done;
  },

  /** Remove entries that have exceeded max attempts (dead letter) */
  async purgeFailed(): Promise<SyncQueueEntry[]> {
    const db = await getDB();
    const tx = db.transaction(IDB_STORE_NAMES.SYNC_QUEUE, 'readwrite');
    const failed: SyncQueueEntry[] = [];

    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (cursor.value.attempts >= cursor.value.max_attempts) {
        failed.push(cursor.value);
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }

    await tx.done;
    return failed;
  },

  /** Clear the entire sync queue */
  async clear(): Promise<void> {
    const db = await getDB();
    await db.clear(IDB_STORE_NAMES.SYNC_QUEUE);
  },
};

// =============================================
// SITES CACHE
// =============================================

export const sitesCache = {
  /** Cache a site for offline access */
  async put(site: CachedSite['data']): Promise<void> {
    const db = await getDB();
    await db.put(IDB_STORE_NAMES.SITES_CACHE, {
      id: site.id,
      data: site,
      cachedAt: Date.now(),
    });
  },

  /** Cache multiple sites */
  async putMany(sites: Array<CachedSite['data']>): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(IDB_STORE_NAMES.SITES_CACHE, 'readwrite');

    for (const site of sites) {
      await tx.store.put({
        id: site.id,
        data: site,
        cachedAt: Date.now(),
      });
    }

    await tx.done;
  },

  /** Get a cached site */
  async get(id: string): Promise<CachedSite | undefined> {
    const db = await getDB();
    return db.get(IDB_STORE_NAMES.SITES_CACHE, id);
  },

  /** Get all cached sites */
  async getAll(): Promise<CachedSite[]> {
    const db = await getDB();
    return db.getAll(IDB_STORE_NAMES.SITES_CACHE);
  },

  /** Clear expired cache entries (older than maxAge ms) */
  async purgeExpired(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.SITES_CACHE);
    const cutoff = Date.now() - maxAgeMs;
    const expired = all.filter((s) => s.cachedAt < cutoff);

    const tx = db.transaction(IDB_STORE_NAMES.SITES_CACHE, 'readwrite');
    for (const site of expired) {
      await tx.store.delete(site.id);
    }
    await tx.done;

    return expired.length;
  },
};

// =============================================
// ASSETS CACHE
// =============================================

export const assetsCache = {
  /** Cache an asset for offline access */
  async put(asset: CachedAsset['data']): Promise<void> {
    const db = await getDB();
    await db.put(IDB_STORE_NAMES.ASSETS_CACHE, {
      id: asset.id,
      site_id: asset.site_id,
      data: asset,
      cachedAt: Date.now(),
    });
  },

  /** Cache multiple assets */
  async putMany(assets: Array<CachedAsset['data']>): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(IDB_STORE_NAMES.ASSETS_CACHE, 'readwrite');

    for (const asset of assets) {
      await tx.store.put({
        id: asset.id,
        site_id: asset.site_id,
        data: asset,
        cachedAt: Date.now(),
      });
    }

    await tx.done;
  },

  /** Get all cached assets for a site */
  async getBySite(siteId: string): Promise<CachedAsset[]> {
    const db = await getDB();
    return db.getAllFromIndex(IDB_STORE_NAMES.ASSETS_CACHE, 'site_id', siteId);
  },

  /** Get a single cached asset */
  async get(id: string): Promise<CachedAsset | undefined> {
    const db = await getDB();
    return db.get(IDB_STORE_NAMES.ASSETS_CACHE, id);
  },

  /** Clear expired cache entries */
  async purgeExpired(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const db = await getDB();
    const all = await db.getAll(IDB_STORE_NAMES.ASSETS_CACHE);
    const cutoff = Date.now() - maxAgeMs;
    const expired = all.filter((a) => a.cachedAt < cutoff);

    const tx = db.transaction(IDB_STORE_NAMES.ASSETS_CACHE, 'readwrite');
    for (const asset of expired) {
      await tx.store.delete(asset.id);
    }
    await tx.done;

    return expired.length;
  },
};

// =============================================
// STORAGE DIAGNOSTICS
// =============================================

export interface StorageDiagnostics {
  inspectionCount: number;
  inspectionItemCount: number;
  pendingPhotoCount: number;
  pendingAudioCount: number;
  syncQueueCount: number;
  sitesCacheCount: number;
  assetsCacheCount: number;
  estimatedStorageMB: number | null;
}

/** Get storage usage stats for diagnostics/settings UI */
export async function getStorageDiagnostics(): Promise<StorageDiagnostics> {
  const db = await getDB();

  const [
    inspectionCount,
    inspectionItemCount,
    pendingPhotoCount,
    pendingAudioCount,
    syncQueueCount,
    sitesCacheCount,
    assetsCacheCount,
  ] = await Promise.all([
    db.count(IDB_STORE_NAMES.INSPECTIONS),
    db.count(IDB_STORE_NAMES.INSPECTION_ITEMS),
    db.count(IDB_STORE_NAMES.PHOTOS_PENDING),
    db.count(IDB_STORE_NAMES.AUDIO_PENDING),
    db.count(IDB_STORE_NAMES.SYNC_QUEUE),
    db.count(IDB_STORE_NAMES.SITES_CACHE),
    db.count(IDB_STORE_NAMES.ASSETS_CACHE),
  ]);

  // Estimate storage usage if StorageManager available
  let estimatedStorageMB: number | null = null;
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage) {
        estimatedStorageMB = Math.round((estimate.usage / (1024 * 1024)) * 100) / 100;
      }
    } catch {
      // StorageManager not available
    }
  }

  return {
    inspectionCount,
    inspectionItemCount,
    pendingPhotoCount,
    pendingAudioCount,
    syncQueueCount,
    sitesCacheCount,
    assetsCacheCount,
    estimatedStorageMB,
  };
}

// =============================================
// DATABASE MAINTENANCE
// =============================================

/** Purge all synced media and expired caches to free storage */
export async function runStorageMaintenance(): Promise<{
  photosPurged: number;
  audioPurged: number;
  sitesExpired: number;
  assetsExpired: number;
  failedOps: SyncQueueEntry[];
}> {
  const [photosPurged, audioPurged, sitesExpired, assetsExpired, failedOps] =
    await Promise.all([
      pendingPhotos.purgeSynced(),
      pendingAudio.purgeSynced(),
      sitesCache.purgeExpired(),
      assetsCache.purgeExpired(),
      syncQueue.purgeFailed(),
    ]);

  return { photosPurged, audioPurged, sitesExpired, assetsExpired, failedOps };
}

/** Nuclear option — clear all local data. Use for sign-out or debug. */
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear(IDB_STORE_NAMES.INSPECTIONS),
    db.clear(IDB_STORE_NAMES.INSPECTION_ITEMS),
    db.clear(IDB_STORE_NAMES.PHOTOS_PENDING),
    db.clear(IDB_STORE_NAMES.AUDIO_PENDING),
    db.clear(IDB_STORE_NAMES.SYNC_QUEUE),
    db.clear(IDB_STORE_NAMES.SITES_CACHE),
    db.clear(IDB_STORE_NAMES.ASSETS_CACHE),
  ]);
}
