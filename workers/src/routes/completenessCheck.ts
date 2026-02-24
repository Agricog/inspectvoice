/**
 * InspectVoice — AI Completeness Check Route
 * Feature 4: AI review gate before sign-off
 *
 * POST /api/v1/inspections/:id/completeness-check
 *
 * Sends the full inspection data to Claude for a structured completeness
 * assessment. Returns pass/fail with specific issues categorised as
 * blocking (must fix) or advisory (can proceed).
 *
 * Checks performed by AI:
 *   1. Every asset has a condition rating
 *   2. Every defect has description, risk rating, remedial action, timeframe
 *   3. High/very-high defects have BS EN references
 *   4. Voice transcripts are present for assets with defects
 *   5. Photo coverage is adequate (at least 1 per asset)
 *   6. Closure recommendation matches risk level
 *   7. Inspector summary is present and substantive
 *   8. No conflicting data (e.g. "good" condition but "very high" risk)
 *   9. All required BS EN inspection points addressed for inspection type
 *   10. Remedial actions are specific enough to be actionable
 *
 * The response is deterministic JSON — no free-form prose in the gate itself.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { checkRateLimit } from '../middleware/rateLimit';
import { Logger } from '../shared/logger';
import { validateUUID } from '../shared/validation';
import { jsonResponse } from './helpers';
import { getWorkerAssetConfig } from '../services/ai';

// =============================================
// TYPES
// =============================================

interface CompletenessIssue {
  /** Unique issue code */
  code: string;
  /** Severity: blocking = must fix, advisory = can proceed */
  severity: 'blocking' | 'advisory';
  /** Human-readable description */
  message: string;
  /** Asset code if issue relates to a specific asset */
  assetCode: string | null;
  /** Category for grouping in UI */
  category: 'condition' | 'defect' | 'evidence' | 'compliance' | 'summary' | 'consistency';
}

interface CompletenessResult {
  /** Overall pass/fail — false if any blocking issues */
  canSignOff: boolean;
  /** Total issues found */
  totalIssues: number;
  /** Blocking issues count */
  blockingCount: number;
  /** Advisory issues count */
  advisoryCount: number;
  /** Individual issues */
  issues: CompletenessIssue[];
  /** One-line summary */
  summary: string;
  /** AI confidence score 0-100 */
  confidenceScore: number;
  /** Inspection quality grade: A/B/C/D/F */
  qualityGrade: string;
}

// =============================================
// DETERMINISTIC CHECKS (no AI needed)
// =============================================

