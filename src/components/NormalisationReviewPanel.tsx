/**
 * InspectVoice — NormalisationReviewPanel
 * Batch diff review panel shown between completeness check and sign-off.
 *
 * Displays all AI normalisation suggestions as a scrollable list of diffs.
 * Inspector can: Accept All, Reject All, or Accept/Reject per field.
 * Only proceeds to sign-off once all suggestions are resolved.
 *
 * Usage (in InspectionReview.tsx):
 *   <NormalisationReviewPanel
 *     results={batchResults}
 *     onComplete={(accepted) => { applyAccepted(accepted); proceedToSignOff(); }}
 *     onCancel={() => setShowNormReview(false)}
 *   />
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Check,
  X,
  CheckCheck,
  XCircle,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { secureFetch } from '@hooks/useFetch';
import type { NormaliseResult } from '@/types/normalisation';
import { NORMALISABLE_FIELD_LABELS } from '@/types/normalisation';

// =============================================
// TYPES
// =============================================

interface NormalisationReviewPanelProps {
  /** Results from batch normalisation */
  results: NormaliseResult[];
  /** Called when all items resolved — accepted items passed back */
  onComplete: (acceptedResults: NormaliseResult[]) => void;
  /** Cancel and close panel */
  onCancel: () => void;
}

type ItemDecision = 'pending' | 'accepted' | 'rejected' | 'processing';

interface ReviewItem {
  result: NormaliseResult;
  decision: ItemDecision;
  rejectReason: string;
}

// =============================================
// COMPONENT
// =============================================

