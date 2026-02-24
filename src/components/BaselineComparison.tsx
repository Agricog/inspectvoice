/**
 * InspectVoice — Baseline Photo Comparison Component
 * Feature 5: Baseline vs current photo comparison
 *
 * A touch-friendly before/after slider that shows:
 *   - LEFT: Baseline/reference photo (from previous inspection)
 *   - RIGHT: Current photo (just captured)
 *
 * Interaction:
 *   - Drag the slider handle left/right to reveal more of either image
 *   - Touch + mouse support
 *   - Pinch-to-zoom (future enhancement)
 *   - Tap labels to snap to 0%, 50%, or 100%
 *
 * Also includes:
 *   - Condition badge overlay on each side
 *   - Date stamps
 *   - "Set as Baseline" button for new assets
 *   - "No Baseline" state with prompt to set one
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useRef, useCallback } from 'react';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  ArrowLeftRight,
  ImageOff,
  Star,
} from 'lucide-react';

import { ConditionRating, CONDITION_LABELS } from '@/types';

// =============================================
// TYPES
// =============================================

export interface BaselinePhoto {
  /** URL or base64 data URI of the baseline photo */
  src: string;
  /** When the baseline was taken */
  takenAt: string;
  /** Who took it */
  takenBy: string;
  /** Condition at the time of the baseline */
  condition: ConditionRating | null;
}

export interface CurrentPhoto {
  /** URL or base64 data URI of the current photo */
  src: string;
  /** When this photo was captured */
  capturedAt: string;
}

interface BaselineComparisonProps {
  /** The baseline/reference photo (null if none set) */
  baseline: BaselinePhoto | null;
  /** The current inspection photo (null if none captured yet) */
  current: CurrentPhoto | null;
  /** Current condition rating from this inspection */
  currentCondition: ConditionRating | null;
  /** Asset code for display */
  assetCode: string;
  /** Callback when inspector wants to set current photo as new baseline */
  onSetBaseline?: () => void;
  /** Whether the set-baseline action is in progress */
  settingBaseline?: boolean;
}

// =============================================
// CONDITION BADGE
// =============================================