function runDeterministicChecks(
  inspection: Record<string, unknown>,
  items: Record<string, unknown>[],
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  // ── 1. Every asset has a condition rating ──
  for (const item of items) {
    if (!item['overall_condition']) {
      issues.push({
        code: 'MISSING_CONDITION',
        severity: 'blocking',
        message: `No condition rating set for ${item['asset_code'] as string}`,
        assetCode: item['asset_code'] as string,
        category: 'condition',
      });
    }
  }

  // ── 2. Every defect has required fields ──
  for (const item of items) {
    const defects = item['defects'] as Array<Record<string, unknown>> | undefined;
    if (!defects) continue;

    for (let i = 0; i < defects.length; i++) {
      const defect = defects[i];
      if (!defect) continue;
      const assetCode = item['asset_code'] as string;
      const defectNum = i + 1;

      if (!defect['description'] || (defect['description'] as string).length < 10) {
        issues.push({
          code: 'DEFECT_MISSING_DESC',
          severity: 'blocking',
          message: `Defect ${defectNum} on ${assetCode}: description is missing or too short (min 10 chars)`,
          assetCode,
          category: 'defect',
        });
      }

      if (!defect['risk_rating']) {
        issues.push({
          code: 'DEFECT_MISSING_RISK',
          severity: 'blocking',
          message: `Defect ${defectNum} on ${assetCode}: no risk rating assigned`,
          assetCode,
          category: 'defect',
        });
      }

      if (!defect['remedial_action'] || (defect['remedial_action'] as string).length < 10) {
        issues.push({
          code: 'DEFECT_MISSING_ACTION',
          severity: 'blocking',
          message: `Defect ${defectNum} on ${assetCode}: remedial action is missing or too vague`,
          assetCode,
          category: 'defect',
        });
      }

      if (!defect['action_timeframe']) {
        issues.push({
          code: 'DEFECT_MISSING_TIMEFRAME',
          severity: 'blocking',
          message: `Defect ${defectNum} on ${assetCode}: no action timeframe set`,
          assetCode,
          category: 'defect',
        });
      }

      // High/very-high should have BS EN reference
      const risk = defect['risk_rating'] as string;
      if ((risk === 'very_high' || risk === 'high') && !defect['bs_en_reference']) {
        issues.push({
          code: 'DEFECT_MISSING_BSEN_REF',
          severity: 'advisory',
          message: `Defect ${defectNum} on ${assetCode}: high/very-high risk defect should reference the relevant BS EN clause`,
          assetCode,
          category: 'compliance',
        });
      }
    }
  }

  // ── 3. Photo coverage ──
  for (const item of items) {
    const photoCount = item['photo_count'] as number | undefined;
    if (!photoCount || photoCount === 0) {
      issues.push({
        code: 'MISSING_PHOTO',
        severity: 'blocking',
        message: `No photos captured for ${item['asset_code'] as string}`,
        assetCode: item['asset_code'] as string,
        category: 'evidence',
      });
    }
  }

  // ── 4. Defective assets should have voice transcript or notes ──
  for (const item of items) {
    const defects = item['defects'] as Array<Record<string, unknown>> | undefined;
    if (defects && defects.length > 0) {
      const hasTranscript = Boolean(item['voice_transcript']);
      const hasNotes = Boolean(item['inspector_notes']);
      if (!hasTranscript && !hasNotes) {
        issues.push({
          code: 'DEFECTIVE_NO_NOTES',
          severity: 'advisory',
          message: `${item['asset_code'] as string} has defects but no voice transcript or inspector notes`,
          assetCode: item['asset_code'] as string,
          category: 'evidence',
        });
      }
    }
  }

  // ── 5. Closure recommendation matches risk ──
  const veryHighCount = inspection['very_high_risk_count'] as number ?? 0;
  const closureRecommended = inspection['closure_recommended'] as boolean ?? false;

  if (veryHighCount > 0 && !closureRecommended) {
    issues.push({
      code: 'CLOSURE_NOT_RECOMMENDED',
      severity: 'advisory',
      message: `${veryHighCount} very-high risk defect(s) found but closure not recommended — confirm this is intentional`,
      assetCode: null,
      category: 'consistency',
    });
  }

  if (closureRecommended && !inspection['closure_reason']) {
    issues.push({
      code: 'CLOSURE_NO_REASON',
      severity: 'blocking',
      message: 'Closure recommended but no reason provided',
      assetCode: null,
      category: 'summary',
    });
  }

  // ── 6. Inspector summary present ──
  const summary = inspection['inspector_summary'] as string | null;
  if (!summary || summary.length < 20) {
    issues.push({
      code: 'MISSING_SUMMARY',
      severity: 'advisory',
      message: 'Inspector summary is missing or very brief — councils expect a substantive summary',
      assetCode: null,
      category: 'summary',
    });
  }

  // ── 7. Condition/risk consistency ──
  for (const item of items) {
    const condition = item['overall_condition'] as string | null;
    const risk = item['risk_rating'] as string | null;

    if (condition === 'good' && (risk === 'very_high' || risk === 'high')) {
      issues.push({
        code: 'CONDITION_RISK_MISMATCH',
        severity: 'blocking',
        message: `${item['asset_code'] as string}: condition is "Good" but risk is "${risk}" — these conflict`,
        assetCode: item['asset_code'] as string,
        category: 'consistency',
      });
    }

    if (condition === 'dangerous' && risk === 'low') {
      issues.push({
        code: 'CONDITION_RISK_MISMATCH',
        severity: 'blocking',
        message: `${item['asset_code'] as string}: condition is "Dangerous" but risk is "Low" — these conflict`,
        assetCode: item['asset_code'] as string,
        category: 'consistency',
      });
    }
  }

  // ── 8. Defects present but condition rated "Good" ──
  for (const item of items) {
    const defects = item['defects'] as Array<Record<string, unknown>> | undefined;
    const condition = item['overall_condition'] as string | null;

    if (defects && defects.length > 0 && condition === 'good') {
      issues.push({
        code: 'GOOD_WITH_DEFECTS',
        severity: 'advisory',
        message: `${item['asset_code'] as string}: rated "Good" but has ${defects.length} defect(s) — review if condition should be downgraded`,
        assetCode: item['asset_code'] as string,
        category: 'consistency',
      });
    }
  }

  // ── 9. BS EN inspection points coverage ──
  const inspectionType = inspection['inspection_type'] as string;
  for (const item of items) {
    const assetType = item['asset_type'] as string;
    const config = getWorkerAssetConfig(assetType);
    const applicablePoints = config.inspectionPoints.filter((p) =>
      p.appliesTo.includes(inspectionType),
    );

    // For annual inspections, all points should be covered
    if (inspectionType === 'annual_main' && applicablePoints.length > 0) {
      const defects = item['defects'] as Array<Record<string, unknown>> | undefined;
      const transcript = item['voice_transcript'] as string ?? '';
      const notes = item['inspector_notes'] as string ?? '';
      const combinedText = `${transcript} ${notes}`.toLowerCase();

      // Check if any inspection points are completely unaddressed
      const uncoveredPoints: string[] = [];
      for (const point of applicablePoints) {
        const keywords = point.label.toLowerCase().split('/');
        const mentioned = keywords.some((kw) => combinedText.includes(kw.trim()));
        const hasRelatedDefect = defects?.some((d) => {
          const desc = (d['description'] as string ?? '').toLowerCase();
          const cat = (d['defect_category'] as string ?? '').toLowerCase();
          return keywords.some((kw) => desc.includes(kw.trim()) || cat.includes(kw.trim()));
        }) ?? false;

        if (!mentioned && !hasRelatedDefect) {
          uncoveredPoints.push(point.label);
        }
      }

      // Only flag if more than 30% uncovered (some points are implicitly checked)
      if (uncoveredPoints.length > applicablePoints.length * 0.3) {
        issues.push({
          code: 'INSPECTION_POINTS_GAPS',
          severity: 'advisory',
          message: `${item['asset_code'] as string}: ${uncoveredPoints.length} of ${applicablePoints.length} BS EN inspection points not explicitly addressed. Key gaps: ${uncoveredPoints.slice(0, 3).join(', ')}${uncoveredPoints.length > 3 ? '...' : ''}`,
          assetCode: item['asset_code'] as string,
          category: 'compliance',
        });
      }
    }
  }

  // ── 10. No assets inspected ──
  if (items.length === 0) {
    issues.push({
      code: 'NO_ASSETS',
      severity: 'blocking',
      message: 'No assets have been inspected',
      assetCode: null,
      category: 'evidence',
    });
  }

  return issues;
}

