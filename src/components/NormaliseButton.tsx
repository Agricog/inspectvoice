/**
 * InspectVoice — NormaliseButton Component
 * Per-field "Normalise now" button with inline diff + accept/reject.
 *
 * Usage:
 *   <NormaliseButton
 *     fieldName="defect_description"
 *     originalText={description}
 *     inspectionId={inspectionId}
 *     defectId={defectId}
 *     onAccept={(normalisedText) => setDescription(normalisedText)}
 *   />
 *
 * Flow:
 *   1. User clicks "Normalise" → calls POST /api/v1/normalise/field
 *   2. Diff panel slides open showing original vs normalised
 *   3. User clicks Accept → calls POST /api/v1/normalise/:id/accept → onAccept callback
 *   4. User clicks Reject → calls POST /api/v1/normalise/:id/reject → panel closes
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback } from 'react';
import {
  Sparkles,
  Loader2,
  Check,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import { secureFetch } from '@hooks/useFetch';
import type {
  NormalisableField,
  NormaliseResult,
} from '@/types/normalisation';
import { NORMALISABLE_FIELD_LABELS } from '@/types/normalisation';

// =============================================
// TYPES
// =============================================

interface NormaliseButtonProps {
  /** Which field type is being normalised */
  fieldName: NormalisableField;
  /** The current text to normalise */
  originalText: string;
  /** Callback when user accepts the normalised version */
  onAccept: (normalisedText: string) => void;
  /** Optional entity IDs for audit trail */
  inspectionId?: string;
  inspectionItemId?: string;
  defectId?: string;
  /** Minimum text length to enable button (default: 10) */
  minLength?: number;
  /** Compact mode — smaller button for inline use */
  compact?: boolean;
}

type NormaliseState = 'idle' | 'loading' | 'reviewing' | 'accepting' | 'rejecting' | 'error';

const REJECT_REASONS = [
  'Meaning changed',
  'Tone inappropriate',
  'Technical inaccuracy',
  'Prefer original wording',
  'Other',
] as const;

// =============================================
// COMPONENT
// =============================================