function ConditionBadge({
  condition,
  label,
}: {
  condition: ConditionRating | null;
  label: string;
}): JSX.Element {
  const colour =
    condition === ConditionRating.GOOD ? 'bg-[#22C55E]/80 text-white' :
    condition === ConditionRating.FAIR ? 'bg-[#EAB308]/80 text-white' :
    condition === ConditionRating.POOR ? 'bg-[#F97316]/80 text-white' :
    condition === ConditionRating.DANGEROUS ? 'bg-[#EF4444]/80 text-white' :
    'bg-[#2A2F3A]/80 iv-muted';

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colour}`}>
      {label}: {condition ? CONDITION_LABELS[condition] : 'N/A'}
    </span>
  );
}

// =============================================
// DATE FORMATTER
// =============================================

function formatShortDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// =============================================
// NO BASELINE STATE
// =============================================

function NoBaselineState({
  onSetBaseline,
  settingBaseline,
  hasCurrent,
}: {
  onSetBaseline?: () => void;
  settingBaseline?: boolean;
  hasCurrent: boolean;
}): JSX.Element {
  return (
    <div className="iv-panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <ArrowLeftRight className="w-4 h-4 text-[#22C55E]" />
        <h3 className="text-sm font-semibold iv-text">Baseline Comparison</h3>
      </div>

      <div className="flex flex-col items-center justify-center py-6 gap-3">
        <ImageOff className="w-10 h-10 iv-muted" />
        <div className="text-center">
          <p className="text-sm iv-text font-medium">No Baseline Photo</p>
          <p className="text-xs iv-muted mt-1">
            Set a baseline photo to track deterioration over time
          </p>
        </div>

        {hasCurrent && onSetBaseline && (
          <button
            type="button"
            onClick={onSetBaseline}
            disabled={settingBaseline}
            className="iv-btn-secondary flex items-center gap-2 text-sm mt-2 disabled:opacity-50"
          >
            <Star className="w-4 h-4" />
            {settingBaseline ? 'Setting...' : 'Set Current Photo as Baseline'}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================
// NO CURRENT PHOTO STATE
// =============================================

function BaselineOnlyState({
  baseline,
}: {
  baseline: BaselinePhoto;
}): JSX.Element {
  return (
    <div className="iv-panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <ArrowLeftRight className="w-4 h-4 text-[#22C55E]" />
        <h3 className="text-sm font-semibold iv-text">Baseline Reference</h3>
      </div>

      <div className="relative rounded-lg overflow-hidden border border-[#2A2F3A]">
        <img
          src={baseline.src}
          alt={`Baseline photo`}
          className="w-full h-48 object-cover"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-white/70" />
              <span className="text-xs text-white/80">
                {formatShortDate(baseline.takenAt)}
              </span>
            </div>
            <ConditionBadge condition={baseline.condition} label="Baseline" />
          </div>
        </div>
      </div>

      <p className="text-xs iv-muted mt-2 text-center">
        Take a photo to compare against this baseline
      </p>
    </div>
  );
}

// =============================================
// COMPARISON SLIDER COMPONENT
// =============================================

export default function BaselineComparison({
  baseline,
  current,
  currentCondition,
  assetCode,
  onSetBaseline,
  settingBaseline = false,
}: BaselineComparisonProps): JSX.Element {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // No baseline set
  if (!baseline) {
    return (
      <NoBaselineState
        onSetBaseline={onSetBaseline}
        settingBaseline={settingBaseline}
        hasCurrent={Boolean(current)}
      />
    );
  }

  // Baseline but no current photo yet
  if (!current) {
    return <BaselineOnlyState baseline={baseline} />;
  }

  // ---- Slider interaction ----

  const updatePosition = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percent);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    updatePosition(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [updatePosition]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    updatePosition(e.clientX);
  }, [updatePosition]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Snap positions
  const snapTo = useCallback((percent: number) => {
    setSliderPosition(percent);
  }, []);

  // Detect condition change
  const conditionChanged = baseline.condition !== null &&
    currentCondition !== null &&
    baseline.condition !== currentCondition;

  const conditionWorsened = conditionChanged && currentCondition !== null && (
    (baseline.condition === ConditionRating.GOOD && currentCondition !== ConditionRating.GOOD) ||
    (baseline.condition === ConditionRating.FAIR && (currentCondition === ConditionRating.POOR || currentCondition === ConditionRating.DANGEROUS)) ||
    (baseline.condition === ConditionRating.POOR && currentCondition === ConditionRating.DANGEROUS)
  );

  return (
    <div className="iv-panel p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-[#22C55E]" />
          <h3 className="text-sm font-semibold iv-text">Baseline Comparison</h3>
        </div>
        {conditionChanged && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
            conditionWorsened
              ? 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30'
              : 'bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30'
          }`}>
            {conditionWorsened ? (
              <AlertTriangle className="w-3 h-3" />
            ) : (
              <CheckCircle2 className="w-3 h-3" />
            )}
            {conditionWorsened ? 'Deteriorated' : 'Improved'}
          </span>
        )}
      </div>

      {/* Slider container */}
      <div
        ref={containerRef}
        className="relative w-full h-56 sm:h-64 rounded-lg overflow-hidden border border-[#2A2F3A] cursor-col-resize select-none touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label="Photo comparison slider"
        aria-valuenow={Math.round(sliderPosition)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Current photo (full background) */}
        <img
          src={current.src}
          alt={`Current photo of ${assetCode}`}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />

        {/* Baseline photo (clipped by slider) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${sliderPosition}%` }}
        >
          <img
            src={baseline.src}
            alt={`Baseline photo of ${assetCode}`}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ width: containerRef.current ? `${containerRef.current.offsetWidth}px` : '100%' }}
            draggable={false}
          />
        </div>

        {/* Slider line + handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
          style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
        >
          {/* Handle */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
            <ArrowLeftRight className="w-4 h-4 text-[#151920]" />
          </div>
        </div>

        {/* Labels */}
        <div className="absolute top-2 left-2 z-20">
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-black/60 text-white">
            Baseline
          </span>
        </div>
        <div className="absolute top-2 right-2 z-20">
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-black/60 text-white">
            Current
          </span>
        </div>

        {/* Bottom overlays */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 z-20 pointer-events-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-white/70" />
              <span className="text-[10px] text-white/80">
                {formatShortDate(baseline.takenAt)}
              </span>
              <ConditionBadge condition={baseline.condition} label="Then" />
            </div>
            <div className="flex items-center gap-1.5">
              <ConditionBadge condition={currentCondition} label="Now" />
              <span className="text-[10px] text-white/80">
                {formatShortDate(current.capturedAt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Snap buttons */}
      <div className="flex items-center justify-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => snapTo(0)}
          className="text-xs iv-muted hover:iv-text transition-colors px-2 py-1"
        >
          Current only
        </button>
        <button
          type="button"
          onClick={() => snapTo(50)}
          className="text-xs iv-muted hover:iv-text transition-colors px-2 py-1"
        >
          50/50
        </button>
        <button
          type="button"
          onClick={() => snapTo(100)}
          className="text-xs iv-muted hover:iv-text transition-colors px-2 py-1"
        >
          Baseline only
        </button>
      </div>

      {/* Set as baseline option */}
      {onSetBaseline && (
        <div className="mt-3 pt-3 border-t border-[#2A2F3A] flex items-center justify-between">
          <p className="text-xs iv-muted">
            Replace baseline with current photo?
          </p>
          <button
            type="button"
            onClick={onSetBaseline}
            disabled={settingBaseline}
            className="text-xs text-[#22C55E] hover:underline disabled:opacity-50 flex items-center gap-1"
          >
            <Star className="w-3 h-3" />
            {settingBaseline ? 'Updating...' : 'Update Baseline'}
          </button>
        </div>
      )}
    </div>
  );
}