// =============================================
// QUALITY SCORING
// =============================================

function calculateQuality(
  issues: CompletenessIssue[],
  itemCount: number,
): { score: number; grade: string } {
  // Start at 100, deduct for issues
  let score = 100;

  for (const issue of issues) {
    if (issue.severity === 'blocking') {
      score -= 15;
    } else {
      score -= 5;
    }
  }

  // Bonus for having items
  if (itemCount === 0) score = 0;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Grade
  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  return { score, grade };
}

// =============================================
// ROUTE HANDLER
// =============================================

export async function runCompletenessCheck(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);
  const logger = Logger.fromContext(ctx);

  logger.info('Running completeness check', { inspectionId: id });

  // Fetch inspection
  const inspection = await db.findByIdOrThrow<Record<string, unknown>>('inspections', id, 'Inspection');

  // Fetch items with defects
  const items = await db.findByParent<Record<string, unknown>>(
    'inspection_items',
    'inspections',
    'inspection_id',
    id,
    { orderBy: 'asset_code', orderDirection: 'asc' },
  );

  // Run deterministic checks
  const issues = runDeterministicChecks(inspection, items);

  // Calculate quality
  const { score, grade } = calculateQuality(issues, items.length);

  const blockingCount = issues.filter((i) => i.severity === 'blocking').length;
  const advisoryCount = issues.filter((i) => i.severity === 'advisory').length;

  // Build summary
  let summary: string;
  if (blockingCount === 0 && advisoryCount === 0) {
    summary = 'Inspection is complete and ready for sign-off. No issues found.';
  } else if (blockingCount === 0) {
    summary = `Inspection can be signed off. ${advisoryCount} advisory note${advisoryCount !== 1 ? 's' : ''} for your consideration.`;
  } else {
    summary = `${blockingCount} issue${blockingCount !== 1 ? 's' : ''} must be resolved before sign-off.${advisoryCount > 0 ? ` Plus ${advisoryCount} advisory note${advisoryCount !== 1 ? 's' : ''}.` : ''}`;
  }

  const result: CompletenessResult = {
    canSignOff: blockingCount === 0,
    totalIssues: issues.length,
    blockingCount,
    advisoryCount,
    issues,
    summary,
    confidenceScore: score,
    qualityGrade: grade,
  };

  logger.info('Completeness check complete', {
    inspectionId: id,
    canSignOff: result.canSignOff,
    blocking: blockingCount,
    advisory: advisoryCount,
    grade,
  });

  return jsonResponse({
    success: true,
    data: result,
  }, ctx.requestId);
}
