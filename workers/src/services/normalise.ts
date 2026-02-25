/**
 * InspectVoice — AI Style Normalisation Service
 * Normalises inspection text to a consistent organisational house style.
 *
 * Key principles:
 *   - BS EN references are PROTECTED TOKENS — AI cannot alter them
 *   - Inspector always sees diff and explicitly approves
 *   - Original text is always preserved in audit log
 *   - Haiku for speed/cost; Sonnet only when confidence is low
 *   - Per-org token budget enforcement
 *
 * Reuses same Anthropic API patterns as ai.ts (retry, timeout, logging).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import { Logger } from '../shared/logger';
import { BadGatewayError, BadRequestError } from '../shared/errors';
import type { Env } from '../types';

// =============================================
// CONFIGURATION
// =============================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.15;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

/** Maximum input text length (chars) */
const MAX_INPUT_LENGTH = 5_000;

/** Minimum text length worth normalising */
const MIN_INPUT_LENGTH = 10;

/** Default monthly token budget per org */
const DEFAULT_MONTHLY_BUDGET = 500_000;

/** Current prompt version — increment when prompt changes */
const PROMPT_VERSION = 'v1';

// =============================================
// TYPES
// =============================================

export type NormalisableField =
  | 'defect_description'
  | 'remedial_action'
  | 'inspector_summary'
  | 'condition_observation';

export interface StyleConfig {
  readonly enabled: boolean;
  readonly stylePreset: 'formal' | 'technical' | 'plain_english';
  readonly customGuide: string | null;
  readonly examples: readonly StyleExample[];
  readonly correctSpellingGrammar: boolean;
  readonly requireReviewBeforeExport: boolean;
  readonly monthlyTokenBudget: number;
  readonly modelPreference: 'haiku' | 'sonnet';
}

export interface StyleExample {
  readonly before: string;
  readonly after: string;
}

export interface NormaliseFieldInput {
  readonly fieldName: NormalisableField;
  readonly originalText: string;
  readonly inspectionId?: string;
  readonly inspectionItemId?: string;
  readonly defectId?: string;
  readonly assetType?: string;
}

export interface NormaliseResult {
  readonly logId: string;
  readonly fieldName: NormalisableField;
  readonly originalText: string;
  readonly normalisedText: string;
  readonly diffSummary: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly noChangesNeeded: boolean;
}

export interface BatchNormaliseResult {
  readonly results: readonly NormaliseResult[];
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly budgetRemaining: number;
}

// =============================================
// BS EN REFERENCE PROTECTION
// =============================================

/**
 * Pattern matches common BS EN reference formats:
 * - BS EN 1176-1:2017
 * - BS EN 1176-1:2017 §4.2.8.2
 * - BS EN 1177:2018
 * - EN 16630:2015
 * - EN 1176-7:2020 clause 4.3
 */
const BS_EN_PATTERN = /(?:BS\s*)?EN\s*\d{4,5}(?:-\d{1,2})?(?::\d{4})?(?:\s*§[\d.]+)?(?:\s*(?:clause|section|annex)\s*[\d.A-Z]+)?/gi;

interface ProtectedToken {
  readonly placeholder: string;
  readonly original: string;
}

/**
 * Extract BS EN references and replace with numbered placeholders.
 * Returns cleaned text + map of placeholders to originals.
 */
function protectBsEnReferences(text: string): {
  cleanedText: string;
  tokens: readonly ProtectedToken[];
} {
  const tokens: ProtectedToken[] = [];
  let index = 0;

  const cleanedText = text.replace(BS_EN_PATTERN, (match) => {
    const placeholder = `[[BSEN_${index}]]`;
    tokens.push({ placeholder, original: match.trim() });
    index++;
    return placeholder;
  });

  return { cleanedText, tokens };
}

/**
 * Restore BS EN references from placeholders.
 * If AI accidentally modified a placeholder, restore the original.
 */
function restoreBsEnReferences(
  text: string,
  tokens: readonly ProtectedToken[],
): string {
  let restored = text;
  for (const token of tokens) {
    // Exact placeholder match
    if (restored.includes(token.placeholder)) {
      restored = restored.replace(token.placeholder, token.original);
    }
  }

  // Safety: remove any unreplaced placeholders (shouldn't happen)
  restored = restored.replace(/\[\[BSEN_\d+\]\]/g, '');

  return restored;
}

