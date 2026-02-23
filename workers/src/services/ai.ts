/**
 * InspectVoice — AI Analysis Service (Claude Sonnet 4)
 * Analyses inspection voice transcripts to produce structured defect data.
 *
 * Pipeline:
 *   Inspector's voice notes (transcript from Deepgram)
 *   + Asset type config (inspection points, risk criteria, BS EN refs)
 *   → Transcript pre-processing (STT artifact cleanup)
 *   → Input validation
 *   → Claude Sonnet 4 analysis (with retries)
 *   → Strict response validation
 *   → Structured AIAnalysisResult (defects, condition, risk rating, recommendations)
 *
 * The asset type configurations are embedded from src/config/assetTypes.ts.
 * When the frontend config changes, the WORKER_ASSET_CONFIGS map must be updated.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Logger } from '../shared/logger';
import { BadGatewayError, BadRequestError } from '../shared/errors';

// =============================================
// CONFIGURATION
// =============================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.1; // Low temperature for consistent, factual analysis
const REQUEST_TIMEOUT_MS = 60_000;

/** Minimum transcript length worth analysing (characters) */
const MIN_TRANSCRIPT_LENGTH = 20;

/** Maximum transcript length to send (safety limit, ~12k words) */
const MAX_TRANSCRIPT_LENGTH = 50_000;

/** Maximum retries on transient Claude API failures */
const MAX_RETRIES = 2;

/** Base delay between retries in ms (multiplied by attempt number) */
const RETRY_DELAY_MS = 2_000;

// =============================================
// TYPES — mirrors src/config/assetTypes.ts
// =============================================

export interface WorkerInspectionPoint {
  readonly label: string;
  readonly description: string;
  readonly appliesTo: readonly string[];
}

export interface WorkerRiskCriteria {
  readonly very_high: readonly string[];
  readonly high: readonly string[];
  readonly medium: readonly string[];
  readonly low: readonly string[];
}

export interface WorkerAssetTypeConfig {
  readonly key: string;
  readonly name: string;
  readonly complianceStandard: string;
  readonly inspectionPoints: readonly WorkerInspectionPoint[];
  readonly riskCriteria: WorkerRiskCriteria;
  readonly bsEnDefectCategories: readonly string[];
}

// =============================================
// INPUT / OUTPUT TYPES
// =============================================

export interface AnalysisInput {
  readonly transcript: string;
  readonly assetCode: string;
  readonly assetType: string;
  readonly inspectionType: 'routine_visual' | 'operational' | 'annual_main';
  readonly requestId: string;
}

export interface AIAnalysisResult {
  readonly overallCondition: 'good' | 'fair' | 'poor' | 'dangerous';
  readonly riskRating: 'very_high' | 'high' | 'medium' | 'low';
  readonly requiresAction: boolean;
  readonly actionTimeframe: string | null;
  readonly defects: readonly AIDefect[];
  readonly summary: string;
  readonly recommendations: readonly string[];
  readonly closureRecommended: boolean;
  readonly complianceNotes: readonly string[];
  readonly tokenUsage: { readonly input: number; readonly output: number };
}

export interface AIDefect {
  readonly description: string;
  readonly severity: 'very_high' | 'high' | 'medium' | 'low';
  readonly defectCategory: string;
  readonly bsEnReference: string | null;
  readonly actionRequired: string;
  readonly actionTimeframe: string;
  readonly estimatedRepairCost: string | null;
}

// =============================================
// MAIN ANALYSIS FUNCTION
// =============================================

/**
 * Analyse an inspection transcript using Claude Sonnet 4.
 *
 * @param input — transcript + asset context
 * @param apiKey — Anthropic API key
 * @returns Validated AIAnalysisResult
 * @throws BadRequestError if input is invalid
 * @throws BadGatewayError if Claude API is unavailable after retries
 */
export async function analyseTranscript(
  input: AnalysisInput,
  apiKey: string,
): Promise<AIAnalysisResult> {
  const logger = Logger.minimal(input.requestId);

  // ── Input validation ─────────────────────
  const cleanedTranscript = preprocessTranscript(input.transcript);

  if (cleanedTranscript.length < MIN_TRANSCRIPT_LENGTH) {
    logger.warn('Transcript too short for analysis', {
      originalLength: input.transcript.length,
      cleanedLength: cleanedTranscript.length,
      assetCode: input.assetCode,
    });
    throw new BadRequestError(
      `Transcript too short for meaningful analysis (${cleanedTranscript.length} chars, minimum ${MIN_TRANSCRIPT_LENGTH})`,
    );
  }

  if (cleanedTranscript.length > MAX_TRANSCRIPT_LENGTH) {
    logger.warn('Transcript truncated to maximum length', {
      originalLength: cleanedTranscript.length,
      maxLength: MAX_TRANSCRIPT_LENGTH,
    });
  }

  const transcript = cleanedTranscript.slice(0, MAX_TRANSCRIPT_LENGTH);

  logger.info('Starting AI analysis', {
    assetCode: input.assetCode,
    assetType: input.assetType,
    inspectionType: input.inspectionType,
    transcriptLength: transcript.length,
    originalLength: input.transcript.length,
  });

  // ── Resolve asset config ─────────────────
  const assetConfig = getWorkerAssetConfig(input.assetType);

  const applicablePoints = assetConfig.inspectionPoints.filter(
    (p) => p.appliesTo.includes(input.inspectionType),
  );

  // ── Build prompt ─────────────────────────
  const prompt = buildPrompt(
    { ...input, transcript },
    assetConfig,
    applicablePoints,
  );

  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [
      { role: 'user' as const, content: prompt },
    ],
    system: buildSystemPrompt(),
  };

  // ── Call Claude with retries ─────────────
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.info('Retrying Claude API call', { attempt });
      await delay(RETRY_DELAY_MS * attempt);
    }

    try {
      const response = await fetchWithTimeout(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      }, REQUEST_TIMEOUT_MS);

      // Don't retry on 4xx client errors
      if (response.status >= 400 && response.status < 500) {
        const errorBody = await response.text().catch(() => 'Unknown');
        logger.error('Claude API client error (not retrying)', null, {
          status: response.status,
          error: errorBody.slice(0, 500),
        });
        throw new BadGatewayError(`Claude API error: ${response.status}`);
      }

      // Retry on 5xx server errors
      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown');
        lastError = new Error(`Claude ${response.status}: ${errorBody.slice(0, 200)}`);
        logger.warn('Claude API server error (will retry)', {
          attempt,
          status: response.status,
        });
        continue;
      }

      const data = await response.json() as ClaudeResponse;
      const textBlock = data.content?.find((block) => block.type === 'text');

      if (!textBlock || !textBlock.text) {
        throw new BadGatewayError('Claude returned empty response');
      }

      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      const result = parseAnalysisResponse(textBlock.text, input.requestId, {
        input: inputTokens,
        output: outputTokens,
      });

      logger.info('AI analysis complete', {
        overallCondition: result.overallCondition,
        riskRating: result.riskRating,
        defectCount: result.defects.length,
        closureRecommended: result.closureRecommended,
        model: MODEL,
        inputTokens,
        outputTokens,
        estimatedCostUSD: estimateTokenCost(inputTokens, outputTokens),
      });

      return result;
    } catch (error) {
      if (error instanceof BadGatewayError || error instanceof BadRequestError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error('Unknown error');
      logger.warn('Claude API call failed', {
        attempt,
        error: lastError.message,
      });
    }
  }

  // All retries exhausted
  logger.error('Claude API failed after retries', lastError);
  throw new BadGatewayError('AI analysis service unavailable');
}

