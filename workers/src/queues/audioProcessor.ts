/**
 * InspectVoice — Audio Processing Queue Consumer
 * Cloudflare Queue consumer that orchestrates the AI pipeline.
 *
 * Tiered Transcription Pipeline:
 *   Tier 1 (default): Cloudflare Workers AI Whisper — fast, free
 *   Tier 2 (escalation): Speechmatics — enhanced accuracy, custom dictionary
 *
 * Escalation triggers:
 *   - Inspector sets high_accuracy flag (manual override from UI)
 *   - Annual inspection with long audio (>60s)
 *   - Post-processor detects standards vocabulary but garbled Whisper output
 *
 * Full pipeline:
 *   1. Receive message from AUDIO_PROCESSING_QUEUE
 *   2. Fetch audio file from R2
 *   3. Transcribe: Whisper first, escalate to Speechmatics if needed
 *   4. Send transcript + asset context to Claude for structured analysis
 *   5. Store results in DB (inspection_items, defects)
 *   6. Update parent inspection risk counts
 *
 * Error handling:
 *   - Transient failures → message retried by Cloudflare (up to 3x)
 *   - Permanent failures → mark inspection_item as 'failed'
 *   - Each step is logged for tracing
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Env, QueueMessageBody } from '../types';
import { transcribeWithWhisper, shouldEscalateToSpeechmatics } from '../services/whisper';
import { transcribeAudio as transcribeWithSpeechmatics } from '../services/speechmatics';
import { analyseTranscript, type AIAnalysisResult } from '../services/ai';
import { Logger } from '../shared/logger';
import { BadRequestError } from '../shared/errors';

// =============================================
// PAYLOAD TYPE (matches uploads.ts enqueue shape)
// =============================================

interface AudioProcessingPayload {
  readonly r2Key: string;
  readonly inspectionItemId: string;
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetType: string;
  readonly mimeType: string;
  readonly durationSeconds: number;
  /** Inspector-requested high accuracy transcription */
  readonly highAccuracy?: boolean;
}

type InspectionType = 'routine_visual' | 'operational' | 'annual_main';

/** Unified transcription result from either tier */
interface TranscriptionOutput {
  readonly transcript: string;
  readonly confidence: number;
  readonly durationSeconds: number;
  readonly model: string;
  readonly method: 'whisper' | 'speechmatics' | 'whisper+speechmatics';
  /** If escalation occurred, why */
  readonly escalationReasons?: string[];
}

// =============================================
// QUEUE CONSUMER ENTRY POINT
// =============================================

/**
 * Process a batch of audio transcription messages.
 * Registered in index.ts as the queue handler for AUDIO_PROCESSING_QUEUE.
 */
