/**
 * InspectVoice — Audio Processing Queue Consumer
 * Cloudflare Queue consumer that orchestrates the AI pipeline.
 *
 * Pipeline:
 *   1. Receive message from AUDIO_PROCESSING_QUEUE
 *   2. Fetch audio file from R2
 *   3. Send to Speechmatics for transcription
 *   4. Send transcript + asset type context to Claude for structured analysis
 *   5. Store results in DB (inspection_items, defects)
 *   6. Update parent inspection risk counts
 *
 * Error handling:
 *   - Transient failures → message retried by Cloudflare (up to 3x)
 *   - Permanent failures → mark inspection_item as 'failed'
 *   - Each step is logged for tracing
 *
 * Hardened:
 *   - Single DB connection per batch (not per function)
 *   - Batch defect INSERT (single statement, not N+1)
 *   - Defects include org_id, site_id, inspection_id, asset_id for filtering
 *   - Token usage tracked for cost monitoring
 *   - BadRequestError from services handled as permanent failures (no retry)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Env, QueueMessageBody } from '../types';
import { transcribeAudio } from '../services/speechmatics';
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
}

type InspectionType = 'routine_visual' | 'operational' | 'annual_main';

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
  // Single DB connection for the entire batch
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
      // BadRequestError = permanent failure (bad audio, too short transcript)
      // Don't waste retries on these
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
        // Exhausted retries — mark as failed and ack to stop redelivery
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
    assetId,
    assetCode,
    assetType,
    r2Key,
  });

  // ── Step 1: Mark as 'processing' ──
  await updateItemStatus(sql, msg.orgId, inspectionItemId, 'processing', logger);

  // ── Step 1b: Look up inspection context (type, site_id) ──
  const context = await getInspectionContext(sql, msg.orgId, inspectionItemId, logger);

  // ── Step 2: Fetch audio from R2 ──
  logger.info('Fetching audio from R2', { r2Key });
  const audioObject = await env.INSPECTVOICE_BUCKET.get(r2Key);

  if (!audioObject) {
    throw new Error(`Audio file not found in R2: ${r2Key}`);
  }

  const audioData = await audioObject.arrayBuffer();
  logger.info('Audio fetched', { sizeBytes: audioData.byteLength });

  // ── Step 3: Speechmatics transcription ──
  const transcription = await transcribeAudio(
    audioData,
    mimeType,
    env.SPEECHMATICS_API_KEY,
    msg.requestId,
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

  // ── Step 6: Create defect records (batch insert) ──
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
    overallCondition: analysisResult.overallCondition,
    riskRating: analysisResult.riskRating,
    defectCount: analysisResult.defects.length,
    closureRecommended: analysisResult.closureRecommended,
    tokenUsage: analysisResult.tokenUsage,
  });
}

// =============================================
// DATABASE OPERATIONS
// =============================================

interface InspectionContext {
  readonly inspectionId: string;
  readonly inspectionType: InspectionType;
  readonly siteId: string;
}

/**
 * Look up inspection type and site_id from the parent inspection record.
 * Both are needed for defect records (site_id for filtering) and AI analysis (type for depth).
 */
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
      logger.error('Could not resolve inspection context', null, {
        inspectionItemId,
        foundInspectionId: inspectionId,
        foundSiteId: siteId,
      });
      throw new Error(`Cannot resolve parent inspection for item ${inspectionItemId}`);
    }

    const inspectionType: InspectionType =
      type === 'routine_visual' || type === 'operational' || type === 'annual_main'
        ? type
        : 'routine_visual';

    if (type && type !== inspectionType) {
      logger.warn('Unknown inspection type, defaulting to routine_visual', {
        inspectionItemId,
        foundType: type,
      });
    }

    return { inspectionId, inspectionType, siteId };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot resolve')) throw error;
    logger.warn('Failed to look up inspection context', {
      inspectionItemId,
    });
    // This is a bad state — we don't have siteId. Throw rather than silently corrupt data.
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
  transcription: Awaited<ReturnType<typeof transcribeAudio>>,
  logger: Logger,
): Promise<void> {
  try {
    await sql(
      `UPDATE inspection_items SET
        voice_transcript = $1,
        transcription_method = 'speechmatics',
        ai_processing_status = 'completed',
        ai_processed_at = NOW(),
        ai_model_version = $2
       WHERE id = $3
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $4)`,
      [
        transcription.transcript,
        `speechmatics:${transcription.model}`,
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
  transcription: Awaited<ReturnType<typeof transcribeAudio>>,
  analysis: AIAnalysisResult,
  logger: Logger,
): Promise<void> {
  try {
    const modelVersion = `speechmatics:${transcription.model}|claude:claude-sonnet-4-20250514`;

    await sql(
      `UPDATE inspection_items SET
        voice_transcript = $1,
        transcription_method = 'speechmatics',
        ai_analysis = $2,
        ai_model_version = $3,
        ai_processing_status = 'completed',
        ai_processed_at = NOW(),
        overall_condition = $4,
        risk_rating = $5,
        requires_action = $6,
        action_timeframe = $7,
        defects = $8
       WHERE id = $9
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $10)`,
      [
        transcription.transcript,
        JSON.stringify(analysis),
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

/**
 * Create defect records in a single batch INSERT.
 * Includes org_id, site_id, inspection_id, and asset_id so defect queries
 * can filter efficiently without joining through inspection_items → inspections.
 */
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

    // Build VALUES clause and params for batch INSERT
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
        defectId,                         // id
        orgId,                            // org_id
        siteId,                           // site_id
        inspectionId,                     // inspection_id
        assetId,                          // asset_id
        inspectionItemId,                 // inspection_item_id
        defect.description,               // description
        defect.severity,                  // severity
        defect.defectCategory,            // defect_category
        defect.bsEnReference,             // bs_en_reference
        defect.actionRequired,            // action_required
        defect.actionTimeframe,           // action_timeframe
        defect.estimatedRepairCost,       // estimated_cost_gbp
        now,                              // created_at, updated_at
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
    // Non-fatal: AI analysis is already stored on the inspection item.
    // Defects can be recreated from the stored ai_analysis JSON if needed.
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
    // Non-critical — counts can be recalculated
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