// =============================================
// STYLE CONFIG RESOLUTION
// =============================================

const DEFAULT_STYLE_CONFIG: StyleConfig = {
  enabled: false,
  stylePreset: 'formal',
  customGuide: null,
  examples: [],
  correctSpellingGrammar: true,
  requireReviewBeforeExport: true,
  monthlyTokenBudget: DEFAULT_MONTHLY_BUDGET,
  modelPreference: 'haiku',
};

/**
 * Extract normalisation style config from org settings JSONB.
 */
export function resolveStyleConfig(
  orgSettings: Record<string, unknown>,
): StyleConfig {
  const raw = orgSettings['normalisation'];
  if (!raw || typeof raw !== 'object') return DEFAULT_STYLE_CONFIG;

  const settings = raw as Record<string, unknown>;

  const validPresets = ['formal', 'technical', 'plain_english'] as const;
  const preset = typeof settings['style_preset'] === 'string'
    && validPresets.includes(settings['style_preset'] as typeof validPresets[number])
    ? settings['style_preset'] as StyleConfig['stylePreset']
    : 'formal';

  const validModels = ['haiku', 'sonnet'] as const;
  const model = typeof settings['model_preference'] === 'string'
    && validModels.includes(settings['model_preference'] as typeof validModels[number])
    ? settings['model_preference'] as StyleConfig['modelPreference']
    : 'haiku';

  const examples: StyleExample[] = [];
  if (Array.isArray(settings['examples'])) {
    for (const ex of settings['examples'] as unknown[]) {
      if (
        ex && typeof ex === 'object'
        && 'before' in (ex as Record<string, unknown>)
        && 'after' in (ex as Record<string, unknown>)
      ) {
        const e = ex as Record<string, unknown>;
        if (typeof e['before'] === 'string' && typeof e['after'] === 'string') {
          examples.push({ before: e['before'], after: e['after'] });
        }
      }
    }
  }

  return {
    enabled: settings['enabled'] === true,
    stylePreset: preset,
    customGuide: typeof settings['custom_guide'] === 'string'
      ? settings['custom_guide']
      : null,
    examples: examples.slice(0, 10), // Cap at 10 examples
    correctSpellingGrammar: settings['correct_spelling_grammar'] !== false,
    requireReviewBeforeExport: settings['require_review_before_export'] !== false,
    monthlyTokenBudget: typeof settings['monthly_token_budget'] === 'number'
      ? settings['monthly_token_budget']
      : DEFAULT_MONTHLY_BUDGET,
    modelPreference: model,
  };
}

// =============================================
// TOKEN BUDGET CHECK
// =============================================

async function checkTokenBudget(
  sql: ReturnType<typeof neon>,
  orgId: string,
  budget: number,
): Promise<{ withinBudget: boolean; used: number; remaining: number }> {
  const monthYear = new Date().toISOString().slice(0, 7); // '2026-02'

  const rows = await sql(
    `SELECT input_tokens_total + output_tokens_total AS total_tokens
     FROM normalisation_usage
     WHERE org_id = $1 AND month_year = $2`,
    [orgId, monthYear],
  );

  const used = rows.length > 0 ? Number((rows[0] as Record<string, unknown>)['total_tokens'] ?? 0) : 0;
  const remaining = Math.max(0, budget - used);

  return {
    withinBudget: used < budget,
    used,
    remaining,
  };
}

async function trackTokenUsage(
  sql: ReturnType<typeof neon>,
  orgId: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
): Promise<void> {
  const monthYear = new Date().toISOString().slice(0, 7);

  // Haiku: $0.80/MTok input, $4/MTok output
  // Sonnet: $3/MTok input, $15/MTok output
  const rates = model.includes('haiku')
    ? { input: 0.80, output: 4.0 }
    : { input: 3.0, output: 15.0 };

  const cost = (inputTokens / 1_000_000) * rates.input
    + (outputTokens / 1_000_000) * rates.output;

  await sql(
    `INSERT INTO normalisation_usage
       (org_id, month_year, input_tokens_total, output_tokens_total, request_count, estimated_cost_usd)
     VALUES ($1, $2, $3, $4, 1, $5)
     ON CONFLICT (org_id, month_year)
     DO UPDATE SET
       input_tokens_total = normalisation_usage.input_tokens_total + $3,
       output_tokens_total = normalisation_usage.output_tokens_total + $4,
       request_count = normalisation_usage.request_count + 1,
       estimated_cost_usd = normalisation_usage.estimated_cost_usd + $5,
       updated_at = now()`,
    [orgId, monthYear, inputTokens, outputTokens, cost.toFixed(4)],
  );
}

