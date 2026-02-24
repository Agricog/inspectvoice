/**
 * InspectVoice — AI Completeness Check Modal
 * Feature 4: Review gate before sign-off
 *
 * Shows a full-screen modal with the AI completeness assessment.
 * Blocking issues prevent sign-off; advisory issues allow proceed.
 *
 * Two modes:
 *   1. ONLINE — calls the worker endpoint for server-side check
 *   2. OFFLINE — runs a local subset of checks (no AI, deterministic only)
 *
 * Flow:
 *   Inspector clicks "Complete & Sign Off"
 *   → Modal opens, runs completeness check
 *   → Shows results: blocking issues (red), advisory (amber), passes (green)
 *   → If no blocking issues: "Proceed to Sign Off" button
 *   → If blocking issues: "Go Back & Fix" button only
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Send,
  Wifi,
  WifiOff,
} from 'lucide-react';

import type { Inspection, InspectionItem } from '@/types';
import { RiskRating, ConditionRating } from '@/types';
import { useOnlineStatus } from '@hooks/useOnlineStatus';
import { getAssetTypeConfig } from '@config/assetTypes';

// =============================================
// TYPES
// =============================================

interface CompletenessIssue {
  code: string;
  severity: 'blocking' | 'advisory';
  message: string;
  assetCode: string | null;
  category: 'condition' | 'defect' | 'evidence' | 'compliance' | 'summary' | 'consistency';
}

interface CompletenessResult {
  canSignOff: boolean;
  totalIssues: number;
  blockingCount: number;
  advisoryCount: number;
  issues: CompletenessIssue[];
  summary: string;
  confidenceScore: number;
  qualityGrade: string;
}

interface CompletenessCheckModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close the modal */
  onClose: () => void;
  /** Proceed to sign-off (only callable when canSignOff is true) */
  onProceed: () => void;
  /** The inspection being reviewed */
  inspection: Inspection;
  /** Inspection items */
  items: InspectionItem[];
  /** Inspector summary text */
  inspectorSummary: string;
  /** Whether closure is recommended */
  closureRecommended: boolean;
  /** Closure reason text */
  closureReason: string;
}

// =============================================
// CATEGORY CONFIG
// =============================================

const CATEGORY_LABELS: Record<string, string> = {
  condition: 'Condition Ratings',
  defect: 'Defect Data',
  evidence: 'Photo & Evidence',
  compliance: 'BS EN Compliance',
  summary: 'Summary & Closure',
  consistency: 'Data Consistency',
};

const CATEGORY_ORDER = ['condition', 'defect', 'evidence', 'compliance', 'summary', 'consistency'];

// =============================================
// OFFLINE CHECKS (subset — runs without server)
// =============================================

