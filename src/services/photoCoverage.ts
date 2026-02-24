/**
 * InspectVoice — Photo Coverage & Cross-Reference Service
 * Feature 3: Evidence-grade photo coverage rules + cross-referencing
 *
 * Two responsibilities:
 *
 * 1. VALIDATION — Enforces minimum photo coverage rules before sign-off:
 *    - At least 1 photo per asset inspected
 *    - At least 1 photo per high/very-high defect
 *    - At least 1 overview photo per inspection
 *    - Warns (non-blocking) for medium defects without photos
 *
 * 2. CROSS-REFERENCING — Generates sequential photo numbers mapped to
 *    assets and defects for use in PDF reports. Every defect references
 *    its photo(s) by number; every photo references its defect/asset.
 *
 * Usage:
 *   const coverage = buildPhotoCoverage(items, photos);
 *   // coverage.validation — pass/fail with missing items
 *   // coverage.photoIndex — sequential numbering for PDF
 *   // coverage.crossRefs — defect→photo and photo→defect maps
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Photo, InspectionItem } from '@/types';
import { RiskRating } from '@/types';

// =============================================
// TYPES
// =============================================

/** A single validation rule result */
export interface CoverageRule {
  /** Rule identifier */
  id: string;
  /** Human-readable rule description */
  label: string;
  /** Whether this rule blocks sign-off */
  blocking: boolean;
  /** Whether the rule passed */
  passed: boolean;
  /** Items that are missing coverage */
  missing: CoverageMissing[];
}

export interface CoverageMissing {
  /** What's missing (asset code, defect description, etc.) */
  label: string;
  /** Entity type */
  type: 'asset' | 'defect' | 'overview';
  /** Entity ID for linking */
  entityId: string;
}

/** Overall validation result */
export interface CoverageValidation {
  /** All rules passed (no blocking failures) */
  canSignOff: boolean;
  /** Total rules checked */
  totalRules: number;
  /** Rules that passed */
  passedRules: number;
  /** Rules that failed (blocking) */
  failedRules: number;
  /** Rules that warned (non-blocking) */
  warningRules: number;
  /** Individual rule results */
  rules: CoverageRule[];
  /** Summary for UI display */
  summary: string;
}

/** Sequential photo index entry for PDF cross-referencing */
export interface PhotoIndexEntry {
  /** Sequential number (1, 2, 3…) */
  number: number;
  /** Photo ID */
  photoId: string;
  /** R2 key for fetching */
  r2Key: string;
  /** R2 URL (signed) */
  r2Url: string;
  /** Asset code this photo belongs to */
  assetCode: string;
  /** Asset type */
  assetType: string;
  /** Inspection item ID */
  inspectionItemId: string;
  /** Photo type (defect, overview, reference, completion) */
  photoType: string;
  /** Caption if set */
  caption: string | null;
  /** Whether this is the primary photo for the item */
  isPrimary: boolean;
  /** Defect descriptions this photo is associated with (may be empty for overview photos) */
  associatedDefects: string[];
  /** Display label for PDF: "Photo 3 — SW-01, Defect: worn chain link" */
  pdfLabel: string;
}

/** Cross-reference maps for linking defects ↔ photos in PDFs */
export interface PhotoCrossRefs {
  /** Map: inspection_item_id → photo numbers for that item */
  itemToPhotos: Map<string, number[]>;
  /** Map: defect index key (itemId:defectIdx) → photo numbers */
  defectToPhotos: Map<string, number[]>;
  /** Map: photo number → defect descriptions */
  photoToDefects: Map<number, string[]>;
  /** Formatted ref string for a defect: "See Photos 3, 4" or "No photo" */
  getDefectPhotoRef: (itemId: string, defectIdx: number) => string;
  /** Formatted ref string for an item: "Photos 1–4" */
  getItemPhotoRef: (itemId: string) => string;
}

/** Complete coverage result */
export interface PhotoCoverage {
  validation: CoverageValidation;
  photoIndex: PhotoIndexEntry[];
  crossRefs: PhotoCrossRefs;
  /** Total photos across the inspection */
  totalPhotos: number;
}

// =============================================
// MAIN FUNCTION
// =============================================