export function NormaliseButton({
  fieldName,
  originalText,
  onAccept,
  inspectionId,
  inspectionItemId,
  defectId,
  minLength = 10,
  compact = false,
}: NormaliseButtonProps): JSX.Element {
  const [state, setState] = useState<NormaliseState>('idle');
  const [result, setResult] = useState<NormaliseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canNormalise = originalText.trim().length >= minLength;

  // ── Request normalisation ──────────────────
  const handleNormalise = useCallback(async () => {
    if (!canNormalise) return;

    setState('loading');
    setErrorMsg('');
    setResult(null);

    try {
      const response = await secureFetch<{ success: boolean; data: NormaliseResult }>(
        '/api/v1/normalise/field',
        {
          method: 'POST',
          body: {
            field_name: fieldName,
            original_text: originalText,
            inspection_id: inspectionId,
            inspection_item_id: inspectionItemId,
            defect_id: defectId,
          },
        },
      );

      if (response.data.noChangesNeeded) {
        setState('idle');
        setErrorMsg('');
        // Brief flash to show it ran
        setResult(response.data);
        setTimeout(() => setResult(null), 2000);
        return;
      }

      setResult(response.data);
      setState('reviewing');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Normalisation failed';
      // Extract user-friendly message from API error
      if (msg.includes('budget exceeded')) {
        setErrorMsg('Monthly token budget exceeded');
      } else if (msg.includes('not enabled')) {
        setErrorMsg('AI normalisation not enabled — enable in Settings');
      } else {
        setErrorMsg(msg);
      }
      setState('error');
    }
  }, [canNormalise, fieldName, originalText, inspectionId, inspectionItemId, defectId]);

  // ── Accept ─────────────────────────────────
  const handleAccept = useCallback(async () => {
    if (!result) return;

    setState('accepting');

    try {
      await secureFetch<{ success: boolean }>(
        `/api/v1/normalise/${result.logId}/accept`,
        { method: 'POST' },
      );

      onAccept(result.normalisedText);
      setState('idle');
      setResult(null);
    } catch {
      setErrorMsg('Failed to accept — try again');
      setState('reviewing');
    }
  }, [result, onAccept]);

  // ── Reject ─────────────────────────────────
  const handleReject = useCallback(async () => {
    if (!result) return;

    setState('rejecting');

    try {
      await secureFetch<{ success: boolean }>(
        `/api/v1/normalise/${result.logId}/reject`,
        {
          method: 'POST',
          body: { reason: rejectReason || 'No reason provided' },
        },
      );

      setState('idle');
      setResult(null);
      setShowRejectReason(false);
      setRejectReason('');
    } catch {
      setErrorMsg('Failed to reject — try again');
      setState('reviewing');
    }
  }, [result, rejectReason]);

  // ── "No changes" flash ─────────────────────
  if (state === 'idle' && result?.noChangesNeeded) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
        <Check className="w-3 h-3" />
        Already matches style
      </span>
    );
  }

  // ── Idle / Error state: show button ────────
  if (state === 'idle' || state === 'error' || state === 'loading') {
    return (
      <div className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={handleNormalise}
          disabled={!canNormalise || state === 'loading'}
          className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            compact
              ? 'px-2 py-1 text-2xs bg-iv-accent/10 text-iv-accent hover:bg-iv-accent/20'
              : 'px-3 py-1.5 text-xs bg-iv-accent/10 text-iv-accent hover:bg-iv-accent/20 border border-iv-accent/20'
          }`}
          title={`Normalise ${NORMALISABLE_FIELD_LABELS[fieldName].toLowerCase()} to house style`}
        >
          {state === 'loading' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          {state === 'loading' ? 'Normalising…' : 'Normalise'}
        </button>

        {state === 'error' && errorMsg && (
          <span className="text-2xs text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {errorMsg}
          </span>
        )}
      </div>
    );
  }

  // ── Review state: show diff panel ──────────
  if ((state === 'reviewing' || state === 'accepting' || state === 'rejecting') && result) {
    return (
      <div className="mt-2 bg-iv-surface border border-iv-accent/30 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-iv-accent/10 border-b border-iv-accent/20">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-iv-accent" />
            <span className="text-xs font-medium text-iv-accent">AI Suggestion</span>
          </div>
          <span className="text-2xs text-iv-muted">{result.diffSummary}</span>
        </div>

        {/* Diff view */}
        <div className="p-3 space-y-3">
          {/* Original */}
          <div>
            <p className="text-2xs text-iv-muted mb-1 font-medium">Original</p>
            <div className="text-sm text-iv-muted bg-red-500/5 border border-red-500/10 rounded-lg p-2.5 whitespace-pre-wrap">
              {result.originalText}
            </div>
          </div>

          {/* Normalised */}
          <div>
            <p className="text-2xs text-iv-accent mb-1 font-medium">Normalised</p>
            <div className="text-sm text-iv-text bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2.5 whitespace-pre-wrap">
              {result.normalisedText}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-3 pb-3 space-y-2">
          {/* Accept / Reject row */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAccept}
              disabled={state === 'accepting' || state === 'rejecting'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
            >
              {state === 'accepting' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Accept
            </button>

            <button
              type="button"
              onClick={() => {
                if (showRejectReason) {
                  void handleReject();
                } else {
                  setShowRejectReason(true);
                }
              }}
              disabled={state === 'accepting' || state === 'rejecting'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/25 disabled:opacity-50 transition-colors"
            >
              {state === 'rejecting' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <X className="w-3 h-3" />
              )}
              Reject
            </button>

            <button
              type="button"
              onClick={handleNormalise}
              disabled={state === 'accepting' || state === 'rejecting'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-iv-muted rounded-lg text-xs font-medium hover:text-iv-text hover:bg-iv-surface-2 disabled:opacity-50 transition-colors ml-auto"
              title="Re-generate suggestion"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          </div>

          {/* Reject reason dropdown */}
          {showRejectReason && (
            <div className="flex items-center gap-2">
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-iv-surface-2 border border-iv-border rounded-lg text-xs text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40"
              >
                <option value="">Select reason (optional)…</option>
                {REJECT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={state === 'rejecting'}
                className="px-3 py-1.5 bg-red-500/15 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/25 disabled:opacity-50 transition-colors"
              >
                {state === 'rejecting' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  'Confirm Reject'
                )}
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="text-2xs text-red-400">{errorMsg}</p>
          )}
        </div>
      </div>
    );
  }

  return <></>;
}

// =============================================
// BATCH NORMALISE BUTTON (for sign-off review)
// =============================================

interface BatchNormaliseButtonProps {
  /** Fields to normalise */
  fields: Array<{
    fieldName: NormalisableField;
    originalText: string;
    inspectionId?: string;
    inspectionItemId?: string;
    defectId?: string;
  }>;
  /** Called with all results when batch completes */
  onComplete: (results: NormaliseResult[]) => void;
}

export function BatchNormaliseButton({
  fields,
  onComplete,
}: BatchNormaliseButtonProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validFields = fields.filter((f) => f.originalText.trim().length >= 10);

  const handleBatch = useCallback(async () => {
    if (validFields.length === 0) return;

    setLoading(true);
    setError('');

    try {
      const response = await secureFetch<{
        success: boolean;
        data: {
          results: NormaliseResult[];
          totalInputTokens: number;
          totalOutputTokens: number;
          budgetRemaining: number;
        };
      }>('/api/v1/normalise/batch', {
        method: 'POST',
        body: {
          fields: validFields.map((f) => ({
            field_name: f.fieldName,
            original_text: f.originalText,
            inspection_id: f.inspectionId,
            inspection_item_id: f.inspectionItemId,
            defect_id: f.defectId,
          })),
        },
      });

      const changedResults = response.data.results.filter((r) => !r.noChangesNeeded);
      onComplete(changedResults);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch normalisation failed';
      if (msg.includes('budget exceeded')) {
        setError('Monthly token budget exceeded');
      } else if (msg.includes('not enabled')) {
        setError('AI normalisation not enabled');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [validFields, onComplete]);

  if (validFields.length === 0) return <></>;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleBatch}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-iv-accent/10 text-iv-accent border border-iv-accent/20 rounded-lg text-xs font-medium hover:bg-iv-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        {loading
          ? `Normalising ${validFields.length} field${validFields.length !== 1 ? 's' : ''}…`
          : `Normalise All (${validFields.length} field${validFields.length !== 1 ? 's' : ''})`}
      </button>

      {error && (
        <span className="text-2xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </span>
      )}
    </div>
  );
}

export default NormaliseButton;