function runOfflineChecks(
  inspection: Inspection,
  items: InspectionItem[],
  inspectorSummary: string,
  closureRecommended: boolean,
  closureReason: string,
): CompletenessResult {
  const issues: CompletenessIssue[] = [];

  // Condition ratings
  for (const item of items) {
    if (!item.overall_condition) {
      issues.push({
        code: 'MISSING_CONDITION',
        severity: 'blocking',
        message: `No condition rating set for ${item.asset_code}`,
        assetCode: item.asset_code,
        category: 'condition',
      });
    }
  }

  // Defect completeness
  for (const item of items) {
    for (let i = 0; i < item.defects.length; i++) {
      const defect = item.defects[i]!;
      const num = i + 1;

      if (!defect.description || defect.description.length < 10) {
        issues.push({
          code: 'DEFECT_MISSING_DESC',
          severity: 'blocking',
          message: `Defect ${num} on ${item.asset_code}: description too short`,
          assetCode: item.asset_code,
          category: 'defect',
        });
      }

      if (!defect.risk_rating) {
        issues.push({
          code: 'DEFECT_MISSING_RISK',
          severity: 'blocking',
          message: `Defect ${num} on ${item.asset_code}: no risk rating`,
          assetCode: item.asset_code,
          category: 'defect',
        });
      }

      if (!defect.remedial_action || defect.remedial_action.length < 10) {
        issues.push({
          code: 'DEFECT_MISSING_ACTION',
          severity: 'blocking',
          message: `Defect ${num} on ${item.asset_code}: remedial action missing or too vague`,
          assetCode: item.asset_code,
          category: 'defect',
        });
      }

      if (!defect.action_timeframe) {
        issues.push({
          code: 'DEFECT_MISSING_TIMEFRAME',
          severity: 'blocking',
          message: `Defect ${num} on ${item.asset_code}: no action timeframe`,
          assetCode: item.asset_code,
          category: 'defect',
        });
      }

      // BS EN reference for high risk
      if ((defect.risk_rating === RiskRating.VERY_HIGH || defect.risk_rating === RiskRating.HIGH) && !defect.bs_en_reference) {
        issues.push({
          code: 'DEFECT_MISSING_BSEN_REF',
          severity: 'advisory',
          message: `Defect ${num} on ${item.asset_code}: should reference BS EN clause`,
          assetCode: item.asset_code,
          category: 'compliance',
        });
      }
    }
  }

  // Condition/risk consistency
  for (const item of items) {
    if (item.overall_condition === ConditionRating.GOOD &&
        (item.risk_rating === RiskRating.VERY_HIGH || item.risk_rating === RiskRating.HIGH)) {
      issues.push({
        code: 'CONDITION_RISK_MISMATCH',
        severity: 'blocking',
        message: `${item.asset_code}: "Good" condition conflicts with high risk rating`,
        assetCode: item.asset_code,
        category: 'consistency',
      });
    }

    if (item.overall_condition === ConditionRating.DANGEROUS && item.risk_rating === RiskRating.LOW) {
      issues.push({
        code: 'CONDITION_RISK_MISMATCH',
        severity: 'blocking',
        message: `${item.asset_code}: "Dangerous" condition conflicts with low risk`,
        assetCode: item.asset_code,
        category: 'consistency',
      });
    }

    if (item.defects.length > 0 && item.overall_condition === ConditionRating.GOOD) {
      issues.push({
        code: 'GOOD_WITH_DEFECTS',
        severity: 'advisory',
        message: `${item.asset_code}: rated "Good" but has ${item.defects.length} defect(s)`,
        assetCode: item.asset_code,
        category: 'consistency',
      });
    }
  }

  // Defective assets without notes
  for (const item of items) {
    if (item.defects.length > 0 && !item.voice_transcript && !item.inspector_notes) {
      issues.push({
        code: 'DEFECTIVE_NO_NOTES',
        severity: 'advisory',
        message: `${item.asset_code}: has defects but no voice transcript or notes`,
        assetCode: item.asset_code,
        category: 'evidence',
      });
    }
  }

  // Closure
  const veryHighCount = items.filter((i) => i.risk_rating === RiskRating.VERY_HIGH).length;
  if (veryHighCount > 0 && !closureRecommended) {
    issues.push({
      code: 'CLOSURE_NOT_RECOMMENDED',
      severity: 'advisory',
      message: `${veryHighCount} very-high risk item(s) but closure not recommended`,
      assetCode: null,
      category: 'consistency',
    });
  }

  if (closureRecommended && !closureReason) {
    issues.push({
      code: 'CLOSURE_NO_REASON',
      severity: 'blocking',
      message: 'Closure recommended but no reason provided',
      assetCode: null,
      category: 'summary',
    });
  }

  // Summary
  if (!inspectorSummary || inspectorSummary.length < 20) {
    issues.push({
      code: 'MISSING_SUMMARY',
      severity: 'advisory',
      message: 'Inspector summary is missing or very brief',
      assetCode: null,
      category: 'summary',
    });
  }

  // No assets
  if (items.length === 0) {
    issues.push({
      code: 'NO_ASSETS',
      severity: 'blocking',
      message: 'No assets have been inspected',
      assetCode: null,
      category: 'evidence',
    });
  }

  // Score
  let score = 100;
  for (const issue of issues) {
    score -= issue.severity === 'blocking' ? 15 : 5;
  }
  score = Math.max(0, Math.min(100, score));
  if (items.length === 0) score = 0;

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  const blockingCount = issues.filter((i) => i.severity === 'blocking').length;
  const advisoryCount = issues.filter((i) => i.severity === 'advisory').length;

  let summary: string;
  if (blockingCount === 0 && advisoryCount === 0) {
    summary = 'Inspection is complete and ready for sign-off.';
  } else if (blockingCount === 0) {
    summary = `Ready for sign-off. ${advisoryCount} advisory note${advisoryCount !== 1 ? 's' : ''}.`;
  } else {
    summary = `${blockingCount} issue${blockingCount !== 1 ? 's' : ''} must be resolved before sign-off.`;
  }

  return {
    canSignOff: blockingCount === 0,
    totalIssues: issues.length,
    blockingCount,
    advisoryCount,
    issues,
    summary,
    confidenceScore: score,
    qualityGrade: grade,
  };
}

// =============================================
// CATEGORY GROUP COMPONENT
// =============================================