/**
 * Build complete photo coverage analysis for an inspection.
 *
 * @param items — Inspection items (one per asset checked)
 * @param photos — All photos for this inspection (across all items)
 * @returns Coverage validation, photo index, and cross-reference maps
 */
export function buildPhotoCoverage(
  items: InspectionItem[],
  photos: Photo[],
): PhotoCoverage {
  // Group photos by inspection_item_id
  const photosByItem = new Map<string, Photo[]>();
  for (const photo of photos) {
    const existing = photosByItem.get(photo.inspection_item_id) ?? [];
    existing.push(photo);
    photosByItem.set(photo.inspection_item_id, existing);
  }

  // Build sequential photo index
  const photoIndex = buildPhotoIndex(items, photosByItem);

  // Build cross-reference maps
  const crossRefs = buildCrossRefs(items, photosByItem, photoIndex);

  // Run validation rules
  const validation = runValidation(items, photosByItem);

  return {
    validation,
    photoIndex,
    crossRefs,
    totalPhotos: photos.length,
  };
}

// =============================================
// PHOTO INDEX (sequential numbering)
// =============================================

function buildPhotoIndex(
  items: InspectionItem[],
  photosByItem: Map<string, Photo[]>,
): PhotoIndexEntry[] {
  const index: PhotoIndexEntry[] = [];
  let seq = 1;

  // Sort items by asset code for consistent ordering
  const sortedItems = [...items].sort((a, b) => a.asset_code.localeCompare(b.asset_code));

  for (const item of sortedItems) {
    const itemPhotos = photosByItem.get(item.id) ?? [];

    // Sort photos: primary first, then by type (overview → defect → reference → completion), then by captured_at
    const sortedPhotos = [...itemPhotos].sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      const typeOrder: Record<string, number> = { overview: 0, defect: 1, reference: 2, completion: 3 };
      const aOrder = typeOrder[a.photo_type] ?? 9;
      const bOrder = typeOrder[b.photo_type] ?? 9;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
    });

    for (const photo of sortedPhotos) {
      // Determine associated defects
      const associatedDefects: string[] = [];
      if (photo.photo_type === 'defect' && item.defects.length > 0) {
        // Associate defect photos with defects on this item
        // If there's a caption matching a defect, use that; otherwise associate with all defects
        if (photo.caption) {
          const matchingDefect = item.defects.find((d) =>
            photo.caption?.toLowerCase().includes(d.description.substring(0, 30).toLowerCase()),
          );
          if (matchingDefect) {
            associatedDefects.push(matchingDefect.description);
          } else {
            // Caption doesn't match — associate with all defects
            for (const d of item.defects) {
              associatedDefects.push(d.description);
            }
          }
        } else {
          // No caption — associate with all defects on this item
          for (const d of item.defects) {
            associatedDefects.push(d.description);
          }
        }
      }

      // Build PDF label
      const parts: string[] = [`Photo ${seq}`, item.asset_code];
      if (photo.photo_type === 'overview') {
        parts.push('Overview');
      } else if (photo.photo_type === 'reference') {
        parts.push('Reference/Baseline');
      } else if (photo.photo_type === 'completion') {
        parts.push('Completion');
      } else if (associatedDefects.length > 0) {
        const shortDesc = associatedDefects[0]!.length > 60
          ? associatedDefects[0]!.substring(0, 57) + '...'
          : associatedDefects[0]!;
        parts.push(`Defect: ${shortDesc}`);
      }
      if (photo.caption && !associatedDefects.length) {
        parts.push(photo.caption);
      }

      index.push({
        number: seq,
        photoId: photo.id,
        r2Key: photo.r2_key,
        r2Url: photo.r2_url,
        assetCode: item.asset_code,
        assetType: item.asset_type,
        inspectionItemId: item.id,
        photoType: photo.photo_type,
        caption: photo.caption,
        isPrimary: photo.is_primary,
        associatedDefects,
        pdfLabel: parts.join(' — '),
      });

      seq++;
    }
  }

  return index;
}

// =============================================
// CROSS-REFERENCE MAPS
// =============================================