export async function handleAudioQueue(
  batch: MessageBatch<QueueMessageBody>,
  env: Env,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  for (const message of batch.messages) {
    const msg = message.body;

    if (msg.type !== 'audio_transcription') {
      message.ack();
      continue;
    }

    const logger = Logger.minimal(msg.requestId);
    const payload = msg.payload as unknown as AudioProcessingPayload;

    try {
      await processAudioMessage(msg, payload, env, sql, logger);
      message.ack();
    } catch (error) {
      if (error instanceof BadRequestError) {
        logger.warn('Permanent failure — not retrying', {
          inspectionItemId: payload.inspectionItemId,
          error: error.message,
        });
        await markItemFailed(sql, msg.orgId, payload.inspectionItemId, error.message, logger);
        message.ack();
        continue;
      }

      logger.error('Audio processing failed', error, {
        inspectionItemId: payload.inspectionItemId,
        attempt: message.attempts,
      });

      if (message.attempts >= 3) {
        await markItemFailed(
          sql,
          msg.orgId,
          payload.inspectionItemId,
          error instanceof Error ? error.message : 'Unknown error',
          logger,
        );
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}

// =============================================
// PROCESS SINGLE MESSAGE
// =============================================

async function processAudioMessage(
  msg: QueueMessageBody,
  payload: AudioProcessingPayload,
  env: Env,
  sql: NeonQueryFunction<false, false>,
  logger: Logger,
): Promise<void> {
  const { r2Key, inspectionItemId, assetId, assetCode, assetType, mimeType } = payload;

  logger.info('Processing audio', {
    inspectionItemId,
    assetCode,
    assetType,
    r2Key,
    highAccuracy: payload.highAccuracy ?? false,
  });

  // ── Step 1: Mark as 'processing' ──
  await updateItemStatus(sql, msg.orgId, inspectionItemId, 'processing', logger);

  // ── Step 1b: Look up inspection context ──
  const context = await getInspectionContext(sql, msg.orgId, inspectionItemId, logger);

  // ── Step 2: Fetch audio from R2 ──
  logger.info('Fetching audio from R2', { r2Key });
  const audioObject = await env.INSPECTVOICE_BUCKET.get(r2Key);

  if (!audioObject) {
    throw new Error(`Audio file not found in R2: ${r2Key}`);
  }

  const audioData = await audioObject.arrayBuffer();
  logger.info('Audio fetched', { sizeBytes: audioData.byteLength });

  // ── Step 3: Tiered transcription ──
  const transcription = await tieredTranscribe(
    audioData,
    mimeType,
    payload,
    context.inspectionType,
    env,
    msg.requestId,
    logger,
  );

  if (!transcription.transcript || transcription.transcript.trim().length === 0) {
    logger.warn('Empty transcript — skipping AI analysis', { inspectionItemId });
    await storeTranscriptOnly(sql, msg.orgId, inspectionItemId, transcription, logger);
    return;
  }

  // ── Step 4: Claude AI analysis ──
  const analysisResult = await analyseTranscript(
    {
      transcript: transcription.transcript,
      assetCode,
      assetType,
      inspectionType: context.inspectionType,
      requestId: msg.requestId,
    },
    env.ANTHROPIC_API_KEY,
  );

  // ── Step 5: Store results ──
  await storeAnalysisResults(
    sql, msg.orgId, inspectionItemId, transcription, analysisResult, logger,
  );

  // ── Step 6: Create defect records ──
  if (analysisResult.defects.length > 0) {
    await createDefectRecords(
      sql,
      msg.orgId,
      context.siteId,
      context.inspectionId,
      assetId,
      inspectionItemId,
      analysisResult,
      logger,
    );
  }

  // ── Step 7: Update inspection risk counts ──
  await updateInspectionRiskCounts(sql, msg.orgId, inspectionItemId, logger);

  logger.info('Audio processing complete', {
    inspectionItemId,
    transcriptionMethod: transcription.method,
    escalationReasons: transcription.escalationReasons,
    overallCondition: analysisResult.overallCondition,
    riskRating: analysisResult.riskRating,
    defectCount: analysisResult.defects.length,
    tokenUsage: analysisResult.tokenUsage,
  });
}

// =============================================
// TIERED TRANSCRIPTION
// =============================================

/**
 * Tiered transcription: Whisper first, escalate to Speechmatics if needed.
 *
 * Direct Speechmatics (skip Whisper) when:
 *   - Inspector explicitly requests high accuracy
 *
 * Whisper → Speechmatics escalation when:
 *   - Post-processor detects standards vocabulary in garbled output
 *   - Annual inspection with long audio
 */
async function tieredTranscribe(
  audioData: ArrayBuffer,
  mimeType: string,
  payload: AudioProcessingPayload,
  inspectionType: InspectionType,
  env: Env,
  requestId: string,
  logger: Logger,
): Promise<TranscriptionOutput> {

  // ── Direct to Speechmatics: inspector override ──
  if (payload.highAccuracy) {
    logger.info('High accuracy requested — using Speechmatics directly', {
      inspectionItemId: payload.inspectionItemId,
    });

    const smResult = await transcribeWithSpeechmatics(
      audioData,
      mimeType,
      env.SPEECHMATICS_API_KEY,
      requestId,
    );

    return {
      transcript: smResult.transcript,
      confidence: smResult.confidence,
      durationSeconds: smResult.durationSeconds,
      model: smResult.model,
      method: 'speechmatics',
      escalationReasons: ['inspector_high_accuracy_override'],
    };
  }

  // ── Tier 1: Whisper ──
  logger.info('Tier 1: Transcribing with Whisper', {
    inspectionItemId: payload.inspectionItemId,
  });

  const whisperResult = await transcribeWithWhisper(audioData, env.AI, requestId);

  // ── Check escalation rules ──
  const escalation = shouldEscalateToSpeechmatics(
    whisperResult.transcript,
    whisperResult.durationSeconds,
    inspectionType,
  );

  if (!escalation.escalate) {
    // Whisper result is good enough — use it
    logger.info('Tier 1 sufficient — no escalation needed', {
      inspectionItemId: payload.inspectionItemId,
      wordCount: whisperResult.wordCount,
    });

    return {
      transcript: whisperResult.transcript,
      confidence: whisperResult.confidence,
      durationSeconds: whisperResult.durationSeconds,
      model: whisperResult.model,
      method: 'whisper',
    };
  }

  // ── Tier 2: Escalate to Speechmatics ──
  logger.info('Escalating to Speechmatics', {
    inspectionItemId: payload.inspectionItemId,
    reasons: escalation.reasons,
    whisperTranscriptPreview: whisperResult.transcript.slice(0, 100),
  });

  try {
    const smResult = await transcribeWithSpeechmatics(
      audioData,
      mimeType,
      env.SPEECHMATICS_API_KEY,
      requestId,
    );

    return {
      transcript: smResult.transcript,
      confidence: smResult.confidence,
      durationSeconds: smResult.durationSeconds,
      model: smResult.model,
      method: 'whisper+speechmatics',
      escalationReasons: escalation.reasons,
    };
  } catch (smError) {
    // Speechmatics failed — fall back to Whisper result (better than nothing)
    logger.warn('Speechmatics escalation failed — using Whisper result as fallback', {
      inspectionItemId: payload.inspectionItemId,
      error: smError instanceof Error ? smError.message : 'Unknown error',
    });

    return {
      transcript: whisperResult.transcript,
      confidence: whisperResult.confidence,
      durationSeconds: whisperResult.durationSeconds,
      model: `${whisperResult.model} (speechmatics-fallback)`,
      method: 'whisper',
      escalationReasons: [...escalation.reasons, 'speechmatics_failed_used_whisper'],
    };
  }
}

// =============================================
// DATABASE OPERATIONS
// =============================================

interface InspectionContext {
  readonly inspectionId: string;
  readonly inspectionType: InspectionType;
  readonly siteId: string;
}

async function getInspectionContext(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionItemId: string,
  logger: Logger,
): Promise<InspectionContext> {
  try {
    const rows = await sql(
      `SELECT i.id AS inspection_id, i.inspection_type, i.site_id
       FROM inspections i
       INNER JOIN inspection_items ii ON ii.inspection_id = i.id
       WHERE i.org_id = $1 AND ii.id = $2
       LIMIT 1`,
      [orgId, inspectionItemId],
    );

    const row = rows[0] as Record<string, unknown> | undefined;
    const inspectionId = row?.['inspection_id'] as string | undefined;
    const type = row?.['inspection_type'] as string | undefined;
    const siteId = row?.['site_id'] as string | undefined;

    if (!inspectionId || !siteId) {
      throw new Error(`Cannot resolve parent inspection for item ${inspectionItemId}`);
    }

    const inspectionType: InspectionType =
      type === 'routine_visual' || type === 'operational' || type === 'annual_main'
        ? type
        : 'routine_visual';

    return { inspectionId, inspectionType, siteId };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot resolve')) throw error;
    throw new Error(`Database error resolving inspection context for item ${inspectionItemId}`);
  }
}

async function updateItemStatus(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionItemId: string,
  status: string,
  logger: Logger,
): Promise<void> {
  try {
    await sql(
      `UPDATE inspection_items SET ai_processing_status = $1
       WHERE id = $2
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $3)`,
      [status, inspectionItemId, orgId],
    );
  } catch (error) {
    logger.error('Failed to update item status', error, { inspectionItemId, status });
    throw error;
  }
}

async function storeTranscriptOnly(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionItemId: string,
  transcription: TranscriptionOutput,
  logger: Logger,
): Promise<void> {
  try {
    await sql(
      `UPDATE inspection_items SET
        voice_transcript = $1,
        transcription_method = $2,
        ai_processing_status = 'completed',
        ai_processed_at = NOW(),
        ai_model_version = $3
       WHERE id = $4
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $5)`,
      [
        transcription.transcript,
        transcription.method,
        transcription.model,
        inspectionItemId,
        orgId,
      ],
    );
  } catch (error) {
    logger.error('Failed to store transcript', error, { inspectionItemId });
    throw error;
  }
}

async function storeAnalysisResults(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionItemId: string,
  transcription: TranscriptionOutput,
  analysis: AIAnalysisResult,
  logger: Logger,
): Promise<void> {
  try {
    const modelVersion = `${transcription.model}|claude:claude-sonnet-4-20250514`;

    await sql(
      `UPDATE inspection_items SET
        voice_transcript = $1,
        transcription_method = $2,
        ai_analysis = $3,
        ai_model_version = $4,
        ai_processing_status = 'completed',
        ai_processed_at = NOW(),
        overall_condition = $5,
        risk_rating = $6,
        requires_action = $7,
        action_timeframe = $8,
        defects = $9
       WHERE id = $10
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $11)`,
      [
        transcription.transcript,
        transcription.method,
        JSON.stringify({
          ...analysis,
          transcription_confidence: transcription.confidence,
          escalation_reasons: transcription.escalationReasons ?? [],
        }),
        modelVersion,
        analysis.overallCondition,
        analysis.riskRating,
        analysis.requiresAction,
        analysis.actionTimeframe,
        JSON.stringify(analysis.defects),
        inspectionItemId,
        orgId,
      ],
    );

    logger.info('Analysis results stored', {
      inspectionItemId,
      defectCount: analysis.defects.length,
      tokenUsage: analysis.tokenUsage,
    });
  } catch (error) {
    logger.error('Failed to store analysis results', error, { inspectionItemId });
    throw error;
  }
}

async function createDefectRecords(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  siteId: string,
  inspectionId: string,
  assetId: string,
  inspectionItemId: string,
  analysis: AIAnalysisResult,
  logger: Logger,
): Promise<void> {
  try {
    const now = new Date().toISOString();

    const valuePlaceholders: string[] = [];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    for (const defect of analysis.defects) {
      const defectId = crypto.randomUUID();

      valuePlaceholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, ` +
        `$${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, ` +
        `$${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, ` +
        `'open', 'ai', $${paramIndex + 12}, $${paramIndex + 12})`,
      );

      params.push(
        defectId,
        orgId,
        siteId,
        inspectionId,
        assetId,
        inspectionItemId,
        defect.description,
        defect.severity,
        defect.defectCategory,
        defect.bsEnReference,
        defect.actionRequired,
        defect.actionTimeframe,
        defect.estimatedRepairCost,
        now,
      );

      paramIndex += 13;
    }

    const query = `
      INSERT INTO defects (
        id, org_id, site_id, inspection_id, asset_id, inspection_item_id,
        description, severity, defect_category, bs_en_reference,
        action_required, action_timeframe, estimated_cost_gbp,
        status, source, created_at, updated_at
      ) VALUES ${valuePlaceholders.join(', ')}`;

    await sql(query, params);

    logger.info('Defect records created (batch)', {
      inspectionItemId,
      count: analysis.defects.length,
    });
  } catch (error) {
    logger.error('Failed to create defect records', error, { inspectionItemId });
    // Non-fatal: AI analysis already stored on inspection item
  }
}

async function updateInspectionRiskCounts(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionItemId: string,
  logger: Logger,
): Promise<void> {
  try {
    await sql(
      `UPDATE inspections SET
        very_high_risk_count = (
          SELECT COUNT(*) FROM inspection_items
          WHERE inspection_id = inspections.id AND risk_rating = 'very_high'
        ),
        high_risk_count = (
          SELECT COUNT(*) FROM inspection_items
          WHERE inspection_id = inspections.id AND risk_rating = 'high'
        ),
        medium_risk_count = (
          SELECT COUNT(*) FROM inspection_items
          WHERE inspection_id = inspections.id AND risk_rating = 'medium'
        ),
        low_risk_count = (
          SELECT COUNT(*) FROM inspection_items
          WHERE inspection_id = inspections.id AND risk_rating = 'low'
        ),
        total_defects = (
          SELECT COUNT(*) FROM defects d
          INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
          WHERE ii.inspection_id = inspections.id
        ),
        overall_risk_rating = (
          SELECT CASE
            WHEN COUNT(*) FILTER (WHERE risk_rating = 'very_high') > 0 THEN 'very_high'
            WHEN COUNT(*) FILTER (WHERE risk_rating = 'high') > 0 THEN 'high'
            WHEN COUNT(*) FILTER (WHERE risk_rating = 'medium') > 0 THEN 'medium'
            ELSE 'low'
          END
          FROM inspection_items
          WHERE inspection_id = inspections.id AND risk_rating IS NOT NULL
        ),
        closure_recommended = (
          SELECT EXISTS(
            SELECT 1 FROM inspection_items
            WHERE inspection_id = inspections.id AND risk_rating = 'very_high'
          )
        ),
        updated_at = NOW()
       WHERE id = (
         SELECT inspection_id FROM inspection_items WHERE id = $1
       )
       AND org_id = $2`,
      [inspectionItemId, orgId],
    );

    logger.info('Inspection risk counts updated', { inspectionItemId });
  } catch (error) {
    logger.error('Failed to update inspection risk counts', error, { inspectionItemId });
  }
}

async function markItemFailed(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionItemId: string,
  errorMessage: string,
  logger: Logger,
): Promise<void> {
  try {
    await sql(
      `UPDATE inspection_items SET
        ai_processing_status = 'failed',
        ai_processed_at = NOW(),
        ai_analysis = $1
       WHERE id = $2
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $3)`,
      [
        JSON.stringify({ error: errorMessage.slice(0, 500) }),
        inspectionItemId,
        orgId,
      ],
    );
  } catch (dbError) {
    logger.error('Failed to mark item as failed in DB', dbError, { inspectionItemId });
  }
}
