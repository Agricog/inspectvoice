/**
 * InspectVoice — Inspection Review & Summary
 * Batch 15 + Feature 4 (AI completeness check gate) + AI Normalisation
 *
 * Route: /sites/:siteId/inspections/:inspectionId/review
 *
 * After all assets inspected, the inspector reviews:
 *   1. Overall summary — risk counts, defect totals
 *   2. Per-asset results — condition, transcript, photos, notes
 *   3. Inspector summary notes (free text)
 *   4. Closure recommendation (if dangerous conditions found)
 *   5. AI normalisation — per-field or batch at sign-off
 *   6. AI completeness check (review gate before sign-off)
 *   7. Digital sign-off → marks inspection as COMPLETED
 *   8. Navigates to site page (PDF generation happens async via sync)
 *
 * Features:
 *   - Loads all inspection items from IndexedDB
 *   - Calculates risk/defect tallies
 *   - Per-asset expandable cards with full detail
 *   - Per-field "Normalise" button on transcripts, notes, defects
 *   - Batch normalise all text fields before sign-off
 *   - Normalisation review panel with diff view + accept/reject
 *   - Inspector summary textarea
 *   - Closure recommendation toggle (visible if dangerous/very high risk found)
 *   - AI completeness check modal before sign-off
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
  Edit,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { inspections, inspectionItems } from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import {
  InspectionStatus,
  INSPECTION_TYPE_LABELS,
  ConditionRating,
  CONDITION_LABELS,
  RiskRating,
  RISK_RATING_LABELS,
} from '@/types';
import type { Inspection, InspectionItem } from '@/types';
import { getAssetTypeConfig } from '@config/assetTypes';
import CompletenessCheckModal from '@components/CompletenessCheckModal';
import { NormaliseButton } from '@components/NormaliseButton';
import NormalisationReviewPanel from '@components/NormalisationReviewPanel';
import type { NormalisationSuggestion, BatchNormaliseRequest } from '@/types/normalisation';

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
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
// ASSET RESULT CARD (expandable, with normalisation)
// =============================================

function AssetResultCard({
  item,
  siteId,
  inspectionId,
  onFieldNormalised,
}: {
  item: InspectionItem;
  siteId: string;
  inspectionId: string;
  onFieldNormalised: (itemId: string, fieldName: string, normalisedText: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const config = getAssetTypeConfig(item.asset_type);
  const typeName = config?.name ?? item.asset_type;

  const hasTranscript = Boolean(item.voice_transcript);
  const hasNotes = Boolean(item.inspector_notes);
  const defectCount = item.defects.length;

  const handleNormalised = useCallback(
    (fieldName: string, normalisedText: string) => {
      onFieldNormalised(item.id, fieldName, normalisedText);
    },
    [item.id, onFieldNormalised],
  );

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
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs iv-muted flex items-center gap-1">
                  <Mic className="w-3 h-3" />
                  Voice Transcript
                </p>
                <NormaliseButton
                  fieldType="voice_transcript"
                  fieldValue={item.voice_transcript ?? ''}
                  entityId={item.id}
                  entityType="inspection_item"
                  onNormalised={(text) => handleNormalised('voice_transcript', text)}
                />
              </div>
              <p className="text-sm iv-text bg-[#1C2029] p-2 rounded-lg whitespace-pre-wrap">
                {item.voice_transcript}
              </p>
            </div>
          )}

          {/* Inspector notes */}
          {hasNotes && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs iv-muted flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Inspector Notes
                </p>
                <NormaliseButton
                  fieldType="inspector_notes"
                  fieldValue={item.inspector_notes ?? ''}
                  entityId={item.id}
                  entityType="inspection_item"
                  onNormalised={(text) => handleNormalised('inspector_notes', text)}
                />
              </div>
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
                {item.defects.map((defect, idx) => {
                  const defectText = typeof defect === 'string' ? defect : JSON.stringify(defect);
                  return (
                    <div key={idx} className="text-sm iv-text bg-[#1C2029] p-2 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <AlertCircle className="w-3.5 h-3.5 text-[#F97316] flex-shrink-0 mt-0.5" />
                          <span>{defectText}</span>
                        </div>
                        <NormaliseButton
                          fieldType="defect_description"
                          fieldValue={defectText}
                          entityId={item.id}
                          entityType="inspection_item"
                          onNormalised={(text) => handleNormalised(`defect_${idx}`, text)}
                        />
                      </div>
                    </div>
                  );
                })}
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

  // ---- Form ----
  const [summary, setSummary] = useState('');
  const [closureRecommended, setClosureRecommended] = useState(false);
  const [closureReason, setClosureReason] = useState('');
  const [signedByName, setSignedByName] = useState('');

  // ---- Submit ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // ---- Completeness check modal ----
  const [showCompletenessCheck, setShowCompletenessCheck] = useState(false);

  // ---- Normalisation ----
  const [batchNormalising, setBatchNormalising] = useState(false);
  const [batchSuggestions, setBatchSuggestions] = useState<NormalisationSuggestion[]>([]);
  const [showNormalisationReview, setShowNormalisationReview] = useState(false);

  // ---- Load data ----
  useEffect(() => {
    if (!siteId || !inspectionId) return;

    let cancelled = false;

    async function loadData(): Promise<void> {
      try {
        const [localInspection, localItems] = await Promise.all([
          inspections.get(inspectionId!),
          inspectionItems.getByInspection(inspectionId!),
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

        // Pre-fill from existing inspection data
        if (insp.inspector_summary) setSummary(insp.inspector_summary);
        if (insp.closure_recommended) setClosureRecommended(true);
        if (insp.closure_reason) setClosureReason(insp.closure_reason);
        if (insp.signed_by) setSignedByName(insp.signed_by);
        if (insp.status === InspectionStatus.SIGNED) setCompleted(true);

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

  // ---- Per-field normalisation callback ----
  const handleFieldNormalised = useCallback(
    (itemId: string, fieldName: string, normalisedText: string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;

          if (fieldName === 'voice_transcript') {
            return { ...item, voice_transcript: normalisedText };
          }
          if (fieldName === 'inspector_notes') {
            return { ...item, inspector_notes: normalisedText };
          }
          // Defect fields are named defect_0, defect_1, etc.
          if (fieldName.startsWith('defect_')) {
            const defectIndex = parseInt(fieldName.split('_')[1], 10);
            if (!isNaN(defectIndex) && defectIndex < item.defects.length) {
              const updatedDefects = [...item.defects];
              updatedDefects[defectIndex] = normalisedText;
              return { ...item, defects: updatedDefects };
            }
          }
          return item;
        }),
      );
    },
    [],
  );

  // ---- Batch normalise all text fields ----
  const handleBatchNormalise = useCallback(async () => {
    if (!inspectionId) return;

    setBatchNormalising(true);
    setBatchSuggestions([]);

    try {
      // Build batch request from all text fields across all items
      const fields: BatchNormaliseRequest['fields'] = [];

      // Inspector summary
      if (summary.trim()) {
        fields.push({
          entity_id: inspectionId,
          entity_type: 'inspection',
          field_name: 'inspector_summary',
          original_text: summary,
        });
      }

      // Closure reason
      if (closureRecommended && closureReason.trim()) {
        fields.push({
          entity_id: inspectionId,
          entity_type: 'inspection',
          field_name: 'closure_reason',
          original_text: closureReason,
        });
      }

      // Per-item fields
      for (const item of items) {
        if (item.voice_transcript) {
          fields.push({
            entity_id: item.id,
            entity_type: 'inspection_item',
            field_name: 'voice_transcript',
            original_text: item.voice_transcript,
          });
        }
        if (item.inspector_notes) {
          fields.push({
            entity_id: item.id,
            entity_type: 'inspection_item',
            field_name: 'inspector_notes',
            original_text: item.inspector_notes,
          });
        }
        for (let i = 0; i < item.defects.length; i++) {
          const defectText = typeof item.defects[i] === 'string'
            ? item.defects[i]
            : JSON.stringify(item.defects[i]);
          if (defectText) {
            fields.push({
              entity_id: item.id,
              entity_type: 'inspection_item',
              field_name: `defect_${i}`,
              original_text: defectText as string,
            });
          }
        }
      }

      if (fields.length === 0) {
        setBatchNormalising(false);
        return;
      }

      const { secureFetch } = await import('@hooks/useFetch');
      const response = await secureFetch<{ data: { suggestions: NormalisationSuggestion[] } }>(
        '/api/v1/normalise/batch',
        {
          method: 'POST',
          body: { inspection_id: inspectionId, fields },
        },
      );

      const suggestions = response.data?.suggestions ?? [];
      setBatchSuggestions(suggestions);

      if (suggestions.length > 0) {
        setShowNormalisationReview(true);
      }
    } catch (error) {
      captureError(error, { module: 'InspectionReview', operation: 'batchNormalise' });
    } finally {
      setBatchNormalising(false);
    }
  }, [inspectionId, summary, closureRecommended, closureReason, items]);

  // ---- Accept normalisation suggestion ----
  const handleAcceptSuggestion = useCallback(
    (suggestion: NormalisationSuggestion) => {
      // Apply to inspection-level fields
      if (suggestion.entity_type === 'inspection') {
        if (suggestion.field_name === 'inspector_summary') {
          setSummary(suggestion.normalised_text);
        } else if (suggestion.field_name === 'closure_reason') {
          setClosureReason(suggestion.normalised_text);
        }
        return;
      }

      // Apply to inspection_item fields
      handleFieldNormalised(suggestion.entity_id, suggestion.field_name, suggestion.normalised_text);
    },
    [handleFieldNormalised],
  );

  // ---- Accept all suggestions ----
  const handleAcceptAll = useCallback(() => {
    for (const suggestion of batchSuggestions) {
      handleAcceptSuggestion(suggestion);
    }
    setShowNormalisationReview(false);
    setBatchSuggestions([]);
  }, [batchSuggestions, handleAcceptSuggestion]);

  // ---- Reject all — just close the panel ----
  const handleRejectAll = useCallback(() => {
    setShowNormalisationReview(false);
    setBatchSuggestions([]);
  }, []);

  // ---- Completeness check → opens modal instead of directly signing ----
  const canSubmit = signedByName.trim().length >= 2 && !completed;

  const handleRequestSignOff = useCallback(() => {
    if (!canSubmit) return;
    setShowCompletenessCheck(true);
  }, [canSubmit]);

  // ---- Actual sign off (called after completeness check passes) ----
  const handleSignOff = useCallback(async () => {
    if (!canSubmit || !inspectionId || !inspection) return;

    setShowCompletenessCheck(false);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const now = new Date().toISOString();
      const startedAt = inspection.started_at ? new Date(inspection.started_at).getTime() : Date.now();
      const durationMinutes = Math.round((Date.now() - startedAt) / 60000);

      const updatedData: Partial<Inspection> = {
        status: InspectionStatus.SIGNED,
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

      const result = await inspections.update(inspectionId, updatedData);

      if (result) {
        setInspection(result.data);
      }
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
                siteId={siteId}
                inspectionId={inspectionId}
                onFieldNormalised={handleFieldNormalised}
              />
            ))}
        </div>
      </div>

      {/* ── Inspector Summary ── */}
      <div className="iv-panel p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold iv-text flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#22C55E]" />
            Inspector Summary
          </h2>
          {summary.trim() && (
            <NormaliseButton
              fieldType="inspector_summary"
              fieldValue={summary}
              entityId={inspectionId}
              entityType="inspection"
              onNormalised={(text) => setSummary(text)}
            />
          )}
        </div>
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

      {/* ── Batch Normalise ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-iv-accent" />
          AI Style Normalisation
        </h2>
        <p className="text-sm iv-muted mb-4">
          Normalise all text fields to your organisation&apos;s house style before sign-off.
          You&apos;ll review every suggestion before anything is applied.
        </p>
        <button
          type="button"
          onClick={() => void handleBatchNormalise()}
          disabled={batchNormalising || items.length === 0}
          className="iv-btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {batchNormalising ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Normalising…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Normalise All Fields
            </>
          )}
        </button>
      </div>

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

        {/* Button now opens completeness check modal instead of directly signing */}
        <button
          type="button"
          onClick={handleRequestSignOff}
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
              <ShieldCheck className="w-4 h-4" />
              Review &amp; Sign Off
            </>
          )}
        </button>
        <p className="text-xs iv-muted mt-2">
          An AI completeness check will run before final sign-off
        </p>
      </div>

      {/* ── Completeness Check Modal ── */}
      {inspection && (
        <CompletenessCheckModal
          isOpen={showCompletenessCheck}
          onClose={() => setShowCompletenessCheck(false)}
          onProceed={() => void handleSignOff()}
          inspection={inspection}
          items={items}
          inspectorSummary={summary}
          closureRecommended={closureRecommended}
          closureReason={closureReason}
        />
      )}

      {/* ── Normalisation Review Panel ── */}
      <NormalisationReviewPanel
        isOpen={showNormalisationReview}
        onClose={() => setShowNormalisationReview(false)}
        suggestions={batchSuggestions}
        onAccept={handleAcceptSuggestion}
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
      />
    </div>
  );
}