export function NormalisationReviewPanel({
  results,
  onComplete,
  onCancel,
}: NormalisationReviewPanelProps): JSX.Element {
  const [items, setItems] = useState<ReviewItem[]>(() =>
    results.map((r) => ({ result: r, decision: 'pending' as const, rejectReason: '' })),
  );
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [error, setError] = useState('');

  // ── Derived state ──────────────────────────
  const pendingCount = useMemo(() => items.filter((i) => i.decision === 'pending').length, [items]);
  const acceptedCount = useMemo(() => items.filter((i) => i.decision === 'accepted').length, [items]);
  const rejectedCount = useMemo(() => items.filter((i) => i.decision === 'rejected').length, [items]);
  const processingCount = useMemo(() => items.filter((i) => i.decision === 'processing').length, [items]);
  const allResolved = pendingCount === 0 && processingCount === 0;

  /** Safely update a single item by index. */
  const updateItem = useCallback((index: number, decision: ItemDecision, rejectReason?: string) => {
    setItems((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = {
        result: current.result,
        decision,
        rejectReason: rejectReason ?? current.rejectReason,
      };
      return next;
    });
  }, []);

  // ── Accept single item ─────────────────────
  const handleAcceptItem = useCallback(async (index: number) => {
    const item = items[index];
    if (!item || item.decision !== 'pending') return;

    updateItem(index, 'processing');

    try {
      await secureFetch(`/api/v1/normalise/${item.result.logId}/accept`, { method: 'POST' });
      updateItem(index, 'accepted');
    } catch {
      updateItem(index, 'pending');
      setError('Failed to accept — try again');
    }
  }, [items, updateItem]);

  // ── Reject single item ─────────────────────
  const handleRejectItem = useCallback(async (index: number, reason: string) => {
    const item = items[index];
    if (!item || item.decision !== 'pending') return;

    updateItem(index, 'processing');

    try {
      await secureFetch(`/api/v1/normalise/${item.result.logId}/reject`, {
        method: 'POST',
        body: { reason: reason || 'No reason provided' },
      });
      updateItem(index, 'rejected', reason);
    } catch {
      updateItem(index, 'pending');
      setError('Failed to reject — try again');
    }
  }, [items, updateItem]);

  // ── Accept all pending ─────────────────────
  const handleAcceptAll = useCallback(async () => {
    setBulkProcessing(true);
    setError('');

    const pendingIndexes = items
      .map((item, idx) => (item.decision === 'pending' ? idx : -1))
      .filter((idx) => idx >= 0);

    for (const idx of pendingIndexes) {
      await handleAcceptItem(idx);
    }

    setBulkProcessing(false);
  }, [items, handleAcceptItem]);

  // ── Reject all pending ─────────────────────
  const handleRejectAll = useCallback(async () => {
    setBulkProcessing(true);
    setError('');

    const pendingIndexes = items
      .map((item, idx) => (item.decision === 'pending' ? idx : -1))
      .filter((idx) => idx >= 0);

    for (const idx of pendingIndexes) {
      await handleRejectItem(idx, 'Batch rejected at sign-off');
    }

    setBulkProcessing(false);
  }, [items, handleRejectItem]);

  // ── Proceed ────────────────────────────────
  const handleProceed = useCallback(() => {
    const accepted = items
      .filter((i) => i.decision === 'accepted')
      .map((i) => i.result);
    onComplete(accepted);
  }, [items, onComplete]);

  // ── Empty state (no changes needed) ────────
  if (results.length === 0) {
    return (
      <div className="iv-panel p-6 text-center">
        <Sparkles className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-iv-text mb-1">All text matches house style</h3>
        <p className="text-sm text-iv-muted mb-4">No normalisation changes needed.</p>
        <button
          type="button"
          onClick={() => onComplete([])}
          className="iv-btn-primary inline-flex items-center gap-2"
        >
          <ArrowRight className="w-4 h-4" />
          Continue to Sign Off
        </button>
      </div>
    );
  }

  return (
    <div className="iv-panel overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-iv-accent/10 border-b border-iv-accent/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold text-iv-text">
            AI Style Review — {results.length} suggestion{results.length !== 1 ? 's' : ''}
          </h3>
        </div>
        <div className="flex items-center gap-3 text-2xs text-iv-muted">
          {acceptedCount > 0 && (
            <span className="text-emerald-400">{acceptedCount} accepted</span>
          )}
          {rejectedCount > 0 && (
            <span className="text-red-400">{rejectedCount} rejected</span>
          )}
          {pendingCount > 0 && (
            <span>{pendingCount} pending</span>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {pendingCount > 0 && (
        <div className="px-4 py-2 border-b border-iv-border flex items-center gap-2">
          <button
            type="button"
            onClick={handleAcceptAll}
            disabled={bulkProcessing}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/15 text-emerald-400 rounded-lg text-2xs font-medium hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
          >
            {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
            Accept All ({pendingCount})
          </button>
          <button
            type="button"
            onClick={handleRejectAll}
            disabled={bulkProcessing}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-2xs font-medium hover:bg-red-500/20 disabled:opacity-50 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Reject All
          </button>
        </div>
      )}

      {/* Items */}
      <div className="divide-y divide-iv-border max-h-[60vh] overflow-y-auto">
        {items.map((item, index) => (
          <ReviewItemRow
            key={item.result.logId}
            item={item}
            index={index}
            onAccept={handleAcceptItem}
            onReject={handleRejectItem}
            disabled={bulkProcessing}
          />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-iv-border flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-iv-muted hover:text-iv-text transition-colors"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleProceed}
          disabled={!allResolved}
          className="iv-btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowRight className="w-4 h-4" />
          {allResolved ? 'Continue to Sign Off' : `${pendingCount} remaining…`}
        </button>
      </div>
    </div>
  );
}

// =============================================
// REVIEW ITEM ROW
// =============================================

function ReviewItemRow({
  item,
  index,
  onAccept,
  onReject,
  disabled,
}: {
  item: ReviewItem;
  index: number;
  onAccept: (index: number) => Promise<void>;
  onReject: (index: number, reason: string) => Promise<void>;
  disabled: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(item.decision === 'pending');

  const fieldLabel = NORMALISABLE_FIELD_LABELS[item.result.fieldName];

  const statusBadge = {
    pending: null,
    processing: (
      <span className="inline-flex items-center gap-1 text-2xs text-iv-accent">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processing…
      </span>
    ),
    accepted: (
      <span className="inline-flex items-center gap-1 text-2xs text-emerald-400">
        <Check className="w-3 h-3" />
        Accepted
      </span>
    ),
    rejected: (
      <span className="inline-flex items-center gap-1 text-2xs text-red-400">
        <X className="w-3 h-3" />
        Rejected
      </span>
    ),
  }[item.decision];

  return (
    <div className={`${item.decision === 'accepted' ? 'bg-emerald-500/5' : item.decision === 'rejected' ? 'bg-red-500/5' : ''}`}>
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-iv-surface-2/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-iv-text">{fieldLabel}</span>
          <span className="text-2xs text-iv-muted truncate max-w-[200px]">
            {item.result.diffSummary}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusBadge}
        </div>
      </button>

      {/* Expanded diff */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <p className="text-2xs text-iv-muted mb-1">Original</p>
              <div className="text-xs text-iv-muted bg-red-500/5 border border-red-500/10 rounded-lg p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {item.result.originalText}
              </div>
            </div>
            <div>
              <p className="text-2xs text-iv-accent mb-1">Normalised</p>
              <div className="text-xs text-iv-text bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {item.result.normalisedText}
              </div>
            </div>
          </div>

          {item.decision === 'pending' && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void onAccept(index)}
                disabled={disabled}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/15 text-emerald-400 rounded-lg text-2xs font-medium hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
              >
                <Check className="w-3 h-3" />
                Accept
              </button>
              <button
                type="button"
                onClick={() => void onReject(index, '')}
                disabled={disabled}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-2xs font-medium hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                <X className="w-3 h-3" />
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NormalisationReviewPanel;