// =============================================
// TRANSCRIPT PRE-PROCESSING
// =============================================

/**
 * Clean common speech-to-text artifacts from Deepgram output
 * before sending to Claude for analysis.
 *
 * - Removes filler words that add no informational content
 * - Collapses repeated words/phrases (STT stutter artifacts)
 * - Normalises excessive whitespace
 * - Preserves all technical content and meaning
 */
function preprocessTranscript(raw: string): string {
  let text = raw.trim();

  // Remove common filler words/phrases (case-insensitive, word boundaries)
  const fillers = [
    /\b(um|uh|erm|er|hmm|ah|oh)\b/gi,
    /\b(you know|i mean|like i said|sort of|kind of)\b/gi,
    /\b(basically|obviously|actually|literally)\b/gi,
  ];
  for (const pattern of fillers) {
    text = text.replace(pattern, '');
  }

  // Collapse repeated consecutive words (STT stutter: "the the", "and and")
  text = text.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // Normalise whitespace (collapse multiple spaces, trim around punctuation)
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\s+([.,;:!?])/g, '$1');
  text = text.trim();

  return text;
}

// =============================================
// PROMPT CONSTRUCTION
// =============================================

function buildSystemPrompt(): string {
  return `You are an expert UK playground safety inspector AI assistant for InspectVoice. You analyse voice-recorded field inspection notes and produce structured defect assessments compliant with BS EN 1176 (playground equipment safety), BS EN 1177 (impact attenuation), and BS EN 16630 (outdoor fitness equipment).

CRITICAL RULES — FOLLOW EVERY ONE WITHOUT EXCEPTION:

1. EVIDENCE-ONLY ANALYSIS
   - Report ONLY defects that the inspector explicitly describes or clearly implies in their spoken notes.
   - NEVER invent, assume, or extrapolate defects not mentioned in the transcript.
   - If the inspector says the equipment looks fine with no issues, return overallCondition "good" with an empty defects array. Do NOT manufacture problems.

2. HANDLING UNCLEAR TRANSCRIPTS
   - Voice recordings are often informal, fragmented, or contain speech recognition errors.
   - Interpret reasonable misspellings and colloquialisms: "dodgy" means defective, "shot" means severely worn/damaged, "knackered" means broken/non-functional, "iffy" means questionable condition.
   - If a finding is genuinely ambiguous (you cannot determine what the inspector means), include it as a defect with severity "low" and note in the description that the finding needs inspector clarification.
   - NEVER silently discard a finding because the wording is informal.

3. PROFESSIONAL NARRATIVE
   - Write all descriptions, summaries, and recommendations as if producing a formal inspection report for a UK council parks department.
   - Use clear, factual, third-person language. Avoid colloquialisms in your output even though the input may contain them.
   - Example input: "the swing chain's looking a bit dodgy, couple of links gone rusty"
   - Example output description: "Corrosion observed on multiple chain links of the suspension system. Chain link integrity may be compromised."

4. RISK RATING DISCIPLINE
   - Use ONLY the risk criteria provided for the specific equipment type. Do not apply generic criteria.
   - Risk ratings must be justified by what the inspector described, matched against the criteria.
   - Do NOT inflate risk to seem thorough. Do NOT deflate risk to seem reassuring.
   - When multiple defects exist, the overall risk rating equals the highest individual defect severity.

5. BS EN CLAUSE REFERENCES
   - Reference specific BS EN clauses from the provided defect categories when a defect clearly maps to one.
   - If no specific clause applies, use the defect category name only (e.g. "General structural integrity") with bsEnReference set to null.
   - NEVER fabricate clause numbers. Only use references from the provided list.

6. ACTION TIMEFRAME ALIGNMENT
   - very_high severity → "immediate" (closure/restriction required)
   - high severity → "48_hours" (urgent action)
   - medium severity → "1_week" or "1_month" depending on progression risk
   - low severity → "next_inspection" or "routine"
   - NEVER assign a relaxed timeframe to a high-severity defect.

7. CLOSURE RECOMMENDATIONS
   - Set closureRecommended to true ONLY for very_high risk situations where continued public use poses imminent danger of serious injury.
   - This is a significant operational decision. Do not recommend closure lightly.

8. COST ESTIMATES
   - Provide realistic UK market rates for playground equipment repair/replacement in GBP.
   - Format as a string: "£150-250" for ranges, "£500" for point estimates.
   - Use null if you cannot reasonably estimate (e.g. specialist manufacturer repair).

9. SINGLE ASSET FOCUS
   - If the transcript mentions other equipment or general site observations, focus ONLY on the specified asset.
   - Ignore findings about other assets entirely.

10. COMPLETENESS AWARENESS
    - After analysing the transcript, check the provided inspection points list.
    - If the inspector has NOT mentioned a point that would normally be checked for this inspection type, include a compliance note: "Inspector did not comment on [inspection point] — consider verifying on site."
    - This is a SOFT prompt only — do NOT create defects for un-mentioned items.

You MUST respond with valid JSON only. No markdown fences, no explanation, no preamble, no trailing text. Output the JSON object and nothing else.`;
}