function IssueCategoryGroup({
  category,
  issues,
}: {
  category: string;
  issues: CompletenessIssue[];
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const blocking = issues.filter((i) => i.severity === 'blocking');
  const advisory = issues.filter((i) => i.severity === 'advisory');
  const label = CATEGORY_LABELS[category] ?? category;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between py-2 text-left"
      >
        <div className="flex items-center gap-2">
          {blocking.length > 0 ? (
            <XCircle className="w-4 h-4 text-[#EF4444]" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
          )}
          <span className="text-sm font-medium iv-text">{label}</span>
          {blocking.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#EF4444]/15 text-[#EF4444]">
              {blocking.length} blocking
            </span>
          )}
          {advisory.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#EAB308]/15 text-[#EAB308]">
              {advisory.length} advisory
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 iv-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 iv-muted" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1.5 ml-6">
          {issues.map((issue, idx) => (
            <div
              key={`${issue.code}-${idx}`}
              className={`flex items-start gap-2 text-sm p-2 rounded-lg ${
                issue.severity === 'blocking'
                  ? 'bg-[#EF4444]/10 border border-[#EF4444]/20'
                  : 'bg-[#EAB308]/10 border border-[#EAB308]/20'
              }`}
            >
              {issue.severity === 'blocking' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-[#EAB308] flex-shrink-0 mt-0.5" />
              )}
              <span className={issue.severity === 'blocking' ? 'text-[#FCA5A5]' : 'text-[#FCD34D]'}>
                {issue.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================
// GRADE BADGE
// =============================================

function GradeBadge({ grade, score }: { grade: string; score: number }): JSX.Element {
  const gradeColour =
    grade === 'A' ? 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/10' :
    grade === 'B' ? 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/10' :
    grade === 'C' ? 'text-[#EAB308] border-[#EAB308]/30 bg-[#EAB308]/10' :
    grade === 'D' ? 'text-[#F97316] border-[#F97316]/30 bg-[#F97316]/10' :
    'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/10';

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${gradeColour}`}>
      <span className="text-2xl font-bold">{grade}</span>
      <div className="text-left">
        <p className="text-xs font-medium">Quality</p>
        <p className="text-xs opacity-75">{score}/100</p>
      </div>
    </div>
  );
}

// =============================================
// MAIN MODAL COMPONENT
// =============================================

export default function CompletenessCheckModal({
  isOpen,
  onClose,
  onProceed,
  inspection,
  items,
  inspectorSummary,
  closureRecommended,
  closureReason,
}: CompletenessCheckModalProps): JSX.Element | null {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<CompletenessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const online = useOnlineStatus();

  // Run check when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setResult(null);
    setError(null);

    async function runCheck(): Promise<void> {
      try {
        if (!online) {
          // Offline: run local checks only
          setIsOffline(true);
          const localResult = runOfflineChecks(
            inspection, items, inspectorSummary, closureRecommended, closureReason,
          );
          setResult(localResult);
          setLoading(false);
          return;
        }

        setIsOffline(false);

        // Online: call worker endpoint
        const response = await fetch(`/api/v1/inspections/${inspection.id}/completeness-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          // Fallback to local checks if server fails
          const localResult = runOfflineChecks(
            inspection, items, inspectorSummary, closureRecommended, closureReason,
          );
          setResult(localResult);
          setIsOffline(true);
          setLoading(false);
          return;
        }

        const json = await response.json() as { data: CompletenessResult };
        setResult(json.data);
        setLoading(false);
      } catch {
        // Fallback to local
        const localResult = runOfflineChecks(
          inspection, items, inspectorSummary, closureRecommended, closureReason,
        );
        setResult(localResult);
        setIsOffline(true);
        setLoading(false);
      }
    }

    // Small delay so modal animation completes
    const timer = setTimeout(() => void runCheck(), 300);
    return () => clearTimeout(timer);
  }, [isOpen, inspection, items, inspectorSummary, closureRecommended, closureReason, online]);

  if (!isOpen) return null;

  // Group issues by category
  const groupedIssues = new Map<string, CompletenessIssue[]>();
  if (result) {
    for (const category of CATEGORY_ORDER) {
      const catIssues = result.issues.filter((i) => i.category === category);
      if (catIssues.length > 0) {
        groupedIssues.set(category, catIssues);
      }
    }
  }

  // Categories with no issues (passes)
  const passedCategories = result
    ? CATEGORY_ORDER.filter((cat) => !groupedIssues.has(cat) && result.issues.length > 0)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151920] w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#151920] border-b border-[#2A2F3A] px-5 py-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {loading ? (
                <Loader2 className="w-6 h-6 text-[#22C55E] animate-spin" />
              ) : result?.canSignOff ? (
                <ShieldCheck className="w-6 h-6 text-[#22C55E]" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-[#EF4444]" />
              )}
              <div>
                <h2 className="text-base font-semibold iv-text">
                  {loading ? 'Checking Inspection...' : 'Completeness Review'}
                </h2>
                {isOffline && (
                  <p className="text-xs text-[#EAB308] flex items-center gap-1">
                    <WifiOff className="w-3 h-3" />
                    Offline — basic checks only
                  </p>
                )}
                {!isOffline && !loading && (
                  <p className="text-xs iv-muted flex items-center gap-1">
                    <Wifi className="w-3 h-3" />
                    Full compliance check
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="iv-btn-icon"
              aria-label="Close"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="relative">
                <ShieldCheck className="w-16 h-16 text-[#22C55E]/20" />
                <Loader2 className="w-8 h-8 text-[#22C55E] animate-spin absolute top-4 left-4" />
              </div>
              <div className="text-center">
                <p className="iv-text text-sm font-medium">Analysing inspection data</p>
                <p className="iv-muted text-xs mt-1">Checking completeness, consistency, and compliance...</p>
              </div>
            </div>
          )}

          {/* Results */}
          {!loading && result && (
            <>
              {/* Summary banner */}
              <div className={`p-4 rounded-lg mb-4 flex items-start gap-3 ${
                result.canSignOff
                  ? 'bg-[#22C55E]/10 border border-[#22C55E]/20'
                  : 'bg-[#EF4444]/10 border border-[#EF4444]/20'
              }`}>
                {result.canSignOff ? (
                  <ShieldCheck className="w-6 h-6 text-[#22C55E] flex-shrink-0" />
                ) : (
                  <ShieldX className="w-6 h-6 text-[#EF4444] flex-shrink-0" />
                )}
                <div>
                  <p className={`text-sm font-medium ${result.canSignOff ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                    {result.canSignOff ? 'Ready for Sign-Off' : 'Issues Found'}
                  </p>
                  <p className="text-xs iv-muted mt-0.5">{result.summary}</p>
                </div>
                <div className="ml-auto flex-shrink-0">
                  <GradeBadge grade={result.qualityGrade} score={result.confidenceScore} />
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="iv-panel p-2.5 text-center">
                  <p className={`text-lg font-bold ${result.blockingCount > 0 ? 'text-[#EF4444]' : 'text-[#22C55E]'}`}>
                    {result.blockingCount}
                  </p>
                  <p className="text-xs iv-muted">Blocking</p>
                </div>
                <div className="iv-panel p-2.5 text-center">
                  <p className={`text-lg font-bold ${result.advisoryCount > 0 ? 'text-[#EAB308]' : 'text-[#22C55E]'}`}>
                    {result.advisoryCount}
                  </p>
                  <p className="text-xs iv-muted">Advisory</p>
                </div>
                <div className="iv-panel p-2.5 text-center">
                  <p className="text-lg font-bold text-[#22C55E]">{passedCategories.length}</p>
                  <p className="text-xs iv-muted">Passed</p>
                </div>
              </div>

              {/* Issue categories */}
              {groupedIssues.size > 0 && (
                <div className="mb-4">
                  {Array.from(groupedIssues.entries()).map(([category, catIssues]) => (
                    <IssueCategoryGroup
                      key={category}
                      category={category}
                      issues={catIssues}
                    />
                  ))}
                </div>
              )}

              {/* Passed categories */}
              {passedCategories.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs iv-muted mb-2">Passed checks:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {passedCategories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {CATEGORY_LABELS[cat]}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* All clear message */}
              {result.totalIssues === 0 && (
                <div className="text-center py-6">
                  <ShieldCheck className="w-12 h-12 text-[#22C55E] mx-auto mb-2" />
                  <p className="text-sm iv-text font-medium">All checks passed</p>
                  <p className="text-xs iv-muted mt-1">
                    Inspection data is complete, consistent, and compliant.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!loading && result && (
          <div className="sticky bottom-0 bg-[#151920] border-t border-[#2A2F3A] px-5 py-4">
            {result.canSignOff ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="iv-btn-secondary flex-1 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Go Back
                </button>
                <button
                  type="button"
                  onClick={onProceed}
                  className="iv-btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Proceed to Sign Off
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="iv-btn-secondary w-full flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Go Back &amp; Fix Issues
              </button>
            )}

            {result.canSignOff && result.advisoryCount > 0 && (
              <p className="text-xs iv-muted text-center mt-2">
                {result.advisoryCount} advisory note{result.advisoryCount !== 1 ? 's' : ''} — review recommended but not required
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