function buildCrossRefs(
  items: InspectionItem[],
  photosByItem: Map<string, Photo[]>,
  photoIndex: PhotoIndexEntry[],
): PhotoCrossRefs {
  // Item → photos
  const itemToPhotos = new Map<string, number[]>();
  for (const entry of photoIndex) {
    const existing = itemToPhotos.get(entry.inspectionItemId) ?? [];
    existing.push(entry.number);
    itemToPhotos.set(entry.inspectionItemId, existing);
  }

  // Defect → photos (key: "itemId:defectIdx")
  const defectToPhotos = new Map<string, number[]>();
  const photoToDefects = new Map<number, string[]>();

  for (const item of items) {
    const itemPhotos = photoIndex.filter((p) => p.inspectionItemId === item.id && p.photoType === 'defect');

    for (let dIdx = 0; dIdx < item.defects.length; dIdx++) {
      const defect = item.defects[dIdx]!;
      const key = `${item.id}:${dIdx}`;

      // Find photos associated with this defect
      const matchingPhotos = itemPhotos.filter((p) =>
        p.associatedDefects.some((d) => d === defect.description),
      );

      if (matchingPhotos.length > 0) {
        defectToPhotos.set(key, matchingPhotos.map((p) => p.number));
        for (const mp of matchingPhotos) {
          const existing = photoToDefects.get(mp.number) ?? [];
          existing.push(defect.description);
          photoToDefects.set(mp.number, existing);
        }
      } else if (itemPhotos.length > 0) {
        // Fall back: associate all defect photos from this item
        defectToPhotos.set(key, itemPhotos.map((p) => p.number));
        for (const ip of itemPhotos) {
          const existing = photoToDefects.get(ip.number) ?? [];
          existing.push(defect.description);
          photoToDefects.set(ip.number, existing);
        }
      }
    }
  }

  // Helper functions for formatted references
  function getDefectPhotoRef(itemId: string, defectIdx: number): string {
    const key = `${itemId}:${defectIdx}`;
    const nums = defectToPhotos.get(key);
    if (!nums || nums.length === 0) return 'No photo';
    if (nums.length === 1) return `See Photo ${nums[0]}`;
    return `See Photos ${nums.join(', ')}`;
  }

  function getItemPhotoRef(itemId: string): string {
    const nums = itemToPhotos.get(itemId);
    if (!nums || nums.length === 0) return 'No photos';
    if (nums.length === 1) return `Photo ${nums[0]}`;
    return `Photos ${nums[0]}–${nums[nums.length - 1]}`;
  }

  return {
    itemToPhotos,
    defectToPhotos,
    photoToDefects,
    getDefectPhotoRef,
    getItemPhotoRef,
  };
}

// =============================================
// VALIDATION RULES
// =============================================

