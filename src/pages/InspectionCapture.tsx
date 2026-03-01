/**
 * InspectVoice — Inspection Capture Workflow
 * Batch 14 + Feature 5 (Baseline photo comparison) + Feature 15 (Defect Quick-Pick)
 *
 * Route: /sites/:siteId/inspections/:inspectionId/capture
 *
 * The core product page. Inspector works through assets one by one:
 *   1. See asset info + checklist for this inspection type
 *   2. Voice capture → live transcript + audio blob stored
 *   3. Photo capture → compressed JPEG stored
 *   4. Baseline comparison (if baseline exists for this asset)
 *   5. Manual text entry (fallback / additional notes)
 *   6. Condition rating per asset
 *   7. Save inspection item to IndexedDB
 *   8. Navigate to next asset
 *   9. When all assets done → navigate to Review
 *
 * Features:
 *   - Asset-by-asset stepper with progress bar
 *   - Voice recording with VU meter + live transcript
 *   - Photo capture via camera or file input
 *   - Baseline vs current photo comparison slider
 *   - Checklist driven by assetTypes.ts config per inspection cadence
 *   - Per-asset condition rating (Good/Fair/Poor/Dangerous)
 *   - Inspector notes (manual text)
 *   - Auto-save to IndexedDB on asset completion
 *   - Resume: loads existing items if partially completed
 *   - Offline-first: zero network required
 *   - Dark theme, mobile-first, accessible
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Mic,
  Camera,
  ImagePlus,
  FileText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Pause,
  Square,
  Trash2,
  X,
  Eye,
  Info,
  BookOpen,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';

import { inspections, inspectionItems, assetsCache, pendingPhotos, pendingAudio } from '@services/offlineStore';
import {
  createVoiceCapture,
  checkBrowserCapabilities,
  formatDuration,
  VoiceCaptureState,
  StopReason,
} from '@services/voiceCapture';
import type { VoiceCapture, VoiceCaptureResult, BrowserCapabilities } from '@services/voiceCapture';
import { processPhotoFile } from '@services/photoCapture';
import type { PhotoCaptureResult } from '@services/photoCapture';
import { captureError } from '@utils/errorTracking';
import {
  ConditionRating,
  CONDITION_LABELS,
  InspectionType,
  INSPECTION_TYPE_LABELS,
  AIProcessingStatus,
  TranscriptionMethod,
  RISK_RATING_LABELS,
  RiskRating,
  ACTION_TIMEFRAME_LABELS,
  ActionTimeframe,
  CostBand,
} from '@/types';
import type { Asset, Inspection, InspectionItem, DefectDetail } from '@/types';
import { getAssetTypeConfig, getInspectionPointsForType } from '@config/assetTypes';
import type { InspectionPoint } from '@config/assetTypes';
import BaselineComparison from '@components/BaselineComparison';
import type { BaselinePhoto, CurrentPhoto } from '@components/BaselineComparison';
import DefectQuickPick from '@components/DefectQuickPick';
import type { QuickPickSelection } from '@components/DefectQuickPick';

// =============================================
// TYPES
// =============================================

/** Working state for the current asset being inspected */
interface AssetCaptureState {
  /** Checklist completion per point */
  checklistCompleted: Record<number, boolean>;
  /** Voice transcript (from Web Speech API live preview) */
  voiceTranscript: string;
  /** Whether audio has been recorded for this asset */
  hasAudioRecording: boolean;
  /** Audio blob stored locally */
  audioBlobId: string | null;
  /** Photos captured */
  photoIds: string[];
  /** Manual notes */
  notes: string;
  /** Condition rating */
  condition: ConditionRating | null;
  /** Whether this asset's data has been saved */
  saved: boolean;
  /** Feature 15: manually selected defects from library */
  manualDefects: DefectDetail[];
}

function createEmptyCaptureState(): AssetCaptureState {
  return {
    checklistCompleted: {},
    voiceTranscript: '',
    hasAudioRecording: false,
    audioBlobId: null,
    photoIds: [],
    notes: '',
    condition: null,
    saved: false,
    manualDefects: [],
  };
}

// =============================================
// CONDITION COLOURS
// =============================================

function conditionBtnClass(rating: ConditionRating, isSelected: boolean): string {
  const base = 'px-3 py-2 rounded-lg border text-sm font-medium transition-all';
  if (!isSelected) return `${base} border-[#2A2F3A] bg-[#151920] iv-text hover:border-[#3A3F4A]`;

  switch (rating) {
    case ConditionRating.GOOD:
      return `${base} border-[#22C55E] bg-[#22C55E]/15 text-[#22C55E]`;
    case ConditionRating.FAIR:
      return `${base} border-[#EAB308] bg-[#EAB308]/15 text-[#EAB308]`;
    case ConditionRating.POOR:
      return `${base} border-[#F97316] bg-[#F97316]/15 text-[#F97316]`;
    case ConditionRating.DANGEROUS:
      return `${base} border-[#EF4444] bg-[#EF4444]/15 text-[#EF4444]`;
  }
}

