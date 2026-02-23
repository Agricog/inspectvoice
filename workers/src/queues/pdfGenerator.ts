/**
 * InspectVoice — PDF Generation Queue Consumer
 * Cloudflare Queue consumer that generates inspection report PDFs.
 *
 * Pipeline:
 *   1. Receive message from PDF_GENERATION_QUEUE
 *   2. Fetch all report data from DB (org, site, inspection, items, defects, inspector)
 *   3. Generate PDF using pdf-lib
 *   4. Store PDF in R2
 *   5. Update inspection record with pdf_url and pdf_generated_at
 *
 * Triggered by POST /api/v1/inspections/:id/pdf
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env, QueueMessageBody } from '../types';
import { generateInspectionPdf, type PdfReportData, type PdfInspectionItem, type PdfDefect } from '../services/pdf';
import { Logger } from '../shared/logger';

// =============================================
// PAYLOAD TYPE
// =============================================

interface PdfGenerationPayload {
  readonly inspectionId: string;
}

// =============================================
// QUEUE CONSUMER ENTRY POINT
// =============================================

export async function handlePdfQueue(
  batch: MessageBatch<QueueMessageBody>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const msg = message.body;

    if (msg.type !== 'pdf_generation') {
      message.ack();
      continue;
    }

    const logger = Logger.minimal(msg.requestId);
    const payload = msg.payload as unknown as PdfGenerationPayload;

    try {
      await processPdfMessage(msg, payload, env, logger);
      message.ack();
    } catch (error) {
      logger.error('PDF generation failed', error, {
        inspectionId: payload.inspectionId,
        attempt: message.attempts,
      });

      if (message.attempts >= 3) {
        // Mark as failed — update inspection so frontend knows
        await markPdfFailed(env, msg.orgId, payload.inspectionId, logger);
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

async function processPdfMessage(
  msg: QueueMessageBody,
  payload: PdfGenerationPayload,
  env: Env,
  logger: Logger,
): Promise<void> {
  const { inspectionId } = payload;

  logger.info('Starting PDF generation', { inspectionId });

  // ── Step 1: Fetch all report data ──
  const reportData = await fetchReportData(env, msg.orgId, msg.userId, inspectionId, logger);

  // ── Step 2: Generate PDF ──
  const pdfBytes = await generateInspectionPdf(reportData, msg.requestId);

  // ── Step 3: Store in R2 ──
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const r2Key = `${msg.orgId}/reports/${inspectionId}/${timestamp}.pdf`;

  await env.INSPECTVOICE_BUCKET.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: {
      inspectionId,
      orgId: msg.orgId,
      generatedAt: new Date().toISOString(),
    },
  });

  logger.info('PDF stored in R2', { r2Key, sizeBytes: pdfBytes.length });

  // ── Step 4: Update inspection record ──
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(env.DATABASE_URL);

  const pdfUrl = `/api/v1/files/${encodeURIComponent(r2Key)}`;

  await sql(
    `UPDATE inspections SET
      pdf_url = $1,
      pdf_generated_at = NOW(),
      updated_at = NOW()
     WHERE id = $2 AND org_id = $3`,
    [pdfUrl, inspectionId, msg.orgId],
  );

  logger.info('PDF generation complete', { inspectionId, pdfUrl });
}

// =============================================
// FETCH ALL REPORT DATA
// =============================================

async function fetchReportData(
  env: Env,
  orgId: string,
  userId: string,
  inspectionId: string,
  logger: Logger,
): Promise<PdfReportData> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(env.DATABASE_URL);

  // Fetch inspection
  const inspectionRows = await sql(
    `SELECT * FROM inspections WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [inspectionId, orgId],
  );
  const inspection = inspectionRows[0] as Record<string, unknown> | undefined;
  if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);

  // Fetch site
  const siteRows = await sql(
    `SELECT * FROM sites WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [inspection['site_id'], orgId],
  );
  const site = siteRows[0] as Record<string, unknown> | undefined;
  if (!site) throw new Error(`Site not found for inspection ${inspectionId}`);

  // Fetch org
  const orgRows = await sql(
    `SELECT * FROM organisations WHERE org_id = $1 LIMIT 1`,
    [orgId],
  );
  const org = (orgRows[0] ?? {}) as Record<string, unknown>;

  // Fetch inspector (the user who created the inspection)
  const inspectorId = (inspection['inspector_id'] as string) ?? userId;
  const inspectorRows = await sql(
    `SELECT * FROM users WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [inspectorId, orgId],
  );
  const inspector = (inspectorRows[0] ?? {}) as Record<string, unknown>;

  // Fetch inspection items
  const itemRows = await sql(
    `SELECT ii.* FROM inspection_items ii
     INNER JOIN inspections i ON ii.inspection_id = i.id
     WHERE i.id = $1 AND i.org_id = $2
     ORDER BY ii.timestamp ASC`,
    [inspectionId, orgId],
  );

  // Fetch all defects for this inspection
  const defectRows = await sql(
    `SELECT d.*, ii.id AS item_id FROM defects d
     INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
     INNER JOIN inspections i ON ii.inspection_id = i.id
     WHERE i.id = $1 AND i.org_id = $2
     ORDER BY d.severity ASC, d.created_at ASC`,
    [inspectionId, orgId],
  );

  // Group defects by inspection item
  const defectsByItem = new Map<string, PdfDefect[]>();
  for (const row of defectRows as Record<string, unknown>[]) {
    const itemId = row['item_id'] as string;
    if (!defectsByItem.has(itemId)) defectsByItem.set(itemId, []);
    defectsByItem.get(itemId)?.push({
      description: (row['description'] as string) ?? '',
      severity: (row['severity'] as string) ?? 'medium',
      defectCategory: (row['defect_category'] as string) ?? 'General',
      bsEnReference: (row['bs_en_reference'] as string) ?? null,
      actionRequired: (row['action_required'] as string) ?? 'Assess',
      actionTimeframe: (row['action_timeframe'] as string) ?? 'next_inspection',
      estimatedCostGbp: (row['estimated_cost_gbp'] as string) ?? null,
    });
  }

  // Build items with their defects
  const items: PdfInspectionItem[] = (itemRows as Record<string, unknown>[]).map((row) => {
    // Extract AI summary from ai_analysis JSON
    let aiSummary: string | null = null;
    if (row['ai_analysis']) {
      try {
        const analysis = typeof row['ai_analysis'] === 'string'
          ? JSON.parse(row['ai_analysis'])
          : row['ai_analysis'];
        aiSummary = analysis?.summary ?? null;
      } catch {
        // Ignore parse errors
      }
    }

    return {
      assetCode: (row['asset_code'] as string) ?? '',
      assetType: (row['asset_type'] as string) ?? '',
      overallCondition: (row['overall_condition'] as string) ?? null,
      riskRating: (row['risk_rating'] as string) ?? null,
      requiresAction: (row['requires_action'] as boolean) ?? false,
      actionTimeframe: (row['action_timeframe'] as string) ?? null,
      inspectorNotes: (row['inspector_notes'] as string) ?? null,
      voiceTranscript: (row['voice_transcript'] as string) ?? null,
      aiSummary,
      defects: defectsByItem.get(row['id'] as string) ?? [],
    };
  });

  return {
    org: {
      companyName: (org['company_name'] as string) ?? 'Organisation',
      companyAddress: (org['company_address'] as string) ?? null,
      companyPhone: (org['company_phone'] as string) ?? null,
      companyEmail: (org['company_email'] as string) ?? null,
      accreditationBody: (org['accreditation_body'] as string) ?? null,
      accreditationNumber: (org['accreditation_number'] as string) ?? null,
      reportFooterText: (org['report_footer_text'] as string) ?? null,
    },
    site: {
      name: (site['name'] as string) ?? '',
      address: (site['address'] as string) ?? '',
      postcode: (site['postcode'] as string) ?? null,
      siteType: (site['site_type'] as string) ?? '',
      contactName: (site['contact_name'] as string) ?? null,
      contactPhone: (site['contact_phone'] as string) ?? null,
    },
    inspection: {
      id: inspectionId,
      inspectionType: (inspection['inspection_type'] as string) ?? '',
      inspectionDate: (inspection['inspection_date'] as string) ?? '',
      startedAt: (inspection['started_at'] as string) ?? '',
      completedAt: (inspection['completed_at'] as string) ?? null,
      durationMinutes: (inspection['duration_minutes'] as number) ?? null,
      weatherConditions: (inspection['weather_conditions'] as string) ?? null,
      temperatureC: (inspection['temperature_c'] as number) ?? null,
      surfaceConditions: (inspection['surface_conditions'] as string) ?? null,
      overallRiskRating: (inspection['overall_risk_rating'] as string) ?? null,
      veryHighRiskCount: (inspection['very_high_risk_count'] as number) ?? 0,
      highRiskCount: (inspection['high_risk_count'] as number) ?? 0,
      mediumRiskCount: (inspection['medium_risk_count'] as number) ?? 0,
      lowRiskCount: (inspection['low_risk_count'] as number) ?? 0,
      totalDefects: (inspection['total_defects'] as number) ?? 0,
      closureRecommended: (inspection['closure_recommended'] as boolean) ?? false,
      inspectorSummary: (inspection['inspector_summary'] as string) ?? null,
      signedBy: (inspection['signed_by'] as string) ?? null,
      signedAt: (inspection['signed_at'] as string) ?? null,
    },
    inspector: {
      displayName: (inspector['display_name'] as string) ?? 'Inspector',
      rpiiNumber: (inspector['rpii_number'] as string) ?? null,
      rpiiGrade: (inspector['rpii_grade'] as string) ?? null,
      qualifications: (inspector['other_qualifications'] as string) ?? null,
      insuranceProvider: (inspector['insurance_provider'] as string) ?? null,
      insurancePolicyNumber: (inspector['insurance_policy_number'] as string) ?? null,
    },
    items,
  };
}

// =============================================
// FAILURE HANDLER
// =============================================

async function markPdfFailed(
  env: Env,
  orgId: string,
  inspectionId: string,
  logger: Logger,
): Promise<void> {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(env.DATABASE_URL);

    await sql(
      `UPDATE inspections SET
        pdf_url = NULL,
        pdf_generated_at = NULL,
        updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [inspectionId, orgId],
    );
  } catch (error) {
    logger.error('Failed to mark PDF generation as failed', error, { inspectionId });
  }
}