function buildPrompt(
  input: AnalysisInput,
  config: WorkerAssetTypeConfig,
  applicablePoints: readonly WorkerInspectionPoint[],
): string {
  const inspectionTypeLabel = {
    routine_visual: 'Routine Visual Inspection (quick walk-round check for obvious hazards)',
    operational: 'Operational Inspection (detailed functional check of all moving parts and wear items)',
    annual_main: 'Annual Main Inspection (comprehensive structural and compliance assessment)',
  }[input.inspectionType];

  const inspectionTypeDepth = {
    routine_visual: 'Focus on visually obvious hazards only. Do not flag minor wear items unless they present an immediate safety concern.',
    operational: 'Assess all functional and wear items. Flag deterioration that could become a hazard before the next operational inspection.',
    annual_main: 'Full compliance assessment. Flag all defects regardless of severity. Note any gaps in inspection coverage.',
  }[input.inspectionType];

  return `Analyse this playground equipment inspection transcript and produce a structured defect assessment.

## CONTEXT
- Asset Code: ${input.assetCode}
- Equipment Type: ${config.name} (${config.key})
- Inspection Type: ${inspectionTypeLabel}
- Applicable Standards: ${config.complianceStandard}

## INSPECTION DEPTH GUIDANCE
${inspectionTypeDepth}

## INSPECTION POINTS FOR THIS EQUIPMENT AND INSPECTION TYPE
These are the items an inspector should cover. Use them to identify what the inspector HAS and HAS NOT commented on.

${applicablePoints.map((p, i) => `${i + 1}. ${p.label} — ${p.description}`).join('\n')}

## RISK CRITERIA FOR ${config.name.toUpperCase()}
Use ONLY these criteria to assign risk ratings. Match the inspector's described conditions to the closest criteria.

Very High Risk (immediate closure/restriction required):
${config.riskCriteria.very_high.map((c) => `• ${c}`).join('\n')}

High Risk (urgent action within 48 hours):
${config.riskCriteria.high.map((c) => `• ${c}`).join('\n')}

Medium Risk (action within 1 month):
${config.riskCriteria.medium.map((c) => `• ${c}`).join('\n')}

Low Risk (action at next scheduled maintenance):
${config.riskCriteria.low.map((c) => `• ${c}`).join('\n')}

## BS EN DEFECT CATEGORIES
When a defect maps to one of these categories, use it as the defectCategory and include the clause reference in bsEnReference.

${config.bsEnDefectCategories.length > 0
    ? config.bsEnDefectCategories.map((c) => `• ${c}`).join('\n')
    : '• No specific BS EN categories for this equipment type. Use "General" as defectCategory with bsEnReference null.'}

## INSPECTOR'S VOICE TRANSCRIPT
This is a cleaned transcription of the inspector's spoken field notes. It may be informal, fragmented, or contain speech recognition errors. Interpret professionally.

"""
${input.transcript}
"""

## REQUIRED OUTPUT
Respond with a single JSON object matching this exact schema. No other text.

{
  "overallCondition": "good" | "fair" | "poor" | "dangerous",
  "riskRating": "very_high" | "high" | "medium" | "low",
  "requiresAction": boolean,
  "actionTimeframe": "immediate" | "48_hours" | "1_week" | "1_month" | "next_inspection" | "routine" | null,
  "defects": [
    {
      "description": "Professional description of the defect (2-3 sentences, formal language)",
      "severity": "very_high" | "high" | "medium" | "low",
      "defectCategory": "BS EN defect category from list above, or 'General'",
      "bsEnReference": "e.g. 'BS EN 1176-1:2017 §4.2.8.2' or null",
      "actionRequired": "Specific remedial action (what exactly needs to be done)",
      "actionTimeframe": "immediate" | "48_hours" | "1_week" | "1_month" | "next_inspection" | "routine",
      "estimatedRepairCost": "e.g. '£150-250' or null"
    }
  ],
  "summary": "2-3 sentence professional summary of overall findings for the report executive summary",
  "recommendations": ["Specific, actionable recommendations"],
  "closureRecommended": boolean,
  "complianceNotes": ["BS EN clause references relevant to findings, plus notes on inspection points not covered by the inspector"]
}`;
}

// =============================================
// RESPONSE PARSING & VALIDATION
// =============================================

