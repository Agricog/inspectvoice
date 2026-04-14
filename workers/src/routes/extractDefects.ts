/**
 * InspectVoice — Voice-to-Defect Extraction Route
 * Extracts structured defects from a voice transcript using Claude.
 *
 * POST /api/v1/extract-defects
 *
 * Body: { transcript: string, asset_type: string, asset_code: string }
 * Returns: { defects: DefectDetail[] }
 *
 * This is a real-time extraction called during capture — must be fast.
 * Uses Haiku for speed. No database writes — purely stateless transform.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { BadRequestError, BadGatewayError } from '../shared/errors';
import { parseJsonBody, validateString } from '../shared/validation';
import { jsonResponse } from './helpers';
import { Logger } from '../shared/logger';
import { getWorkerAssetConfig } from '../services/ai';

// =============================================
// CONFIGURATION
// =============================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.1;
const REQUEST_TIMEOUT_MS = 15_000;

// =============================================
// ROUTE HANDLER
// =============================================

export async function extractDefectsFromTranscript(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const logger = Logger.fromContext(ctx);

  const transcript = validateString(body['transcript'], 'transcript', { maxLength: 10000 });
  const assetType = validateString(body['asset_type'], 'asset_type', { maxLength: 100 });
  const assetCode = validateString(body['asset_code'], 'asset_code', { maxLength: 50 });

  if (transcript.length < 15) {
    throw new BadRequestError('Transcript too short for defect extraction (minimum 15 characters)');
  }

  // Get BS EN context for this asset type
  const config = getWorkerAssetConfig(assetType);
  const complianceStandard = config.complianceStandard || 'BS EN 1176-1:2017';
  const inspectionPoints = config.inspectionPoints
    .map((p) => p.label)
    .slice(0, 10)
    .join(', ');

  const systemPrompt = `You are a UK playground safety inspection AI assistant for InspectVoice.
You extract structured defect data from an inspector's voice transcript.

The inspector is examining: ${assetCode} (${config.name || assetType})
Primary compliance standard: ${complianceStandard}
Relevant inspection points: ${inspectionPoints || 'General playground safety'}

## RULES

1. Extract ONLY defects that the inspector actually described. Never invent or assume defects.
2. If the transcript describes no defects (e.g. "all good", "no issues"), return an empty defects array.
3. Each defect must have ALL fields populated.
4. BS EN references must be real and specific to the defect type:
   - Structural/frame issues → BS EN 1176-1:2017
   - Swing specific → BS EN 1176-2:2017
   - Slide specific → BS EN 1176-3:2017
   - Cableway specific → BS EN 1176-4:2017
   - Roundabout specific → BS EN 1176-5:2017
   - Rocking equipment → BS EN 1176-6:2017
   - Installation/maintenance → BS EN 1176-7:2020
   - Impact surfacing → BS EN 1177:2018
   - Entrapment hazards → BS EN 1176-1:2017 clause 4.2.7
   - Fall height/clearance → BS EN 1176-1:2017 clause 4.2.8
   - Protrusions → BS EN 1176-1:2017 clause 4.2.6
5. Risk ratings: very_high (immediate danger), high (action within 48hrs), medium (action within 1 month), low (routine maintenance)
6. Action timeframes: immediate, 48_hours, 1_week, 1_month, next_inspection, routine
7. Cost bands: under_100, 100_500, 500_1000, 1000_5000, over_5000
8. Remedial actions must be specific and actionable — not vague.

## OUTPUT FORMAT
Respond with ONLY a JSON object. No markdown fences, no preamble.

{
  "defects": [
    {
      "description": "Clear professional description of the defect",
      "bs_en_reference": "BS EN 1176-X:20XX clause X.X.X",
      "risk_rating": "high",
      "remedial_action": "Specific actionable repair instruction",
      "action_timeframe": "48_hours",
      "estimated_cost_band": "100_500"
    }
  ]
}`;

  const userPrompt = `Extract defects from this voice transcript for ${assetCode} (${config.name || assetType}):\n\n"""${transcript}"""`;

  logger.info('Extracting defects from transcript', {
    assetCode,
    assetType,
    transcriptLength: transcript.length,
  });

  // Call Claude
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ctx.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (response.status >= 400 && response.status < 500) {
      const err = await response.text().catch(() => 'Unknown');
      logger.error('Anthropic client error', null, { status: response.status, error: err.slice(0, 300) });
      throw new BadGatewayError(`AI extraction error: ${response.status}`);
    }

    if (!response.ok) {
      throw new BadGatewayError(`AI extraction failed: ${response.status}`);
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const textBlock = data.content?.find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new BadGatewayError('AI returned empty response');
    }

    // Parse JSON response
    let cleaned = textBlock.text.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new BadGatewayError('AI returned invalid JSON');
    }

    const defects = Array.isArray(parsed['defects']) ? parsed['defects'] : [];

    // Validate and sanitise each defect
    const validDefects: Array<Record<string, string>> = [];
    for (const raw of defects as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') continue;
      const desc = typeof raw['description'] === 'string' ? raw['description'].trim() : '';
      if (desc.length < 10) continue; // Skip garbage

      validDefects.push({
        description: desc,
        bs_en_reference: typeof raw['bs_en_reference'] === 'string' ? raw['bs_en_reference'] : '',
        risk_rating: typeof raw['risk_rating'] === 'string' ? raw['risk_rating'] : 'medium',
        remedial_action: typeof raw['remedial_action'] === 'string' ? raw['remedial_action'] : '',
        action_timeframe: typeof raw['action_timeframe'] === 'string' ? raw['action_timeframe'] : 'routine',
        estimated_cost_band: typeof raw['estimated_cost_band'] === 'string' ? raw['estimated_cost_band'] : 'low',
      });
    }

    logger.info('Defect extraction complete', {
      assetCode,
      defectsFound: validDefects.length,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });

    return jsonResponse({
      success: true,
      data: { defects: validDefects },
    }, ctx.requestId);
  } catch (error) {
    if (error instanceof BadGatewayError || error instanceof BadRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BadGatewayError('AI extraction timed out');
    }
    throw new BadGatewayError(
      `AI extraction failed: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
