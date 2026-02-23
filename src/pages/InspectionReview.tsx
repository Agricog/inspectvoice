/**
 * InspectVoice — Inspection Review & Summary
 * Batch 15
 *
 * Route: /sites/:siteId/inspections/:inspectionId/review
 *
 * After all assets inspected, the inspector reviews:
 *   1. Overall summary — risk counts, defect totals
 *   2. Per-asset results — condition, transcript, photos, notes
 *   3. Inspector summary notes (free text)
 *   4. Closure recommendation (if dangerous conditions found)
 *   5. Digital sign-off → marks inspection as COMPLETED
 *   6. Navigates to site page (PDF generation happens async via sync)
 *
 * Features:
 *   - Loads all inspection items from IndexedDB
 *   - Calculates risk/defect tallies
 *   - Per-asset expandable cards with full detail
 *   - Inspector summary textarea
 *   - Closure recommendation toggle (visible if dangerous/very high risk found)
 *   - Sign-off confirmation with name + timestamp
 *   - Updates inspection status to COMPLETED in IndexedDB
 *   - Dark theme, mobile-first, accessible
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Mic,
  AlertCircle,
  XCircle,
  PenTool,
  Send,
  Edit,
} from 'lucide-react';

import { inspections, inspectionItems, assetsCache } from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import {
  InspectionStatus,
  InspectionType,
  INSPECTION_TYPE_LABELS,
  ConditionRating,
  CONDITION_LABELS,
  RiskRating,
  RISK_RATING_LABELS,
} from '@/types';
import type { Inspection, InspectionItem, Asset } from '@/types';
import { getAssetTypeConfig } from '@config/assetTypes';

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function conditionColour(condition: ConditionRating | null): string {
  switch (condition) {
    case ConditionRating.GOOD:
      return 'text-[#22C55E]';
    case ConditionRating.FAIR:
      return 'text-[#EAB308]';
    case ConditionRating.POOR:
      return 'text-[#F97316]';
    case ConditionRating.DANGEROUS:
      return 'text-[#EF4444]';
    default:
      return 'iv-muted';
  }
}

function conditionBadgeClass(condition: ConditionRating | null): string {
  switch (condition) {
    case ConditionRating.GOOD:
      return 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30';
    case ConditionRating.FAIR:
      return 'bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/30';
    case ConditionRating.POOR:
      return 'bg-[#F97316]/15 text-[#F97316] border-[#F97316]/30';
    case ConditionRating.DANGEROUS:
      return 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30';
    default:
      return 'bg-[#2A2F3A] iv-muted border-[#2A2F3A]';
  }
}

function riskColour(risk: RiskRating | null): string {
  switch (risk) {
    case RiskRating.VERY_HIGH:
      return 'text-[#EF4444]';
    case RiskRating.HIGH:
      return 'text-[#F97316]';
    case RiskRating.MEDIUM:
      return 'text-[#EAB308]';
    case RiskRating.LOW:
      return 'text-[#22C55E]';
    default:
      return 'iv-muted';
  }
}

// =============================================
// RISK SUMMARY CARD
// =============================================

function RiskSummaryCard({
  label,
  count,
  colour,
  icon,
}: {
  label: string;
  count: number;
  colour: string;
  icon: React.ReactNode;
}): JSX.Element {
  return (
    <div className="iv-panel p-3 text-center">
      <div className={`flex items-center justify-center gap-1 mb-1 ${colour}`}>
        {icon}
        <span className="text-2xl font-bold">{count}</span>
      </div>
      <p className="text-xs iv-muted">{label}</p>
    </div>
  );
}

// =============================================
// ASSET RESULT CARD (expandable)
// =============================================

function AssetResultCard({
  item,
  asset,
  siteId,
  inspectionId,
}: {
  item: InspectionItem;
  asset: Asset | undefined;
  siteId: string;
  inspectionId: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const config = getAssetTypeConfig(item.asset_type);
  const typeName = config?.name ?? item.asset_type;

  const hasTranscript = Boolean(item.voice_transcript);
  const hasNotes = Boolean(item.inspector_notes);
  const defectCount = item.defects.length;

  return (
    <div className="iv-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-[#1C2029] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Condition indicator */}
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              item.overall_condition === ConditionRating.GOOD ? 'bg-[#22C55E]' :
              item.overall_condition === ConditionRating.FAIR ? 'bg-[#EAB308]' :
              item.overall_condition === ConditionRating.POOR ? 'bg-[#F97316]' :
              item.overall_condition === ConditionRating.DANGEROUS ? 'bg-[#EF4444]' :
              'bg-[#2A2F3A]'
            }`}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium iv-text truncate">{item.asset_code}</p>
            <p className="text-xs iv-muted truncate">{typeName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Quick indicators */}
          {hasTranscript && <Mic className="w-3.5 h-3.5 iv-muted" />}
          {hasNotes && <FileText className="w-3.5 h-3.5 iv-muted" />}
          {defectCount > 0 && (
            <span className="text-xs text-[#F97316]">{defectCount} defect{defectCount !== 1 ? 's' : ''}</span>
          )}

          {/* Condition badge */}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${conditionBadgeClass(item.overall_condition)}`}>
            {item.overall_condition ? CONDITION_LABELS[item.overall_condition] : 'N/A'}
          </span>

          {expanded ? (
            <ChevronDown className="w-4 h-4 iv-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 iv-muted" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[#2A2F3A] space-y-3 pt-3">
          {/* Condition + Risk */}
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs iv-muted">Condition</p>
              <p className={`text-sm font-medium ${conditionColour(item.overall_condition)}`}>
                {item.overall_condition ? CONDITION_LABELS[item.overall_condition] : 'Not rated'}
              </p>
            </div>
            {item.risk_rating && (
              <div>
                <p className="text-xs iv-muted">Risk</p>
                <p className={`text-sm font-medium ${riskColour(item.risk_rating)}`}>
                  {RISK_RATING_LABELS[item.risk_rating]}
                </p>
              </div>
            )}
          </div>

          {/* Transcript */}
          {hasTranscript && (
            <div>
              <p className="text-xs iv-muted mb-1 flex items-center gap-1">
                <Mic className="w-3 h-3" />
                Voice Transcript
              </p>
              <p className="text-sm iv-text bg-[#1C2029] p-2 rounded-lg whitespace-pre-wrap">
                {item.voice_transcript}
              </p>
            </div>
          )}

          {/* Inspector notes */}
          {hasNotes && (
            <div>
              <p className="text-xs iv-muted mb-1 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                Inspector Notes
              </p>
              <p className="text-sm iv-text bg-[#1C2029] p-2 rounded-lg whitespace-pre-wrap">
                {item.inspector_notes}
              </p>
            </div>
          )}

          {/* Defects */}
          {defectCount > 0 && (
            <div>
              <p className="text-xs iv-muted mb-1">
                Defects ({defectCount})
              </p>
              <div className="space-y-1">
                {item.defects.map((defect, idx) => (
                  <div key={idx} className="text-sm iv-text bg-[#1C2029] p-2 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-[#F97316] flex-shrink-0 mt-0.5" />
                    <span>{typeof defect === 'string' ? defect : JSON.stringify(defect)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edit link */}
          <Link
            to={`/sites/${siteId}/inspections/${inspectionId}/capture`}
            className="inline-flex items-center gap-1 text-xs text-[#22C55E] hover:underline"
          >
            <Edit className="w-3 h-3" />
            Re-inspect this asset
          </Link>
        </div>
      )}
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function InspectionReview(): JSX.Element {
  const { siteId, inspectionId } = useParams<{ siteId: string; inspectionId: string }>();
  const navigate = useNavigate();

  // ---- Loading ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- Data ----
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [assetMap, setAssetMap] = useState<Map<string, Asset>>(new Map());

  // ---- Form ----
  const [summary, setSummary] = useState('');
  const [closureRecommended, setClosureRecommended] = useState(false);
  const [closureReason, setClosureReason] = useState('');
  const [signedByName, setSignedByName] = useState('');

  // ---- Submit ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // ---- Load data ----
  useEffect(() => {
    if (!siteId || !inspectionId) return;

    let cancelled = false;

    async function loadData(): Promise<void> {
      try {
        const [localInspection, localItems, cachedAssets] = await Promise.all([
          inspections.get(inspectionId!),
          inspectionItems.getByInspection(inspectionId!),
          assetsCache.getBySite(siteId!),
        ]);

        if (cancelled) return;

        if (!localInspection) {
          setLoadError('Inspection not found.');
          setLoading(false);
          return;
        }

        const insp = localInspection.data;
        setInspection(insp);

        const itemList = localItems.map((li) => li.data);
        setItems(itemList);

        // Build asset lookup
        const aMap = new Map<string, Asset>();
        for (const ca of cachedAssets) {
          aMap.set(ca.data.id, ca.data);
          aMap.set(ca.data.asset_code, ca.data);
        }
        setAssetMap(aMap);

        // Pre-fill from existing inspection data
        if (insp.inspector_summary) setSummary(insp.inspector_summary);
        if (insp.closure_recommended) setClosureRecommended(true);
        if (insp.closure_reason) setClosureReason(insp.closure_reason);
        if (insp.signed_by) setSignedByName(insp.signed_by);
        if (insp.status === InspectionStatus.COMPLETED) setCompleted(true);

        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        captureError(error, { module: 'InspectionReview', operation: 'loadData' });
        setLoadError('Failed to load inspection data.');
        setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [siteId, inspectionId]);

  // ---- Tallies ----
  const conditionCounts = {
    good: items.filter((i) => i.overall_condition === ConditionRating.GOOD).length,
    fair: items.filter((i) => i.overall_condition === ConditionRating.FAIR).length,
    poor: items.filter((i) => i.overall_condition === ConditionRating.POOR).length,
    dangerous: items.filter((i) => i.overall_condition === ConditionRating.DANGEROUS).length,
  };

  const riskCounts = {
    veryHigh: items.filter((i) => i.risk_rating === RiskRating.VERY_HIGH).length,
    high: items.filter((i) => i.risk_rating === RiskRating.HIGH).length,
    medium: items.filter((i) => i.risk_rating === RiskRating.MEDIUM).length,
    low: items.filter((i) => i.risk_rating === RiskRating.LOW).length,
  };

  const totalDefects = items.reduce((sum, i) => sum + i.defects.length, 0);
  const hasDangerous = conditionCounts.dangerous > 0 || riskCounts.veryHigh > 0;

  // ---- Sign off ----
  const canSubmit = signedByName.trim().length >= 2 && !completed;

  const handleSignOff = useCallback(async () => {
    if (!canSubmit || !inspectionId || !inspection) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const now = new Date().toISOString();
      const startedAt = inspection.started_at ? new Date(inspection.started_at).getTime() : Date.now();
      const durationMinutes = Math.round((Date.now() - startedAt) / 60000);

      const updatedInspection: Inspection = {
        ...inspection,
        status: InspectionStatus.COMPLETED,
        completed_at: now,
        duration_minutes: durationMinutes,
        inspector_summary: summary || null,
        closure_recommended: closureRecommended,
        closure_reason: closureRecommended ? closureReason || null : null,
        immediate_action_required: hasDangerous,
        signed_by: signedByName.trim(),
        signed_at: now,
        very_high_risk_count: riskCounts.veryHigh,
        high_risk_count: riskCounts.high,
        medium_risk_count: riskCounts.medium,
        low_risk_count: riskCounts.low,
        total_defects: totalDefects,
        updated_at: now,
      };

      await inspections.update(updatedInspection);

      setInspection(updatedInspection);
      setCompleted(true);
    } catch (error) {
      captureError(error, { module: 'InspectionReview', operation: 'signOff' });
      setSubmitError('Failed to complete inspection. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, inspectionId, inspection, summary,
    closureRecommended, closureReason, hasDangerous,
    signedByName, riskCounts, totalDefects,
  ]);

  const handleBackToSite = useCallback(() => {
    navigate(`/sites/${siteId}`, { replace: true });
  }, [navigate, siteId]);

  // =============================================
  // RENDER: LOADING / ERROR
  // =============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet>
          <title>Review Inspection... | InspectVoice</title>
        </Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 iv-muted animate-spin" />
          <p className="iv-muted text-sm">Loading review...</p>
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
          <h2 className="text-lg font-semibold iv-text mb-2">Cannot Load Review</h2>
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

  // =============================================
  // RENDER: COMPLETED STATE
  // =============================================

  if (completed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Helmet>
          <title>Inspection Complete | InspectVoice</title>
        </Helmet>

        <div className="iv-panel p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-[#22C55E] mx-auto mb-4" />
          <h1 className="text-2xl font-bold iv-text mb-2">Inspection Complete</h1>
          <p className="iv-muted text-sm mb-1">
            {INSPECTION_TYPE_LABELS[inspection.inspection_type]} inspection signed off
          </p>
          <p className="iv-muted text-sm mb-6">
            {items.length} asset{items.length !== 1 ? 's' : ''} inspected · {totalDefects} defect{totalDefects !== 1 ? 's' : ''} recorded
          </p>

          {hasDangerous && (
            <div className="mb-6 p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-[#EF4444] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[#EF4444]">Immediate Action Required</p>
                  <p className="text-xs iv-muted mt-1">
                    Dangerous conditions or very high risk items were identified.
                    {closureRecommended && ' Site closure has been recommended.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleBackToSite}
              className="iv-btn-primary w-full flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Back to Site
            </button>
            <p className="text-xs iv-muted">
              PDF report will be generated when data syncs to the server.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // =============================================
  // RENDER: REVIEW FORM
  // =============================================

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>Review Inspection | InspectVoice</title>
        <meta name="description" content="Review and sign off the completed inspection." />
      </Helmet>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/sites/${siteId}/inspections/${inspectionId}/capture`}
          className="iv-btn-icon"
          aria-label="Back to capture"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold iv-text">Review Inspection</h1>
          <p className="text-sm iv-muted">
            {INSPECTION_TYPE_LABELS[inspection.inspection_type]} · {formatDate(inspection.started_at)}
          </p>
        </div>
      </div>

      {/* Error banner */}
      {submitError && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2" role="alert">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{submitError}</p>
        </div>
      )}

      {/* ── Summary Stats ── */}
      <div className="mb-4">
        <h2 className="text-base font-semibold iv-text mb-3">Inspection Summary</h2>

        {/* Condition overview */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <RiskSummaryCard
            label="Good"
            count={conditionCounts.good}
            colour="text-[#22C55E]"
            icon={<CheckCircle2 className="w-4 h-4" />}
          />
          <RiskSummaryCard
            label="Fair"
            count={conditionCounts.fair}
            colour="text-[#EAB308]"
            icon={<AlertCircle className="w-4 h-4" />}
          />
          <RiskSummaryCard
            label="Poor"
            count={conditionCounts.poor}
            colour="text-[#F97316]"
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <RiskSummaryCard
            label="Dangerous"
            count={conditionCounts.dangerous}
            colour="text-[#EF4444]"
            icon={<XCircle className="w-4 h-4" />}
          />
        </div>

        {/* Key figures */}
        <div className="grid grid-cols-3 gap-2">
          <div className="iv-panel p-3 text-center">
            <p className="text-xl font-bold iv-text">{items.length}</p>
            <p className="text-xs iv-muted">Assets Inspected</p>
          </div>
          <div className="iv-panel p-3 text-center">
            <p className={`text-xl font-bold ${totalDefects > 0 ? 'text-[#F97316]' : 'text-[#22C55E]'}`}>
              {totalDefects}
            </p>
            <p className="text-xs iv-muted">Total Defects</p>
          </div>
          <div className="iv-panel p-3 text-center">
            <p className={`text-xl font-bold ${hasDangerous ? 'text-[#EF4444]' : 'text-[#22C55E]'}`}>
              {hasDangerous ? 'Yes' : 'No'}
            </p>
            <p className="text-xs iv-muted">Action Required</p>
          </div>
        </div>
      </div>

      {/* ── Per-Asset Results ── */}
      <div className="mb-4">
        <h2 className="text-base font-semibold iv-text mb-3">
          Asset Results ({items.length})
        </h2>
        <div className="space-y-2">
          {items
            .sort((a, b) => a.asset_code.localeCompare(b.asset_code))
            .map((item) => (
              <AssetResultCard
                key={item.id}
                item={item}
                asset={assetMap.get(item.asset_id ?? '') ?? assetMap.get(item.asset_code)}
                siteId={siteId}
                inspectionId={inspectionId}
              />
            ))}
        </div>
      </div>

      {/* ── Inspector Summary ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#22C55E]" />
          Inspector Summary
        </h2>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Overall observations, recommendations, and follow-up actions..."
          rows={4}
          maxLength={5000}
          className="iv-input w-full resize-y"
          aria-label="Inspector summary"
        />
        <p className="text-xs iv-muted mt-1 text-right">{summary.length}/5000</p>
      </div>

      {/* ── Closure Recommendation (if dangerous) ── */}
      {hasDangerous && (
        <div className="iv-panel p-5 mb-4 border-l-4 border-l-[#EF4444]">
          <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
            Closure Recommendation
          </h2>
          <p className="text-sm iv-muted mb-3">
            Dangerous conditions were identified. Do you recommend closure of the site or specific assets?
          </p>

          <label className="flex items-center gap-3 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={closureRecommended}
              onChange={(e) => setClosureRecommended(e.target.checked)}
              className="w-4 h-4 rounded border-[#2A2F3A] bg-[#151920] text-[#EF4444] focus:ring-[#EF4444] focus:ring-offset-0"
            />
            <span className="text-sm iv-text">I recommend immediate closure or restricted access</span>
          </label>

          {closureRecommended && (
            <textarea
              value={closureReason}
              onChange={(e) => setClosureReason(e.target.value)}
              placeholder="Specify which assets/areas and the reason for closure..."
              rows={3}
              maxLength={2000}
              className="iv-input w-full resize-y"
              aria-label="Closure reason"
            />
          )}
        </div>
      )}

      {/* ── Sign Off ── */}
      <div className="iv-panel p-5 mb-6">
        <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
          <PenTool className="w-4 h-4 text-[#22C55E]" />
          Sign Off
        </h2>
        <p className="text-sm iv-muted mb-4">
          By signing off, you confirm that this inspection has been conducted in accordance with
          BS EN 1176-7 and all findings are accurately recorded.
        </p>

        <div className="mb-4">
          <label htmlFor="signed-by" className="iv-label mb-1 block">
            Inspector Name <span className="text-red-400">*</span>
          </label>
          <input
            id="signed-by"
            type="text"
            value={signedByName}
            onChange={(e) => setSignedByName(e.target.value)}
            placeholder="Full name"
            maxLength={200}
            className="iv-input w-full sm:w-72"
            aria-required="true"
            autoComplete="name"
          />
          {signedByName.length > 0 && signedByName.trim().length < 2 && (
            <p className="mt-1 text-xs text-red-400" role="alert">
              Please enter at least 2 characters
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleSignOff}
          disabled={!canSubmit || submitting}
          className="iv-btn-primary flex items-center gap-2 w-full sm:w-auto justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing off...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Complete &amp; Sign Off
            </>
          )}
        </button>
      </div>
    </div>
  );
}