// =============================================
// VU METER COMPONENT
// =============================================

function VuMeter({ level }: { level: number }): JSX.Element {
  const bars = 20;
  const activeBars = Math.round(level * bars);

  return (
    <div className="flex items-end gap-0.5 h-8" aria-label={`Audio level: ${Math.round(level * 100)}%`}>
      {Array.from({ length: bars }, (_, i) => {
        const isActive = i < activeBars;
        const colour =
          i < bars * 0.6 ? 'bg-[#22C55E]' :
          i < bars * 0.85 ? 'bg-[#EAB308]' :
          'bg-[#EF4444]';
        return (
          <div
            key={i}
            className={`w-1.5 rounded-sm transition-all duration-75 ${
              isActive ? colour : 'bg-[#2A2F3A]'
            }`}
            style={{ height: `${((i + 1) / bars) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

// =============================================
// PHOTO THUMBNAIL COMPONENT
// =============================================

function PhotoThumbnail({
  base64,
  onRemove,
}: {
  base64: string;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="relative group w-16 h-16 rounded-lg overflow-hidden border border-[#2A2F3A]">
      <img
        src={`data:image/jpeg;base64,${base64}`}
        alt="Captured photo"
        className="w-full h-full object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Remove photo"
      >
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function InspectionCapture(): JSX.Element {
  const { siteId, inspectionId } = useParams<{ siteId: string; inspectionId: string }>();
  const navigate = useNavigate();

  // ---- Loading ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- Data ----
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [existingItems, setExistingItems] = useState<Map<string, InspectionItem>>(new Map());

  // ---- Navigation ----
  const [currentIndex, setCurrentIndex] = useState(0);

  // ---- Capture state per asset ----
  const [captureState, setCaptureState] = useState<AssetCaptureState>(createEmptyCaptureState());

  // ---- Voice capture ----
  const [voiceState, setVoiceState] = useState<VoiceCaptureState>(VoiceCaptureState.IDLE);
  const [vuLevel, setVuLevel] = useState(0);
  const [recordDuration, setRecordDuration] = useState(0);
  const [browserCaps, setBrowserCaps] = useState<BrowserCapabilities | null>(null);
  const voiceCaptureRef = useRef<VoiceCapture | null>(null);

  // ---- Photo state ----
  const [photoThumbnails, setPhotoThumbnails] = useState<Array<{ id: string; base64: string }>>([]);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Baseline comparison ----
  const [settingBaseline, setSettingBaseline] = useState(false);
/** The first captured photo's full base64 for comparison display */
const [firstPhotoBase64, setFirstPhotoBase64] = useState<string | null>(null);
/** Locally-set baseline (avoids mutating assets array which causes re-render crash) */
const [localBaseline, setLocalBaseline] = useState<BaselinePhoto | null>(null);

  // ---- Feature 15: Defect Quick-Pick ----
  const [showQuickPick, setShowQuickPick] = useState(false);

  // ---- Saving ----
  const [saving, setSaving] = useState(false);

  // ---- Derived ----
  const currentAsset = assets[currentIndex] ?? null;
  const totalAssets = assets.length;

  const inspectionType = inspection?.inspection_type ?? InspectionType.ROUTINE_VISUAL;
  const checklistPoints: InspectionPoint[] = currentAsset
    ? getInspectionPointsForType(
        currentAsset.asset_type,
        inspectionType as 'routine_visual' | 'operational' | 'annual_main',
      )
    : [];

  // ---- Baseline data for current asset ----
  // These fields come from migration 003 — cast needed until Asset type is updated
  const assetRecord = currentAsset ? (currentAsset as unknown as Record<string, unknown>) : null;
  const serverBaseline: BaselinePhoto | null = assetRecord?.['baseline_photo_url']
    ? {
        src: assetRecord['baseline_photo_url'] as string,
        takenAt: (assetRecord['baseline_photo_taken_at'] as string) ?? new Date().toISOString(),
        takenBy: (assetRecord['baseline_photo_taken_by'] as string) ?? 'Unknown',
        condition: (assetRecord['baseline_condition'] as ConditionRating) ?? null,
      }
    : null;

  // Local baseline takes priority (set via "Set as Baseline" button)
  const baselinePhoto = localBaseline ?? serverBaseline;

  const currentPhoto: CurrentPhoto | null = firstPhotoBase64
    ? {
        src: `data:image/jpeg;base64,${firstPhotoBase64}`,
        capturedAt: new Date().toISOString(),
      }
    : null;

  // ---- Check browser capabilities ----
  useEffect(() => {
    setBrowserCaps(checkBrowserCapabilities());
  }, []);

  // ---- Load inspection + assets ----
  useEffect(() => {
    if (!siteId || !inspectionId) return;

    let cancelled = false;

    async function loadData(): Promise<void> {
      try {
        const [localInspection, cachedAssets] = await Promise.all([
          inspections.get(inspectionId!),
          assetsCache.getBySite(siteId!),
        ]);

        if (cancelled) return;

        if (!localInspection) {
          setLoadError('Inspection not found. It may not have been created correctly.');
          setLoading(false);
          return;
        }

        const activeAssets = cachedAssets
          .map((ca) => ca.data)
          .filter((a) => a.is_active)
          .sort((a, b) => a.asset_code.localeCompare(b.asset_code));

        if (activeAssets.length === 0) {
          setLoadError('No active assets found for this site.');
          setLoading(false);
          return;
        }

        setInspection(localInspection.data);
        setAssets(activeAssets);

        // Load existing inspection items (for resume)
        try {
          const items = await inspectionItems.getByInspection(inspectionId!);
          const itemMap = new Map<string, InspectionItem>();
          for (const item of items) {
            const key = item.data.asset_id ?? item.data.asset_code;
            itemMap.set(key, item.data);
          }
          setExistingItems(itemMap);

          // Find first uncompleted asset
          const firstIncomplete = activeAssets.findIndex(
            (a) => !itemMap.has(a.id) && !itemMap.has(a.asset_code),
          );
          if (firstIncomplete > 0) {
            setCurrentIndex(firstIncomplete);
          }
        } catch (itemError) {
          captureError(itemError, { module: 'InspectionCapture', operation: 'loadItems' });
        }

        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        captureError(error, { module: 'InspectionCapture', operation: 'loadData' });
        setLoadError('Failed to load inspection data.');
        setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [siteId, inspectionId]);

  // ---- Load existing data when asset changes ----
  // FIX: Depend on currentAsset?.id (stable string) instead of currentAsset (object reference)
  // This prevents handleSetBaseline → setAssets → Object.assign from triggering this effect
  // and wiping firstPhotoBase64, which caused the React error #310 black screen crash.
  useEffect(() => {
    if (!currentAsset) return;

    const existing = existingItems.get(currentAsset.id) ?? existingItems.get(currentAsset.asset_code);
    if (existing) {
      setCaptureState({
        checklistCompleted: {},
        voiceTranscript: existing.voice_transcript ?? '',
        hasAudioRecording: Boolean(existing.audio_r2_key),
        audioBlobId: null,
        photoIds: [],
        notes: existing.inspector_notes ?? '',
        condition: existing.overall_condition,
        saved: true,
        manualDefects: existing.defects ?? [],
      });
    } else {
      setCaptureState(createEmptyCaptureState());
    }

    setPhotoThumbnails([]);
    setFirstPhotoBase64(null);
    setLocalBaseline(null);
    setVuLevel(0);
    setRecordDuration(0);
    setVoiceState(VoiceCaptureState.IDLE);
    setShowQuickPick(false);

    // Cleanup any active voice capture
    if (voiceCaptureRef.current) {
      voiceCaptureRef.current.cancel();
      voiceCaptureRef.current = null;
    }
  }, [currentIndex, currentAsset?.id, existingItems]);

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      if (voiceCaptureRef.current) {
        voiceCaptureRef.current.destroy();
      }
    };
  }, []);

  // =============================================
  // VOICE CAPTURE HANDLERS
  // =============================================

  const handleStartRecording = useCallback(async () => {
    if (!currentAsset) return;

    const capture = createVoiceCapture(
      { silenceTimeoutMs: 5000, language: 'en-GB' },
      {
        onStateChange: (state) => setVoiceState(state),
        onTranscript: (text) => {
          setCaptureState((prev) => ({ ...prev, voiceTranscript: text }));
        },
        onAmplitude: (level) => setVuLevel(level),
        onDurationTick: (seconds) => setRecordDuration(seconds),
        onComplete: (result: VoiceCaptureResult) => {
          void handleRecordingComplete(result);
        },
        onError: () => {
          setVoiceState(VoiceCaptureState.ERROR);
        },
      },
    );

    voiceCaptureRef.current = capture;
    await capture.start();
  }, [currentAsset]);

  const handleStopRecording = useCallback(async () => {
    if (!voiceCaptureRef.current) return;
    await voiceCaptureRef.current.stop(StopReason.USER);
  }, []);

  const handlePauseRecording = useCallback(() => {
    voiceCaptureRef.current?.pause();
  }, []);

  const handleResumeRecording = useCallback(() => {
    voiceCaptureRef.current?.resume();
  }, []);

  const handleRecordingComplete = useCallback(async (result: VoiceCaptureResult) => {
    if (!currentAsset || !inspectionId) return;

    try {
      const audioRecord = await pendingAudio.add({
        inspection_item_id: '', // Set when inspection item is created
        asset_id: currentAsset.id, 
        audioBlob: result.audioBlob,
        duration_seconds: result.durationSeconds,
        mime_type: result.mimeType,
        asset_code: currentAsset.asset_code,
        asset_type: currentAsset.asset_type,
        timestamp: result.startedAt,
      });

      setCaptureState((prev) => ({
        ...prev,
        hasAudioRecording: true,
        audioBlobId: audioRecord.id,
        voiceTranscript: result.liveTranscript || prev.voiceTranscript,
      }));
    } catch (error) {
      captureError(error, { module: 'InspectionCapture', operation: 'saveAudio' });
    }
  }, [currentAsset, inspectionId]);

  const handleClearRecording = useCallback(() => {
    setCaptureState((prev) => ({
      ...prev,
      voiceTranscript: '',
      hasAudioRecording: false,
      audioBlobId: null,
    }));
    setRecordDuration(0);
    setVuLevel(0);
  }, []);

  // =============================================
  // PHOTO CAPTURE HANDLERS
  // =============================================

  // FIX: Use functional updater for setFirstPhotoBase64 to avoid stale closure.
  // Previously depended on captureState.photoIds.length which could be stale
  // on rapid photo captures, causing firstPhotoBase64 to be overwritten.
  const handlePhotoCapture = useCallback(async (file: File) => {
    if (!currentAsset) return;

    setPhotoProcessing(true);
    try {
      const result: PhotoCaptureResult = await processPhotoFile(file);

      const photoRecord = await pendingPhotos.add({
        inspection_item_id: '', // Set when inspection item is created
        asset_id: currentAsset.id,
        base64Data: result.base64Data,
        mime_type: result.mimeType,
        file_size_bytes: result.fileSizeBytes,
        captured_at: result.capturedAt,
        latitude: result.latitude,
        longitude: result.longitude,
        is_reference_photo: false,
        caption: null,
      });

      setCaptureState((prev) => ({
        ...prev,
        photoIds: [...prev.photoIds, photoRecord.id],
      }));

      setPhotoThumbnails((prev) => [
        ...prev,
        { id: photoRecord.id, base64: result.thumbnailBase64 || result.base64Data.substring(0, 500) },
      ]);

      // Store first photo's full base64 for baseline comparison display
      // Functional updater: only set if no photo stored yet (prev === null)
      setFirstPhotoBase64((prev) => (prev === null ? result.base64Data : prev));
    } catch (error) {
      captureError(error, { module: 'InspectionCapture', operation: 'capturePhoto' });
    } finally {
      setPhotoProcessing(false);
    }
  }, [currentAsset]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handlePhotoCapture(file);
      }
      // Reset input so same file can be re-selected
      e.target.value = '';
    },
    [handlePhotoCapture],
  );

  const handleRemovePhoto = useCallback((photoId: string) => {
    setCaptureState((prev) => ({
      ...prev,
      photoIds: prev.photoIds.filter((id) => id !== photoId),
    }));
    setPhotoThumbnails((prev) => prev.filter((p) => p.id !== photoId));

    // If removing the first photo, clear the comparison
    if (photoThumbnails.length <= 1) {
      setFirstPhotoBase64(null);
    }

    // Delete from IndexedDB
    void pendingPhotos.delete(photoId).catch((error) => {
      captureError(error, { module: 'InspectionCapture', operation: 'deletePhoto' });
    });
  }, [photoThumbnails.length]);

  // =============================================
  // SET AS BASELINE HANDLER
  // =============================================

  const handleSetBaseline = useCallback(async () => {
    if (!currentAsset || !firstPhotoBase64 || !inspectionId) return;

    setSettingBaseline(true);
    try {
      const now = new Date().toISOString();

      // Store baseline in local state — avoids mutating assets array
      // which previously caused a re-render cascade and React error #310
      setLocalBaseline({
        src: `data:image/jpeg;base64,${firstPhotoBase64}`,
        takenAt: now,
        takenBy: 'Inspector',
        condition: captureState.condition,
      });

      // Persist baseline photo to IndexedDB pending queue for sync
      try {
        await pendingPhotos.add({
          inspection_item_id: '',
          asset_id: currentAsset.id,
          base64Data: firstPhotoBase64,
          mime_type: 'image/jpeg',
          file_size_bytes: Math.ceil(firstPhotoBase64.length * 0.75),
          captured_at: now,
          latitude: null,
          longitude: null,
          is_reference_photo: true,
          caption: `Baseline photo for ${currentAsset.asset_code}`,
        });
      } catch (photoError) {
        captureError(photoError, { module: 'InspectionCapture', operation: 'saveBaselinePhoto' });
      }
    } catch (error) {
      captureError(error, { module: 'InspectionCapture', operation: 'setBaseline' });
    } finally {
      setSettingBaseline(false);
    }
  }, [currentAsset, firstPhotoBase64, inspectionId, captureState.condition]);

  // =============================================
  // CHECKLIST HANDLER
  // =============================================

  const handleChecklistToggle = useCallback((index: number) => {
    setCaptureState((prev) => ({
      ...prev,
      checklistCompleted: {
        ...prev.checklistCompleted,
        [index]: !prev.checklistCompleted[index],
      },
    }));
  }, []);

  // =============================================
  // FEATURE 15: DEFECT QUICK-PICK HANDLERS
  // =============================================

  const handleQuickPickSelect = useCallback((selection: QuickPickSelection) => {
    const defect: DefectDetail = {
      description: selection.description,
      bs_en_reference: selection.bs_en_reference,
      risk_rating: selection.risk_rating as RiskRating,
      remedial_action: selection.remedial_action,
      action_timeframe: (selection.action_timeframe ?? 'routine') as ActionTimeframe,
      estimated_cost_band: (selection.estimated_cost_band ?? 'low') as CostBand,
    };

    setCaptureState((prev) => ({
      ...prev,
      manualDefects: [...prev.manualDefects, defect],
    }));
  }, []);

  const handleRemoveManualDefect = useCallback((index: number) => {
    setCaptureState((prev) => ({
      ...prev,
      manualDefects: prev.manualDefects.filter((_, i) => i !== index),
    }));
  }, []);

  // =============================================
  // SAVE CURRENT ASSET
  // =============================================

  const handleSaveAsset = useCallback(async () => {
    if (!currentAsset || !inspectionId || !inspection) return;

    setSaving(true);

    try {
      const itemId = uuid();
      const now = new Date().toISOString();

      const itemData: InspectionItem = {
        id: itemId,
        inspection_id: inspectionId,
        asset_id: currentAsset.id,
        asset_code: currentAsset.asset_code,
        asset_type: currentAsset.asset_type,
        audio_r2_key: null, // Set after R2 upload
        voice_transcript: captureState.voiceTranscript || null,
        transcription_method: captureState.hasAudioRecording ? TranscriptionMethod.WEB_SPEECH_API : captureState.voiceTranscript ? TranscriptionMethod.MANUAL : null,
        ai_analysis: null,
        ai_model_version: '',
        ai_processing_status: AIProcessingStatus.PENDING,
        ai_processed_at: null,
        defects: captureState.manualDefects,
        overall_condition: captureState.condition,
        risk_rating: null, // Set by AI analysis
        requires_action: captureState.manualDefects.some(
          (d) => d.risk_rating === RiskRating.VERY_HIGH || d.risk_rating === RiskRating.HIGH,
        ),
        action_timeframe: null,
        inspector_confirmed: false,
        inspector_notes: captureState.notes || null,
        inspector_risk_override: null,
        latitude: null,
        longitude: null,
        timestamp: now,
        created_at: now,
      };

      await inspectionItems.create(itemData);
      // Link pending photos to this inspection item
      for (const photoId of captureState.photoIds) {
        await pendingPhotos.linkToItem(photoId, itemId);
      }

      // Link pending audio to this inspection item
      if (captureState.audioBlobId) {
        await pendingAudio.linkToItem(captureState.audioBlobId, itemId);
      }

      // Update the existing items map
      setExistingItems((prev) => {
        const next = new Map(prev);
        next.set(currentAsset.id, itemData);
        return next;
      });

      setCaptureState((prev) => ({ ...prev, saved: true }));

      // Auto-advance to next asset if not the last
      if (currentIndex < totalAssets - 1) {
        setCurrentIndex((prev) => prev + 1);
      }
    } catch (error) {
      captureError(error, { module: 'InspectionCapture', operation: 'saveItem' });
    } finally {
      setSaving(false);
    }
  }, [currentAsset, inspectionId, inspection, captureState, currentIndex, totalAssets]);

  // =============================================
  // NAVIGATION
  // =============================================

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      // Cancel active recording
      voiceCaptureRef.current?.cancel();
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < totalAssets - 1) {
      voiceCaptureRef.current?.cancel();
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, totalAssets]);

  const handleFinish = useCallback(() => {
    voiceCaptureRef.current?.cancel();
    navigate(`/sites/${siteId}/inspections/${inspectionId}/review`, { replace: true });
  }, [navigate, siteId, inspectionId]);

  // ---- Count saved assets ----
  const savedCount = assets.filter(
    (a) => existingItems.has(a.id) || existingItems.has(a.asset_code),
  ).length;
  const allDone = savedCount >= totalAssets;

  // =============================================
  // RENDER: LOADING / ERROR
  // =============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet>
          <title>Loading Inspection... | InspectVoice</title>
        </Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 iv-muted animate-spin" />
          <p className="iv-muted text-sm">Loading inspection...</p>
        </div>
      </div>
    );
  }

  if (loadError || !inspection || !siteId || !inspectionId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Helmet>
          <title>Error | InspectVoice</title>
        </Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">Cannot Load Inspection</h2>
          <p className="iv-muted text-sm mb-4">{loadError ?? 'Data missing.'}</p>
          <Link
            to={siteId ? `/sites/${siteId}` : '/sites'}
            className="iv-btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>
      </div>
    );
  }

  if (!currentAsset) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="iv-panel p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-[#22C55E] mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">No Assets to Inspect</h2>
          <Link
            to={`/sites/${siteId}`}
            className="iv-btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Site
          </Link>
        </div>
      </div>
    );
  }

  // =============================================
  // RENDER: MAIN CAPTURE UI
  // =============================================

  const assetConfig = getAssetTypeConfig(currentAsset.asset_type);
  const assetTypeName = assetConfig?.name ?? currentAsset.asset_type;
  const isCurrentSaved =
    captureState.saved ||
    existingItems.has(currentAsset.id) ||
    existingItems.has(currentAsset.asset_code);
  const isRecording = voiceState === VoiceCaptureState.RECORDING;
  const isPaused = voiceState === VoiceCaptureState.PAUSED;
  const hasCapture = captureState.voiceTranscript || captureState.hasAudioRecording || captureState.notes || captureState.condition || captureState.manualDefects.length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <Helmet>
        <title>Inspecting {currentAsset.asset_code} | InspectVoice</title>
      </Helmet>

      {/* Hidden file input for photos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link
            to={`/sites/${siteId}`}
            className="iv-btn-icon"
            aria-label="Exit inspection"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <p className="text-xs iv-muted">
              {INSPECTION_TYPE_LABELS[inspection.inspection_type]} Inspection
            </p>
            <p className="text-sm font-semibold iv-text">
              Asset {currentIndex + 1} of {totalAssets}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs iv-muted">{savedCount}/{totalAssets} completed</p>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="w-full h-1.5 bg-[#2A2F3A] rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-[#22C55E] rounded-full transition-all duration-300"
          style={{ width: `${Math.round((savedCount / totalAssets) * 100)}%` }}
        />
      </div>

      {/* ── Asset stepper dots ── */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {assets.map((a, idx) => {
          const isDone = existingItems.has(a.id) || existingItems.has(a.asset_code);
          const isCurrent = idx === currentIndex;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                voiceCaptureRef.current?.cancel();
                setCurrentIndex(idx);
              }}
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all ${
                isCurrent
                  ? 'bg-[#22C55E] text-white ring-2 ring-[#22C55E]/30'
                  : isDone
                    ? 'bg-[#22C55E]/20 text-[#22C55E]'
                    : 'bg-[#2A2F3A] iv-muted hover:bg-[#3A3F4A]'
              }`}
              aria-label={`Asset ${idx + 1}: ${a.asset_code}${isDone ? ' (completed)' : ''}`}
              title={a.asset_code}
            >
              {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
            </button>
          );
        })}
      </div>

      {/* ── Current Asset Info ── */}
      <div className="iv-panel p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold iv-text">{currentAsset.asset_code}</h2>
            <p className="text-sm iv-muted">{assetTypeName}</p>
          </div>
          {isCurrentSaved && (
            <span className="flex items-center gap-1 text-xs text-[#22C55E] font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Saved
            </span>
          )}
        </div>
        {assetConfig?.complianceStandard && (
          <p className="text-xs text-[#22C55E] mt-1">{assetConfig.complianceStandard}</p>
        )}
      </div>

      {/* ── Checklist ── */}
      {checklistPoints.length > 0 && (
        <div className="iv-panel p-4 mb-4">
          <h3 className="text-sm font-semibold iv-text mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#22C55E]" />
            Inspection Checklist
          </h3>
          <div className="space-y-2">
            {checklistPoints.map((point, idx) => (
              <label
                key={idx}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#1C2029] cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={Boolean(captureState.checklistCompleted[idx])}
                  onChange={() => handleChecklistToggle(idx)}
                  className="mt-0.5 w-4 h-4 rounded border-[#2A2F3A] bg-[#151920] text-[#22C55E] focus:ring-[#22C55E] focus:ring-offset-0"
                />
                <div>
                  <p className="text-sm iv-text">{point.label}</p>
                  <p className="text-xs iv-muted mt-0.5">{point.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Voice Capture ── */}
      <div className="iv-panel p-4 mb-4">
        <h3 className="text-sm font-semibold iv-text mb-3 flex items-center gap-2">
          <Mic className="w-4 h-4 text-[#22C55E]" />
          Voice Capture
          {!browserCaps?.mediaRecorder && (
            <span className="text-xs iv-muted font-normal">(not supported)</span>
          )}
        </h3>

        {/* Recording controls */}
        <div className="flex items-center gap-3 mb-3">
          {!isRecording && !isPaused && (
            <button
              type="button"
              onClick={handleStartRecording}
              disabled={!browserCaps?.mediaRecorder}
              className="iv-btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <Mic className="w-4 h-4" />
              Record
            </button>
          )}

          {isRecording && (
            <>
              <button
                type="button"
                onClick={handlePauseRecording}
                className="iv-btn-secondary flex items-center gap-2"
              >
                <Pause className="w-4 h-4" />
                Pause
              </button>
              <button
                type="button"
                onClick={handleStopRecording}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#EF4444] text-white text-sm font-medium hover:bg-[#DC2626] transition-colors"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                type="button"
                onClick={handleResumeRecording}
                className="iv-btn-primary flex items-center gap-2"
              >
                <Mic className="w-4 h-4" />
                Resume
              </button>
              <button
                type="button"
                onClick={handleStopRecording}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#EF4444] text-white text-sm font-medium hover:bg-[#DC2626] transition-colors"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            </>
          )}

          {captureState.hasAudioRecording && !isRecording && !isPaused && (
            <button
              type="button"
              onClick={handleClearRecording}
              className="iv-btn-icon text-red-400"
              aria-label="Clear recording"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* VU meter + duration */}
        {(isRecording || isPaused) && (
          <div className="flex items-center gap-3 mb-3">
            <VuMeter level={vuLevel} />
            <div className="flex items-center gap-2">
              <Circle className={`w-2.5 h-2.5 ${isRecording ? 'text-[#EF4444] animate-pulse' : 'text-[#EAB308]'}`} />
              <span className="text-sm font-mono iv-text">{formatDuration(recordDuration)}</span>
              {isPaused && <span className="text-xs iv-muted">Paused</span>}
            </div>
          </div>
        )}

        {/* Recording complete indicator */}
        {captureState.hasAudioRecording && !isRecording && !isPaused && (
          <div className="flex items-center gap-2 mb-3 text-xs text-[#22C55E]">
            <CheckCircle2 className="w-4 h-4" />
            Audio recorded ({formatDuration(recordDuration)})
          </div>
        )}

        {/* Live transcript */}
        {captureState.voiceTranscript && (
          <div className="p-3 rounded-lg bg-[#1C2029] border border-[#2A2F3A]">
            <p className="text-xs iv-muted mb-1">Transcript</p>
            <p className="text-sm iv-text whitespace-pre-wrap">{captureState.voiceTranscript}</p>
          </div>
        )}

        {/* No mic info */}
        {browserCaps && !browserCaps.mediaRecorder && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#EAB308]/10 border border-[#EAB308]/30">
            <Info className="w-4 h-4 text-[#EAB308] flex-shrink-0 mt-0.5" />
            <p className="text-xs iv-muted">
              Microphone recording is not supported in this browser. Use manual notes below instead.
            </p>
          </div>
        )}
      </div>

      {/* ── Photo Capture ── */}
      <div className="iv-panel p-4 mb-4">
        <h3 className="text-sm font-semibold iv-text mb-3 flex items-center gap-2">
          <Camera className="w-4 h-4 text-[#22C55E]" />
          Photos
        </h3>

        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoProcessing}
            className="iv-btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {photoProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImagePlus className="w-4 h-4" />
            )}
            {photoProcessing ? 'Processing...' : 'Take Photo'}
          </button>
          <span className="text-xs iv-muted">{photoThumbnails.length} photo{photoThumbnails.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Thumbnails */}
        {photoThumbnails.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photoThumbnails.map((photo) => (
              <PhotoThumbnail
                key={photo.id}
                base64={photo.base64}
                onRemove={() => handleRemovePhoto(photo.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Baseline Comparison ── */}
      {(baselinePhoto || firstPhotoBase64) && (
        <div className="mb-4">
          <BaselineComparison
            baseline={baselinePhoto}
            current={currentPhoto}
            currentCondition={captureState.condition}
            assetCode={currentAsset.asset_code}
            onSetBaseline={handleSetBaseline}
            settingBaseline={settingBaseline}
          />
        </div>
      )}

      {/* ── Feature 15: Common Defects Quick-Pick ── */}
      <div className="iv-panel p-4 mb-4">
        <h3 className="text-sm font-semibold iv-text mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-iv-accent" />
          Defects
          {captureState.manualDefects.length > 0 && (
            <span className="text-xs text-[#F97316]">({captureState.manualDefects.length})</span>
          )}
        </h3>

        <button
          type="button"
          onClick={() => setShowQuickPick(true)}
          className="iv-btn-secondary flex items-center gap-2 text-sm mb-3"
        >
          <BookOpen className="w-4 h-4" />
          Common Defects
        </button>

        {/* Manual defects list */}
        {captureState.manualDefects.length > 0 && (
          <div className="space-y-2">
            {captureState.manualDefects.map((defect, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-[#1C2029] border border-[#2A2F3A]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${
                      defect.risk_rating === 'very_high' ? 'bg-[#EF4444]' :
                      defect.risk_rating === 'high' ? 'bg-[#F97316]' :
                      defect.risk_rating === 'medium' ? 'bg-[#EAB308]' :
                      'bg-[#22C55E]'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-sm iv-text">{defect.description}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-2xs iv-muted">
                          {RISK_RATING_LABELS[defect.risk_rating as RiskRating] ?? defect.risk_rating}
                        </span>
                        {defect.bs_en_reference && (
                          <span className="text-2xs text-iv-accent">{defect.bs_en_reference}</span>
                        )}
                        {defect.action_timeframe && (
                          <span className="text-2xs iv-muted">
                            {ACTION_TIMEFRAME_LABELS[defect.action_timeframe as ActionTimeframe] ?? defect.action_timeframe}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveManualDefect(idx)}
                    className="iv-btn-icon text-red-400 flex-shrink-0"
                    aria-label="Remove defect"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Manual Notes ── */}
      <div className="iv-panel p-4 mb-4">
        <h3 className="text-sm font-semibold iv-text mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#22C55E]" />
          Inspector Notes
        </h3>
        <textarea
          value={captureState.notes}
          onChange={(e) => setCaptureState((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="Additional observations, measurements, or context..."
          rows={3}
          maxLength={5000}
          className="iv-input w-full resize-y"
          aria-label="Inspector notes"
        />
        <p className="text-xs iv-muted mt-1 text-right">{captureState.notes.length}/5000</p>
      </div>

      {/* ── Condition Rating ── */}
      <div className="iv-panel p-4 mb-4">
        <h3 className="text-sm font-semibold iv-text mb-3">Condition Rating</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            ConditionRating.GOOD,
            ConditionRating.FAIR,
            ConditionRating.POOR,
            ConditionRating.DANGEROUS,
          ] as const).map((rating) => (
            <button
              key={rating}
              type="button"
              onClick={() => setCaptureState((prev) => ({ ...prev, condition: rating }))}
              className={conditionBtnClass(rating, captureState.condition === rating)}
              aria-pressed={captureState.condition === rating}
            >
              {CONDITION_LABELS[rating]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Save + Navigation ── */}
      <div className="space-y-3 mb-6">
        {/* Save button */}
        {!isCurrentSaved && (
          <button
            type="button"
            onClick={handleSaveAsset}
            disabled={saving || (!hasCapture && !captureState.condition)}
            className="iv-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Save &amp; Continue
              </>
            )}
          </button>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="iv-btn-secondary flex items-center gap-1 flex-1 justify-center disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          {currentIndex < totalAssets - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="iv-btn-secondary flex items-center gap-1 flex-1 justify-center"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={!allDone}
              className={`flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                allDone
                  ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]'
                  : 'bg-[#2A2F3A] iv-muted cursor-not-allowed'
              }`}
            >
              <ArrowRight className="w-4 h-4" />
              Finish &amp; Review
            </button>
          )}
        </div>

        {/* Skip hint */}
        {isCurrentSaved && currentIndex < totalAssets - 1 && (
          <p className="text-xs iv-muted text-center">
            Already saved — tap Next to continue or update and re-save
          </p>
        )}
      </div>

      {/* ── Feature 15: Quick-Pick Bottom Sheet ── */}
      <DefectQuickPick
        assetType={currentAsset.asset_type}
        isOpen={showQuickPick}
        onClose={() => setShowQuickPick(false)}
        onSelect={handleQuickPickSelect}
      />
    </div>
  );
}