// =============================================
// PROMPT CONSTRUCTION
// =============================================

const PRESET_DESCRIPTIONS: Record<string, string> = {
  formal: `Write in formal third-person language suitable for a UK council parks department inspection report.
Use complete sentences, professional terminology, and measured assessments.
Avoid colloquialisms, abbreviations, contractions, and subjective language.
Example tone: "Corrosion observed on multiple chain links of the suspension system. Chain link integrity may be compromised."`,

  technical: `Write in precise technical language suitable for an engineering assessment report.
Use specific measurements, material descriptions, and failure mode terminology where applicable.
Reference specific components by their technical names.
Example tone: "Grade 316 stainless steel chain links exhibit surface oxidation consistent with atmospheric corrosion. Three links show >15% cross-sectional reduction."`,

  plain_english: `Write in clear, straightforward English suitable for a non-technical audience (e.g. school governors, parish councils).
Avoid jargon. Explain what the defect means in practical terms.
Use active voice and short sentences.
Example tone: "Several chain links are rusty and weakened. The swing may not be safe to use until the chains are replaced."`,
};

function buildNormalisationSystemPrompt(
  style: StyleConfig,
  fieldName: NormalisableField,
): string {
  const fieldContext: Record<NormalisableField, string> = {
    defect_description: 'a defect description in a playground safety inspection report',
    remedial_action: 'a recommended remedial action for a playground defect',
    inspector_summary: 'an inspector\'s summary of findings for a playground inspection report',
    condition_observation: 'an asset condition observation from a playground inspection',
  };

  let prompt = `You are a professional text editor for InspectVoice, a UK playground safety inspection platform.

Your task is to normalise ${fieldContext[fieldName]} to match the organisation's house writing style.

## ABSOLUTE RULES — NEVER VIOLATE

1. PRESERVE ALL FACTUAL CONTENT
   - Never add defects, findings, or observations not present in the original.
   - Never remove or downplay findings described in the original.
   - Never change the meaning, severity assessment, or technical substance.

2. PROTECTED TOKENS — DO NOT MODIFY
   - Any text in double square brackets like [[BSEN_0]], [[BSEN_1]] etc. are protected references.
   - Output them EXACTLY as they appear. Do not alter, remove, reformat, or reorder them.
   - They will be automatically restored to their original values after normalisation.

3. DO NOT FABRICATE REFERENCES
   - Never add BS EN clause numbers, standards, or citations that were not in the original.
   - If the original mentions a standard vaguely, leave the reference as-is.

## WRITING STYLE

${PRESET_DESCRIPTIONS[style.stylePreset] ?? PRESET_DESCRIPTIONS['formal']}`;

  // Custom guide overlay
  if (style.customGuide && style.customGuide.length > 0) {
    prompt += `

## ADDITIONAL ORGANISATION STYLE GUIDE
${style.customGuide.slice(0, 2000)}`;
  }

  // Examples
  if (style.examples.length > 0) {
    prompt += `

## HOUSE STYLE EXAMPLES
These show the organisation's preferred phrasing. Match this tone and structure:
`;
    for (const ex of style.examples.slice(0, 5)) {
      prompt += `
Before: "${ex.before}"
After: "${ex.after}"
`;
    }
  }

  // Spelling/grammar
  if (style.correctSpellingGrammar) {
    prompt += `

## SPELLING & GRAMMAR
Correct spelling, grammar, and punctuation errors. Use British English spelling (e.g. "colour" not "color", "normalise" not "normalize").`;
  } else {
    prompt += `

## SPELLING & GRAMMAR
Preserve the inspector's original spelling and grammar. Only normalise tone and structure.`;
  }

  prompt += `

## OUTPUT FORMAT
Respond with ONLY a JSON object. No markdown fences, no preamble, no trailing text.

{
  "normalised_text": "The normalised version of the text",
  "diff_summary": "Brief 1-2 sentence summary of what was changed (e.g. 'Formalised tone, corrected spelling, restructured for clarity')",
  "no_changes_needed": false
}

If the original text already matches the house style perfectly, set no_changes_needed to true and return the original text unchanged as normalised_text.`;

  return prompt;
}