function parseAnalysisResponse(
  text: string,
  requestId: string,
  tokenUsage: { input: number; output: number },
): AIAnalysisResult {
  const logger = Logger.minimal(requestId);

  // Strip markdown code fences if Claude adds them despite instructions
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    logger.error('Failed to parse AI response as JSON', error, {
      responsePreview: cleaned.slice(0, 300),
    });
    throw new BadGatewayError('AI returned invalid JSON response');
  }

  // Validate with safe defaults — defaults chosen to be cautiously middle-ground,
  // not the most extreme value in either direction
  const overallCondition = validateEnumField(
    parsed, 'overallCondition', ['good', 'fair', 'poor', 'dangerous'], 'fair',
  );
  const riskRating = validateEnumField(
    parsed, 'riskRating', ['very_high', 'high', 'medium', 'low'], 'medium',
  );
  const requiresAction = typeof parsed['requiresAction'] === 'boolean'
    ? parsed['requiresAction']
    : true; // Default to true (safer to flag than to miss)
  const closureRecommended = typeof parsed['closureRecommended'] === 'boolean'
    ? parsed['closureRecommended']
    : false;
  const actionTimeframe = typeof parsed['actionTimeframe'] === 'string'
    ? parsed['actionTimeframe']
    : null;
  const summary = typeof parsed['summary'] === 'string' && parsed['summary'].length > 0
    ? parsed['summary']
    : 'AI analysis completed but no summary was generated. Manual review recommended.';

  const recommendations = Array.isArray(parsed['recommendations'])
    ? (parsed['recommendations'] as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];

  const complianceNotes = Array.isArray(parsed['complianceNotes'])
    ? (parsed['complianceNotes'] as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];

  const rawDefects = Array.isArray(parsed['defects'])
    ? parsed['defects'] as Record<string, unknown>[]
    : [];
  const defects: AIDefect[] = rawDefects
    .map((d) => validateDefect(d))
    .filter((d): d is AIDefect => d !== null);

  // Cross-validate: if defects exist but overallCondition is 'good', correct it
  const correctedCondition = defects.length > 0 && overallCondition === 'good'
    ? 'fair'
    : overallCondition;

  // Cross-validate: if any very_high defect exists, closureRecommended should be true
  const hasVeryHigh = defects.some((d) => d.severity === 'very_high');
  const correctedClosure = hasVeryHigh ? true : closureRecommended;

  // Cross-validate: overall risk should match highest defect severity
  const correctedRisk = defects.length > 0
    ? deriveOverallRisk(defects)
    : riskRating;

  return {
    overallCondition: correctedCondition as AIAnalysisResult['overallCondition'],
    riskRating: correctedRisk as AIAnalysisResult['riskRating'],
    requiresAction: requiresAction || defects.length > 0,
    actionTimeframe,
    defects,
    summary,
    recommendations,
    closureRecommended: correctedClosure,
    complianceNotes,
    tokenUsage,
  };
}

/**
 * Validate a field against an enum list with an explicit safe default.
 */
function validateEnumField(
  obj: Record<string, unknown>,
  field: string,
  allowed: string[],
  defaultValue: string,
): string {
  const value = obj[field];
  if (typeof value === 'string' && allowed.includes(value)) return value;
  return defaultValue;
}

/**
 * Derive overall risk rating from the highest-severity defect.
 */