function runValidation(
  items: InspectionItem[],
  photosByItem: Map<string, Photo[]>,
): CoverageValidation {
  const rules: CoverageRule[] = [];

  // ── Rule 1: At least 1 photo per asset inspected (blocking) ──
  const assetMissing: CoverageMissing[] = [];
  for (const item of items) {
    const photos = photosByItem.get(item.id) ?? [];
    if (photos.length === 0) {
      assetMissing.push({
        label: `${item.asset_code} (${item.asset_type}) — no photos`,
        type: 'asset',
        entityId: item.id,
      });
    }
  }

  rules.push({
    id: 'photo_per_asset',
    label: 'At least 1 photo per asset inspected',
    blocking: true,
    passed: assetMissing.length === 0,
    missing: assetMissing,
  });

  // ── Rule 2: At least 1 photo per high/very-high defect (blocking) ──
  const highDefectMissing: CoverageMissing[] = [];
  for (const item of items) {
    const photos = photosByItem.get(item.id) ?? [];
    const defectPhotos = photos.filter((p) => p.photo_type === 'defect');

    for (const defect of item.defects) {
      const isHighRisk = defect.risk_rating === RiskRating.VERY_HIGH || defect.risk_rating === RiskRating.HIGH;
      if (isHighRisk && defectPhotos.length === 0) {
        highDefectMissing.push({
          label: `${item.asset_code}: "${defect.description.substring(0, 60)}" (${defect.risk_rating}) — no defect photo`,
          type: 'defect',
          entityId: item.id,
        });
      }
    }
  }

  rules.push({
    id: 'photo_per_high_defect',
    label: 'At least 1 photo per high/very-high risk defect',
    blocking: true,
    passed: highDefectMissing.length === 0,
    missing: highDefectMissing,
  });

  // ── Rule 3: At least 1 overview photo in the inspection (blocking) ──
  let hasOverview = false;
  for (const photos of photosByItem.values()) {
    if (photos.some((p) => p.photo_type === 'overview')) {
      hasOverview = true;
      break;
    }
  }

  rules.push({
    id: 'overview_photo',
    label: 'At least 1 overview photo per inspection',
    blocking: true,
    passed: hasOverview,
    missing: hasOverview ? [] : [{
      label: 'No overview photo taken — capture at least one general site photo',
      type: 'overview',
      entityId: 'inspection',
    }],
  });

  // ── Rule 4: Photo per medium defect (warning, non-blocking) ──
  const mediumDefectMissing: CoverageMissing[] = [];
  for (const item of items) {
    const photos = photosByItem.get(item.id) ?? [];
    const defectPhotos = photos.filter((p) => p.photo_type === 'defect');

    for (const defect of item.defects) {
      if (defect.risk_rating === RiskRating.MEDIUM && defectPhotos.length === 0) {
        mediumDefectMissing.push({
          label: `${item.asset_code}: "${defect.description.substring(0, 60)}" (medium) — no defect photo`,
          type: 'defect',
          entityId: item.id,
        });
      }
    }
  }

  rules.push({
    id: 'photo_per_medium_defect',
    label: 'Photo recommended for medium risk defects',
    blocking: false,
    passed: mediumDefectMissing.length === 0,
    missing: mediumDefectMissing,
  });

  // ── Rule 5: At least 2 photos per asset with defects (warning) ──
  const multiPhotoMissing: CoverageMissing[] = [];
  for (const item of items) {
    if (item.defects.length > 0) {
      const photos = photosByItem.get(item.id) ?? [];
      if (photos.length < 2) {
        multiPhotoMissing.push({
          label: `${item.asset_code} — has ${item.defects.length} defect(s) but only ${photos.length} photo(s). Consider adding overview + close-up.`,
          type: 'asset',
          entityId: item.id,
        });
      }
    }
  }

  rules.push({
    id: 'multi_photo_defective_asset',
    label: 'At least 2 photos for assets with defects (overview + close-up)',
    blocking: false,
    passed: multiPhotoMissing.length === 0,
    missing: multiPhotoMissing,
  });

  // ── Aggregate ──
  const blockingFailed = rules.filter((r) => r.blocking && !r.passed);
  const warnings = rules.filter((r) => !r.blocking && !r.passed);

  const canSignOff = blockingFailed.length === 0;

  let summary: string;
  if (canSignOff && warnings.length === 0) {
    summary = 'All photo coverage rules passed. Ready to sign off.';
  } else if (canSignOff) {
    summary = `Photo coverage sufficient for sign-off. ${warnings.length} recommendation${warnings.length !== 1 ? 's' : ''} for improvement.`;
  } else {
    const missingCount = blockingFailed.reduce((sum, r) => sum + r.missing.length, 0);
    summary = `Cannot sign off: ${missingCount} required photo${missingCount !== 1 ? 's' : ''} missing across ${blockingFailed.length} rule${blockingFailed.length !== 1 ? 's' : ''}.`;
  }

  return {
    canSignOff,
    totalRules: rules.length,
    passedRules: rules.filter((r) => r.passed).length,
    failedRules: blockingFailed.length,
    warningRules: warnings.length,
    rules,
    summary,
  };
}

// =============================================
// UTILITY: FORMAT PHOTO REF FOR DISPLAY
// =============================================

/**
 * Format a compact photo reference string for table cells.
 * e.g., "P3, P4" or "P1–P5" for contiguous ranges.
 */
export function formatCompactPhotoRef(numbers: number[]): string {
  if (numbers.length === 0) return '—';
  if (numbers.length === 1) return `P${numbers[0]}`;

  // Check if contiguous
  const sorted = [...numbers].sort((a, b) => a - b);
  const isContiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);

  if (isContiguous && sorted.length > 2) {
    return `P${sorted[0]}–P${sorted[sorted.length - 1]}`;
  }

  return sorted.map((n) => `P${n}`).join(', ');
}