// =============================================
// SINGLE FIELD NORMALISATION
// =============================================

/**
 * Normalise a single text field.
 *
 * @returns NormaliseResult with the suggestion (status: 'pending')
 * @throws BadRequestError if input invalid or budget exceeded
 * @throws BadGatewayError if AI unavailable
 */
export async function normaliseField(
  input: NormaliseFieldInput,
  style: StyleConfig,
  orgId: string,
  userId: string,
  env: Env,
  requestId: string,
): Promise<NormaliseResult> {
  const logger = Logger.minimal(requestId);
  const sql = neon(env.DATABASE_URL);

  // ── Validate input ──────────────────────
  if (input.originalText.length < MIN_INPUT_LENGTH) {
    throw new BadRequestError(
      `Text too short for normalisation (${input.originalText.length} chars, minimum ${MIN_INPUT_LENGTH})`,
    );
  }

  const text = input.originalText.slice(0, MAX_INPUT_LENGTH);

  // ── Check budget ────────────────────────
  const budget = await checkTokenBudget(sql, orgId, style.monthlyTokenBudget);
  if (!budget.withinBudget) {
    throw new BadRequestError(
      `Monthly normalisation token budget exceeded (${budget.used}/${style.monthlyTokenBudget} tokens used)`,
    );
  }

  // ── Protect BS EN references ────────────
  const { cleanedText, tokens } = protectBsEnReferences(text);

  // ── Select model ────────────────────────
  const model = style.modelPreference === 'sonnet' ? MODEL_SONNET : MODEL_HAIKU;

  // ── Build prompt ────────────────────────
  const systemPrompt = buildNormalisationSystemPrompt(style, input.fieldName);
  const userPrompt = `Normalise this ${input.fieldName.replace(/_/g, ' ')}:\n\n"""${cleanedText}"""`;

  // ── Call Anthropic ──────────────────────
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_DELAY_MS * attempt);
    }

    try {
      const response = await fetchWithTimeout(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      }, REQUEST_TIMEOUT_MS);

      // 4xx — don't retry
      if (response.status >= 400 && response.status < 500) {
        const err = await response.text().catch(() => 'Unknown');
        logger.error('Anthropic client error', null, { status: response.status, error: err.slice(0, 300) });
        throw new BadGatewayError(`AI normalisation error: ${response.status}`);
      }

      // 5xx — retry
      if (!response.ok) {
        lastError = `Anthropic ${response.status}`;
        continue;
      }

      const data = await response.json() as ClaudeResponse;
      const textBlock = data.content?.find((b) => b.type === 'text');

      if (!textBlock?.text) {
        throw new BadGatewayError('AI returned empty response');
      }

      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      // ── Parse response ────────────────
      const parsed = parseNormaliseResponse(textBlock.text);

      // ── Restore BS EN references ──────
      const normalisedText = parsed.noChangesNeeded
        ? input.originalText
        : restoreBsEnReferences(parsed.normalisedText, tokens);

      // ── Track usage ───────────────────
      await trackTokenUsage(sql, orgId, inputTokens, outputTokens, model);

      // ── Log to normalisation_log ──────
      const logId = crypto.randomUUID();
      await sql(
        `INSERT INTO normalisation_log
           (id, org_id, inspection_id, inspection_item_id, defect_id,
            field_name, original_text, normalised_text, diff_summary,
            status, model_used, prompt_version, input_tokens, output_tokens,
            style_preset, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $12, $13, $14, $15)`,
        [
          logId,
          orgId,
          input.inspectionId ?? null,
          input.inspectionItemId ?? null,
          input.defectId ?? null,
          input.fieldName,
          input.originalText,
          normalisedText,
          parsed.diffSummary,
          model,
          PROMPT_VERSION,
          inputTokens,
          outputTokens,
          style.stylePreset,
          userId,
        ],
      );

      logger.info('Normalisation complete', {
        logId,
        fieldName: input.fieldName,
        model,
        noChangesNeeded: parsed.noChangesNeeded,
        inputTokens,
        outputTokens,
      });

      return {
        logId,
        fieldName: input.fieldName,
        originalText: input.originalText,
        normalisedText,
        diffSummary: parsed.diffSummary,
        model,
        inputTokens,
        outputTokens,
        noChangesNeeded: parsed.noChangesNeeded,
      };
    } catch (error) {
      if (error instanceof BadGatewayError || error instanceof BadRequestError) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  throw new BadGatewayError(`AI normalisation failed after retries: ${lastError}`);
}