function deriveOverallRisk(defects: readonly AIDefect[]): string {
  const severityOrder: Record<string, number> = {
    very_high: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  let highest = 0;
  let highestSeverity = 'low';

  for (const defect of defects) {
    const score = severityOrder[defect.severity] ?? 0;
    if (score > highest) {
      highest = score;
      highestSeverity = defect.severity;
    }
  }

  return highestSeverity;
}

function validateDefect(raw: Record<string, unknown>): AIDefect | null {
  if (!raw || typeof raw !== 'object') return null;

  const description = typeof raw['description'] === 'string' ? raw['description'].trim() : null;
  if (!description || description.length < 5) return null;

  const validSeverities = ['very_high', 'high', 'medium', 'low'];
  const severity = typeof raw['severity'] === 'string' && validSeverities.includes(raw['severity'])
    ? raw['severity'] as AIDefect['severity']
    : 'medium'; // Default to medium, not low — safer to over-report

  const validTimeframes = ['immediate', '48_hours', '1_week', '1_month', 'next_inspection', 'routine'];
  const rawTimeframe = typeof raw['actionTimeframe'] === 'string' ? raw['actionTimeframe'] : '';

  // Enforce timeframe-severity alignment
  const actionTimeframe = validTimeframes.includes(rawTimeframe)
    ? rawTimeframe
    : severityToTimeframe(severity);

  return {
    description,
    severity,
    defectCategory: typeof raw['defectCategory'] === 'string' && raw['defectCategory'].length > 0
      ? raw['defectCategory']
      : 'General',
    bsEnReference: typeof raw['bsEnReference'] === 'string' && raw['bsEnReference'].length > 0
      ? raw['bsEnReference']
      : null,
    actionRequired: typeof raw['actionRequired'] === 'string' && raw['actionRequired'].length > 0
      ? raw['actionRequired']
      : 'Inspect and assess further — automated analysis requires confirmation.',
    actionTimeframe,
    estimatedRepairCost: typeof raw['estimatedRepairCost'] === 'string' && raw['estimatedRepairCost'].length > 0
      ? raw['estimatedRepairCost']
      : null,
  };
}

/**
 * Map severity to the correct default timeframe when Claude returns an invalid one.
 */
function severityToTimeframe(severity: string): string {
  switch (severity) {
    case 'very_high': return 'immediate';
    case 'high': return '48_hours';
    case 'medium': return '1_month';
    case 'low': return 'next_inspection';
    default: return 'next_inspection';
  }
}

// =============================================
// TOKEN COST ESTIMATION
// =============================================

/**
 * Estimate USD cost for Claude Sonnet 4 usage.
 * Rates: $3/MTok input, $15/MTok output (as of 2025-Q1).
 * Used for logging/monitoring — not for billing.
 */
function estimateTokenCost(inputTokens: number, outputTokens: number): string {
  const inputCost = (inputTokens / 1_000_000) * 3;
  const outputCost = (outputTokens / 1_000_000) * 15;
  return `$${(inputCost + outputCost).toFixed(4)}`;
}

// =============================================
// CLAUDE API RESPONSE TYPE
// =============================================

interface ClaudeResponse {
  readonly content?: Array<{ readonly type: string; readonly text?: string }>;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

// =============================================
// HELPERS
// =============================================

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BadGatewayError('Claude API request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================
// ASSET TYPE CONFIG LOOKUP
// =============================================

/**
 * Get asset config for the AI prompt. Returns generic fallback for unknown types.
 */
export function getWorkerAssetConfig(assetType: string): WorkerAssetTypeConfig {
  const config = WORKER_ASSET_CONFIGS[assetType];
  if (config) return config;

  return {
    key: assetType,
    name: assetType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    complianceStandard: 'General duty of care — no specific BS EN standard applies',
    inspectionPoints: [
      { label: 'Overall structural integrity', description: 'Check all structural members for damage, corrosion, stability.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Surface condition', description: 'Check all surfaces for damage, wear, sharp edges.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Fixings and connections', description: 'Check all visible fixings for tightness, corrosion.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Foundation', description: 'Check ground anchoring and foundation condition.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Structural failure risk', 'Sharp protrusion causing injury risk', 'Missing critical safety component'],
      high: ['Significant corrosion on structural members', 'Loose critical fixings', 'Surface damage creating hazard'],
      medium: ['Surface corrosion not yet structural', 'Minor wear', 'Cosmetic damage reducing confidence'],
      low: ['Cosmetic paint wear', 'Normal wear within tolerances'],
    },
    bsEnDefectCategories: [],
  };
}

// =============================================
// EMBEDDED ASSET TYPE CONFIGS
// Mirrors src/config/assetTypes.ts exactly.
// =============================================

const WORKER_ASSET_CONFIGS: Record<string, WorkerAssetTypeConfig> = {
  swing: {
    key: 'swing',
    name: 'Swing',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-2:2017, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Chain/rope suspension condition', description: 'Check all chain links and rope for corrosion, wear, fraying. Measure chain link wear against manufacturer tolerances.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Seat integrity and attachment', description: 'Check seat for cracks, splits, deformation. Verify seat-to-chain/rope connection is secure.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Bearing/pivot mechanism', description: 'Check top bar bearings for seizure, excessive play, noise. Lubricate if required.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Impact surface beneath equipment', description: 'Check safety surfacing depth, coverage, and condition within the full swing arc plus clearance zones.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Clearance zones (front/rear/side)', description: 'Verify no obstructions within the swing clearance zone. Minimum clearance per BS EN 1176-2.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Structural frame condition', description: 'Check frame for rust, cracks, bent members, weld integrity. Examine all bolted connections.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Foundation exposure/stability', description: 'Check for exposed foundations, ground erosion around posts. Test frame stability by rocking.', appliesTo: ['annual_main'] },
      { label: 'Entrapment hazards', description: 'Check for finger, head, and clothing entrapment points per BS EN 1176-1 probes.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Broken chain/rope links', 'Seat detached or crack >50mm', 'Exposed concrete foundation', 'Sharp protrusion >8mm', 'Fall height >3m without adequate surfacing'],
      high: ['Chain/rope corrosion affecting 3+ links', 'Seat crack 30-50mm', 'Bearing seizure or excessive play', 'Impact surface depth <50% of requirement', 'Clearance zone obstruction'],
      medium: ['Surface rust on non-load-bearing parts', 'Minor seat crack <30mm', 'Squeaking bearings (functional but worn)', 'Impact surface compaction', 'Paint deterioration exposing bare metal'],
      low: ['Cosmetic paint wear', 'Minor surface marks on seat', 'Slight operational noise within tolerances'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-1:2017 §4.2.8.2 — Suspension system deterioration',
      'BS EN 1176-2:2017 §4.2.9 — Seat integrity requirements',
      'BS EN 1176-2:2017 §4.2.10 — Impact surface compliance',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    ],
  },

  slide: {
    key: 'slide',
    name: 'Slide',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-3:2017, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Slide surface condition', description: 'Check for cracks, rough patches, delamination, exposed edges on the sliding surface.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Side barriers and handrails', description: 'Verify side barriers are intact, correct height, no gaps. Check handrail security.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Start section/platform', description: 'Check platform surface for slip resistance, barrier condition, and step access.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Run-out section', description: 'Check exit area for adequate run-out length. Verify surfacing extends beyond run-out zone.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Structural supports', description: 'Check all supports, legs, and connections for corrosion, cracks, stability.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Impact surfacing at exit', description: 'Verify safety surfacing at slide exit meets CFH requirements.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Ladder/steps condition', description: 'Check rungs/steps for damage, slip resistance, spacing compliance.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Entrapment and protrusion check', description: 'Test all joints, bolt heads, and gaps for entrapment and protrusion hazards.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Broken or missing side barrier', 'Sharp edge on sliding surface', 'Structural failure of supports', 'Missing or severely degraded exit surfacing', 'Head entrapment hazard identified'],
      high: ['Crack >50mm on sliding surface', 'Loose handrail', 'Run-out zone obstructed', 'Significant rust on structural members', 'Step/rung damage affecting safe access'],
      medium: ['Surface roughening (friction increase)', 'Minor crack <50mm on slide surface', 'Surface rust on non-structural parts', 'Surfacing compaction at exit zone', 'Paint peeling on barriers'],
      low: ['Cosmetic surface marks', 'Minor graffiti', 'Slight discolouration'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-3:2017 §4.2 — Slide surface requirements',
      'BS EN 1176-3:2017 §4.3 — Side barrier requirements',
      'BS EN 1176-3:2017 §4.4 — Start and run-out sections',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  climbing_frame: {
    key: 'climbing_frame',
    name: 'Climbing Frame',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Structural frame integrity', description: 'Check all frame members, welds, and joints for cracks, corrosion, deformation.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Climbing holds/rungs', description: 'Check all climbing holds and rungs are secure, undamaged, and have adequate grip.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Platform and deck surfaces', description: 'Check all platforms for slip resistance, drainage, structural integrity.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Guard rails and barriers', description: 'Verify all guard rails at height are secure, correct height, no gaps exceeding limits.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Bolt connections and fixings', description: 'Check all visible bolts for tightness, corrosion, missing caps. Torque test on annual.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Fall height and surfacing', description: 'Measure critical fall heights. Verify surfacing depth and coverage at all landing zones.', appliesTo: ['annual_main'] },
      { label: 'Entrapment hazards', description: 'Test all openings with BS EN 1176-1 probes for head, finger, and body entrapment.', appliesTo: ['annual_main'] },
      { label: 'Foundation condition', description: 'Check for ground erosion, exposed footings, post movement.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Structural member failure or severe cracking', 'Missing guard rail section at height >600mm', 'Head entrapment hazard identified', 'Fall height >3m without compliant surfacing', 'Exposed sharp edge or protrusion >8mm at height'],
      high: ['Loose climbing holds', 'Significant weld deterioration', 'Guard rail movement under load', 'Platform surface damage creating trip hazard', 'Multiple missing bolt caps exposing threads'],
      medium: ['Surface rust on structural members (not affecting integrity)', 'Minor platform surface wear', 'Single bolt cap missing', 'Surfacing compaction below equipment', 'Paint deterioration on bars (grip concern)'],
      low: ['Cosmetic paint wear', 'Minor surface marks', 'Slight fading/discolouration'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
      'BS EN 1176-1:2017 §4.2.6 — Guard rails and barriers',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
      'BS EN 1176-1:2017 §4.2.8 — Protrusions',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  roundabout: {
    key: 'roundabout',
    name: 'Roundabout',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-5:2019, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Rotating mechanism', description: 'Check bearing function, rotation smoothness, speed limitation device if fitted.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Platform/deck surface', description: 'Check for slip resistance, damage, drainage. Verify anti-slip surface intact.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Handgrips and handrails', description: 'Check all grips are secure, undamaged, and provide adequate hold.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Clearance zone (perimeter)', description: 'Verify no obstructions within the rotation clearance zone. Check ground level vs platform.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Entrapment beneath platform', description: 'Check gap between platform underside and ground for foot/limb entrapment risk.', appliesTo: ['annual_main'] },
      { label: 'Foundation and centre post', description: 'Check centre post for corrosion, stability. Verify foundation condition.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Bearing failure causing jamming or uncontrolled spin', 'Entrapment gap beneath platform', 'Structural failure of platform or centre post', 'Missing handgrips with fall risk'],
      high: ['Excessive bearing play causing wobble', 'Damaged handgrip', 'Platform surface damage creating trip hazard', 'Clearance zone obstruction'],
      medium: ['Bearing noise (functional but worn)', 'Minor platform surface wear', 'Surface rust on non-structural parts', 'Anti-slip surface wearing thin'],
      low: ['Cosmetic paint wear', 'Minor graffiti', 'Slight operational noise'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-5:2019 §4.2 — Rotating equipment requirements',
      'BS EN 1176-5:2019 §4.3 — Speed limitation',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
      'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    ],
  },

  see_saw: {
    key: 'see_saw',
    name: 'See-Saw',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-6:2017, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Pivot mechanism', description: 'Check pivot bearing for wear, play, lubrication. Test for smooth operation.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Seat condition', description: 'Check seats for cracks, splits, secure attachment.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Handgrips', description: 'Verify all handgrips secure, undamaged, and correctly positioned.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Ground clearance and impact absorber', description: 'Check bumper/stopper condition. Verify adequate ground clearance and surfacing beneath seats.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Beam and structural condition', description: 'Check beam for cracks, corrosion, deformation. Verify weld integrity.', appliesTo: ['annual_main'] },
      { label: 'Finger entrapment at pivot', description: 'Test pivot area for finger entrapment risk using BS EN 1176-1 probes.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Pivot failure', 'Seat detached', 'Finger entrapment at pivot confirmed', 'Beam structural crack'],
      high: ['Excessive pivot play', 'Bumper/stopper missing or failed', 'Seat crack >30mm', 'Handgrip loose or damaged'],
      medium: ['Pivot noise (functional)', 'Minor seat crack <30mm', 'Bumper compression (still functional)', 'Surface rust on beam'],
      low: ['Cosmetic wear', 'Paint fading'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-6:2017 §4.2 — Rocking equipment requirements',
      'BS EN 1176-6:2017 §4.3 — Impact absorber requirements',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    ],
  },

  spring_rocker: {
    key: 'spring_rocker',
    name: 'Spring Rocker',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-6:2017, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Spring condition', description: 'Check spring for corrosion, fatigue cracks, deformation. Test flex in all directions.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Seat/body condition', description: 'Check moulded body for cracks, UV degradation, sharp edges from damage.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Handgrips and footrests', description: 'Verify grips and rests are secure, undamaged.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Foundation plate and bolts', description: 'Check foundation plate is level, secure, bolts tight. Verify no ground erosion.', appliesTo: ['annual_main'] },
      { label: 'Spring-to-seat connection', description: 'Check top plate connection for cracks, loose bolts.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Spring failure or fatigue crack visible', 'Seat detached from spring', 'Foundation plate loose allowing tipping'],
      high: ['Significant spring corrosion', 'Seat body crack >50mm', 'Handgrip broken', 'Foundation bolts loose'],
      medium: ['Surface rust on spring (not affecting integrity)', 'Minor body crack <50mm', 'Footrest worn', 'Ground erosion around base'],
      low: ['Paint fading', 'Cosmetic marks on body'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-6:2017 §4.2 — Rocking equipment requirements',
      'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
      'BS EN 1176-1:2017 §4.2.8 — Protrusions from damage',
    ],
  },

  climbing_net: {
    key: 'climbing_net',
    name: 'Climbing Net',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-11:2014, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Net/rope condition', description: 'Check all ropes/cables for fraying, cuts, UV degradation, knot integrity.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Connection points', description: 'Check where ropes connect to frame — clamps, thimbles, ferrules all secure.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Frame structure', description: 'Check frame for corrosion, weld integrity, stability.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Net tension', description: 'Check net tension is appropriate — not too slack (entrapment) or too tight (injury).', appliesTo: ['annual_main'] },
      { label: 'Fall height and surfacing', description: 'Measure maximum fall height. Verify surfacing coverage and depth at all landing points.', appliesTo: ['annual_main'] },
      { label: 'Entrapment in mesh', description: 'Check mesh size for head and body entrapment compliance.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Rope/cable severed or nearly severed', 'Connection point failure', 'Head entrapment mesh size non-compliant', 'Frame structural failure'],
      high: ['Multiple rope strands frayed (>25% diameter)', 'Loose connection clamp', 'Excessive net slack creating entrapment', 'Frame corrosion at weld points'],
      medium: ['Surface fraying on rope (<25% diameter)', 'UV degradation visible on ropes', 'Minor frame surface rust', 'Surfacing compaction beneath'],
      low: ['Cosmetic discolouration of ropes', 'Minor surface marks on frame'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-11:2014 §4.2 — Spatial network requirements',
      'BS EN 1176-11:2014 §4.3 — Mesh size requirements',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  monkey_bars: {
    key: 'monkey_bars',
    name: 'Monkey Bars',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Bar condition and security', description: 'Check each bar for corrosion, bending, secure attachment at both ends.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Bar spacing', description: 'Verify consistent spacing between bars. Check for entrapment between bars.', appliesTo: ['annual_main'] },
      { label: 'Frame and support structure', description: 'Check uprights and cross-members for corrosion, weld integrity, stability.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Impact surfacing', description: 'Verify surfacing beneath entire traverse route meets CFH requirements.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Foundation condition', description: 'Check uprights at ground level for corrosion, ground erosion.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Bar detached or nearly detached', 'Structural failure of support frame', 'Missing surfacing beneath traverse', 'Sharp edge from bar damage'],
      high: ['Bar bending under load', 'Significant frame corrosion', 'Surfacing depth <50% requirement', 'Loose bar with rotational play'],
      medium: ['Surface rust on bars (grip concern)', 'Minor frame surface corrosion', 'Surfacing compaction', 'Paint deterioration on bars'],
      low: ['Cosmetic wear', 'Minor paint fading'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  balance_beam: {
    key: 'balance_beam',
    name: 'Balance Beam',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Beam surface condition', description: 'Check walking surface for slip resistance, cracks, splinters (timber), corrosion (metal).', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Support posts', description: 'Check support posts for stability, corrosion, rot (timber), secure fixings.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Impact surfacing', description: 'Verify surfacing beneath and around beam meets fall height requirements.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Foundation condition', description: 'Check ground level for erosion, exposed footings.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Beam structural failure', 'Support post collapse', 'Sharp edge or splinter risk from break'],
      high: ['Significant timber rot in beam', 'Loose support post', 'Surface slippery when wet (no grip)'],
      medium: ['Surface wear reducing grip', 'Minor rot or corrosion', 'Surfacing compaction'],
      low: ['Cosmetic wear', 'Minor weathering'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  multi_play: {
    key: 'multi_play',
    name: 'Multi-Play Unit',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-10:2008, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Overall structural integrity', description: 'Check all frame members, decks, towers for structural soundness.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'All access points (steps, ladders, ramps)', description: 'Check each access route for damage, slip resistance, handrail condition.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'All activity elements', description: 'Inspect each individual element (slides, climbing walls, poles, bridges) per relevant standard.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Platforms and decks', description: 'Check all platform surfaces, barriers, guard rails at each height level.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Roof/canopy (if fitted)', description: 'Check roof panels for damage, security, water pooling.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Bolt connections throughout', description: 'Check all visible fixings. Torque test critical connections on annual.', appliesTo: ['annual_main'] },
      { label: 'Entrapment hazards throughout', description: 'Systematic check of all openings, gaps, and transitions between elements.', appliesTo: ['annual_main'] },
      { label: 'Impact surfacing (all zones)', description: 'Verify surfacing at all landing/fall zones around the full perimeter.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Structural failure of any frame member', 'Missing guard rail section at height', 'Head entrapment hazard', 'Sharp edge from damage at height', 'Platform collapse risk'],
      high: ['Loose or damaged guard rail', 'Access point damage preventing safe use', 'Multiple bolt failures', 'Significant rot/corrosion on structural members', 'Missing surfacing at critical fall zone'],
      medium: ['Individual element wear (single slide crack, etc)', 'Surface rust on non-critical parts', 'Platform surface wear', 'Surfacing compaction', 'Minor roof panel damage'],
      low: ['Cosmetic paint wear', 'Minor graffiti', 'Slight fading'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
      'BS EN 1176-1:2017 §4.2.6 — Guard rails and barriers',
      'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
      'BS EN 1176-1:2017 §4.2.8 — Protrusions',
      'BS EN 1176-10:2008 §4.2 — Enclosed play equipment',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  sandpit: {
    key: 'sandpit',
    name: 'Sandpit',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Sand condition', description: 'Check for contamination (animal fouling, glass, sharps, litter). Assess sand depth and quality.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Edging/border condition', description: 'Check timber/stone edging for damage, splinters, sharp edges, trip hazards.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Drainage', description: 'Check for standing water, waterlogging, drainage function.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Cover condition (if fitted)', description: 'Check sand pit cover for damage, security, ease of removal.', appliesTo: ['operational', 'annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Needles or hazardous sharps in sand', 'Significant animal fouling contamination'],
      high: ['Broken glass in sand', 'Sharp edge on edging/border', 'Standing water (drowning risk for infants)'],
      medium: ['Litter in sand', 'Sand depth below recommended level', 'Minor edging damage', 'Poor drainage'],
      low: ['Sand discolouration', 'Minor weed growth at edges'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-1:2017 §4.2 — General safety requirements',
      'BS EN 1176-7:2020 §6 — Maintenance requirements',
    ],
  },

  zipline: {
    key: 'zipline',
    name: 'Zipline / Cableway',
    complianceStandard: 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1176-4:2017, BS EN 1177:2018',
    inspectionPoints: [
      { label: 'Cable condition', description: 'Check cable for fraying, kinks, corrosion. Measure cable diameter for wear.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Trolley/carriage mechanism', description: 'Check trolley wheels, bearings, and brake/buffer mechanism.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Handle/seat attachment', description: 'Check seat or handle attachment to trolley for security and wear.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Terminal posts and tensioning', description: 'Check both end posts for stability, cable tensioning device function.', appliesTo: ['annual_main'] },
      { label: 'Buffer/stop at terminal', description: 'Check end buffer condition and effectiveness. Test stop mechanism.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Clearance zone (full run)', description: 'Verify no obstructions along the full cable run and landing zone.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Impact surfacing', description: 'Verify surfacing at launch, landing, and along the route.', appliesTo: ['operational', 'annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Cable fraying >25% diameter', 'Trolley mechanism failure', 'Missing or failed end buffer', 'Terminal post instability'],
      high: ['Cable fraying <25% but visible strands broken', 'Handle/seat attachment worn', 'Buffer worn beyond effective function', 'Clearance zone obstruction'],
      medium: ['Surface cable corrosion', 'Trolley bearing noise (functional)', 'Minor buffer compression', 'Surfacing wear at landing'],
      low: ['Cable surface discolouration', 'Minor cosmetic wear'],
    },
    bsEnDefectCategories: [
      'BS EN 1176-4:2017 §4.2 — Cableway requirements',
      'BS EN 1176-4:2017 §4.3 — Terminal and buffer requirements',
      'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    ],
  },

  pull_up_bar: {
    key: 'pull_up_bar',
    name: 'Pull-Up Bar Station',
    complianceStandard: 'BS EN 16630:2015',
    inspectionPoints: [
      { label: 'Bar condition and grip', description: 'Check bars for corrosion, bending, grip surface condition.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Frame structure', description: 'Check frame uprights and cross-members for stability, corrosion, weld condition.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Foundation and fixings', description: 'Check ground fixings, base plates, ground erosion.', appliesTo: ['annual_main'] },
      { label: 'User information signage', description: 'Verify instruction signage is present, legible, and correct.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Surfacing beneath equipment', description: 'Check surface condition for safe use.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Bar detachment or structural failure', 'Frame collapse', 'Sharp edge from damage'],
      high: ['Significant bar corrosion affecting grip safety', 'Frame corrosion at weld points', 'Foundation movement'],
      medium: ['Surface rust (not affecting function)', 'Signage faded or missing', 'Surfacing wear'],
      low: ['Paint wear', 'Minor cosmetic marks'],
    },
    bsEnDefectCategories: [
      'BS EN 16630:2015 §4.2 — Structural requirements',
      'BS EN 16630:2015 §5 — User information requirements',
    ],
  },

  bench: {
    key: 'bench',
    name: 'Bench',
    complianceStandard: 'General duty of care',
    inspectionPoints: [
      { label: 'Seating surface', description: 'Check for splinters (timber), cracks, broken slats, sharp edges.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Frame/supports', description: 'Check legs and frame for stability, corrosion, breakage.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Fixings', description: 'Check all bolts/screws for tightness, corrosion, missing heads.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Foundation/anchoring', description: 'Check bench is securely anchored and level.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Structural collapse risk', 'Exposed nail/screw causing laceration'],
      high: ['Broken slat creating gap', 'Severe splinter risk from timber deterioration', 'Unstable — tips under load'],
      medium: ['Minor timber splinters', 'Surface rust on frame', 'Loose slat'],
      low: ['Paint wear', 'Minor weathering', 'Graffiti'],
    },
    bsEnDefectCategories: [],
  },

  gate: {
    key: 'gate',
    name: 'Gate',
    complianceStandard: 'General duty of care',
    inspectionPoints: [
      { label: 'Self-closing mechanism', description: 'Test gate self-closes fully from fully open position.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Latch function', description: 'Test latch engages securely. Check child-proof mechanism if fitted.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Hinge condition', description: 'Check hinges for corrosion, play, alignment. Lubricate if needed.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Gate structure', description: 'Check gate panel for damage, rot (timber), corrosion (metal).', appliesTo: ['operational', 'annual_main'] },
      { label: 'Finger entrapment at hinge side', description: 'Check hinge gap for finger entrapment risk.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Gate does not close or latch (containment failure)', 'Finger entrapment at hinges', 'Gate collapsed or detached'],
      high: ['Self-closer not functioning', 'Latch intermittently failing', 'Significant structural damage to gate panel'],
      medium: ['Self-closer slow', 'Hinge stiff (still functional)', 'Surface rust on fittings'],
      low: ['Paint wear', 'Minor surface marks'],
    },
    bsEnDefectCategories: [],
  },

  fence: {
    key: 'fence',
    name: 'Fence',
    complianceStandard: 'General duty of care',
    inspectionPoints: [
      { label: 'Panel integrity', description: 'Check for broken, bent, or missing fence panels/rails.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Post condition', description: 'Check posts for rot (timber), corrosion (metal), stability.', appliesTo: ['operational', 'annual_main'] },
      { label: 'Sharp edges/protrusions', description: 'Check for exposed wire ends, broken rail tips, protruding fixings.', appliesTo: ['routine_visual', 'operational', 'annual_main'] },
      { label: 'Climbing prevention', description: 'Check fence design does not create easy footholds for climbing.', appliesTo: ['annual_main'] },
    ],
    riskCriteria: {
      very_high: ['Fence section collapsed (containment failure near road/water)', 'Exposed sharp wire causing laceration risk'],
      high: ['Multiple panels missing/broken (containment breach)', 'Post leaning significantly', 'Sharp protrusion at child height'],
      medium: ['Single panel damaged', 'Post rot visible but stable', 'Surface corrosion'],
      low: ['Paint wear', 'Minor weathering'],
    },
    bsEnDefectCategories: [],
  },
};