// =============================================
// BATCH NORMALISATION (sign-off review)
// =============================================

/**
 * Normalise multiple fields in one batch (used at sign-off review).
 * Processes sequentially to stay within rate limits and budget.
 */
export async function normaliseBatch(
  inputs: readonly NormaliseFieldInput[],
  style: StyleConfig,
  orgId: string,
  userId: string,
  env: Env,
  requestId: string,
): Promise<BatchNormaliseResult> {
  const sql = neon(env.DATABASE_URL);
  const results: NormaliseResult[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  // Pre-check budget for the whole batch
  const budget = await checkTokenBudget(sql, orgId, style.monthlyTokenBudget);
  if (!budget.withinBudget) {
    throw new BadRequestError(
      `Monthly token budget exceeded (${budget.used}/${style.monthlyTokenBudget})`,
    );
  }

  for (const input of inputs) {
    // Skip very short texts
    if (input.originalText.length < MIN_INPUT_LENGTH) continue;

    try {
      const result = await normaliseField(input, style, orgId, userId, env, requestId);
      results.push(result);
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;
    } catch (error) {
      // Log but continue batch — don't let one failure block all
      const logger = Logger.minimal(requestId);
      logger.warn('Batch normalisation field failed, continuing', {
        fieldName: input.fieldName,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  // Re-check remaining budget after batch
  const updatedBudget = await checkTokenBudget(sql, orgId, style.monthlyTokenBudget);

  return {
    results,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    budgetRemaining: updatedBudget.remaining,
  };
}

// =============================================
// ACCEPT / REJECT
// =============================================

/**
 * Accept a normalisation suggestion.
 * Updates the log record and returns the normalised text for the caller to apply.
 */
export async function acceptNormalisation(
  logId: string,
  orgId: string,
  userId: string,
  env: Env,
): Promise<{ normalisedText: string; fieldName: string }> {
  const sql = neon(env.DATABASE_URL);

  const rows = await sql(
    `UPDATE normalisation_log
     SET status = 'accepted', reviewed_by = $3, reviewed_at = now()
     WHERE id = $1 AND org_id = $2 AND status = 'pending'
     RETURNING normalised_text, field_name`,
    [logId, orgId, userId],
  );

  if (rows.length === 0) {
    throw new BadRequestError('Normalisation record not found or already reviewed');
  }

  const row = rows[0] as Record<string, unknown>;
  return {
    normalisedText: String(row['normalised_text']),
    fieldName: String(row['field_name']),
  };
}

/**
 * Reject a normalisation suggestion with reason.
 * Original text remains unchanged.
 */
export async function rejectNormalisation(
  logId: string,
  orgId: string,
  userId: string,
  reason: string,
  env: Env,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  const rows = await sql(
    `UPDATE normalisation_log
     SET status = 'rejected', rejected_reason = $4, reviewed_by = $3, reviewed_at = now()
     WHERE id = $1 AND org_id = $2 AND status = 'pending'
     RETURNING id`,
    [logId, orgId, userId, reason],
  );

  if (rows.length === 0) {
    throw new BadRequestError('Normalisation record not found or already reviewed');
  }
}

// =============================================
// RESPONSE PARSING
// =============================================

interface ParsedNormaliseResponse {
  readonly normalisedText: string;
  readonly diffSummary: string;
  readonly noChangesNeeded: boolean;
}

function parseNormaliseResponse(text: string): ParsedNormaliseResponse {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new BadGatewayError('AI returned invalid JSON for normalisation');
  }

  const normalisedText = typeof parsed['normalised_text'] === 'string'
    ? parsed['normalised_text'].trim()
    : '';

  if (normalisedText.length === 0) {
    throw new BadGatewayError('AI returned empty normalised text');
  }

  return {
    normalisedText,
    diffSummary: typeof parsed['diff_summary'] === 'string'
      ? parsed['diff_summary']
      : 'Text normalised to house style',
    noChangesNeeded: parsed['no_changes_needed'] === true,
  };
}

// =============================================
// ANTHROPIC API TYPES
// =============================================

interface ClaudeResponse {
  readonly content?: Array<{ readonly type: string; readonly text?: string }>;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

// =============================================
// HELPERS
// =============================================

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BadGatewayError('AI normalisation request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
