/**
 * InspectVoice — PDF Generation Queue Consumer
 * Cloudflare Queue consumer that generates inspection report PDFs.
 *
 * Pipeline:
 *   1. Receive message from PDF_GENERATION_QUEUE
 *   2. Fetch inspection + site + org + inspector + items + defects from DB
 *   3. Assemble PdfReportData
 *   4. Generate PDF using pdf-lib
 *   5. Upload PDF to R2
 *   6. Update inspection record with pdf_url and pdf_generated_at
 *
 * Error handling:
 *   - Transient failures → message retried by Cloudflare (up to 3x)
 *   - Permanent failures → logged, inspection pdf_url left null
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
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

/**
 * Process a batch of PDF generation messages.
 * Registered in index.ts as the queue handler for PDF_GENERATION_QUEUE.
 */
export async function handlePdfQueue(
  batch: MessageBatch<QueueMessageBody>,
  env: Env,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  for (const message of batch.messages) {
    const msg = message.body;

    if (msg.type !== 'pdf_generation') {
      message.ack();
      continue;
    }

    const logger = Logger.minimal(msg.requestId);
    const payload = msg.payload as unknown as PdfGenerationPayload;

    try {
      await processPdfMessage(msg, payload, env, sql, logger);
      message.ack();
    } catch (error) {
      logger.error('PDF generation failed', error, {
        inspectionId: payload.inspectionId,
        attempt: message.attempts,
      });

      if (message.attempts >= 3) {
        // Exhausted retries — ack to stop redelivery
        logger.error('PDF generation permanently failed after retries', error, {
          inspectionId: payload.inspectionId,
        });
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
  sql: NeonQueryFunction<false, false>,
  logger: Logger,
): Promise<void> {
  const { inspectionId } = payload;

  logger.info('Starting PDF generation', { inspectionId });

  // ── Step 1: Fetch all report data ──
  const reportData = await assembleReportData(sql, msg.orgId, inspectionId, logger);

  // ── Step 2: Generate PDF ──
  const pdfBytes = await generateInspectionPdf(reportData, msg.requestId);

  // ── Step 3: Upload to R2 ──
  const date = reportData.inspection.inspectionDate.slice(0, 10);
  const ref = inspectionId.slice(0, 8).toUpperCase();
  const siteName = reportData.site.name
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const r2Key = `reports/${msg.orgId}/${date}-${siteName}-IV-${ref}.pdf`;

  await env.INSPECTVOICE_BUCKET.put(r2Key, pdfBytes, {
    httpMetadata: {
      contentType: 'application/pdf',
    },
    customMetadata: {
      inspectionId,
      orgId: msg.orgId,
      generatedAt: new Date().toISOString(),
    },
  });

  logger.info('PDF uploaded to R2', {
    r2Key,
    sizeBytes: pdfBytes.length,
  });

  // ── Step 4: Update inspection record ──
  const pdfUrl = `/api/v1/files/${encodeURIComponent(r2Key)}`;

  await sql(
    `UPDATE inspections SET
      pdf_url = $1,
      pdf_generated_at = NOW(),
      updated_at = NOW()
     WHERE id = $2 AND org_id = $3`,
    [pdfUrl, inspectionId, msg.orgId],
  );

  logger.info('PDF generation complete', {
    inspectionId,
    r2Key,
    pages: 'N/A', // pdf-lib doesn't expose page count after save
    sizeBytes: pdfBytes.length,
  });
}

// =============================================
// DATA ASSEMBLY
// =============================================

/**
 * Fetch all data needed to render the inspection report PDF.
 * Single function assembles the full PdfReportData from multiple tables.
 */
async function assembleReportData(
  sql: NeonQueryFunction<false, false>,
  orgId: string,
  inspectionId: string,
  logger: Logger,
): Promise<PdfReportData> {
  // ── Inspection + Site + Org + Inspector (single query) ──
  const contextRows = await sql(
    `SELECT
      -- Inspection
      i.id AS inspection_id,
      i.inspection_type,
      i.inspection_date,
      i.started_at,
      i.completed_at,
      i.duration_minutes,
      i.weather_conditions,
      i.temperature_c,
      i.surface_conditions,
      i.overall_risk_rating,
      i.very_high_risk_count,
      i.high_risk_count,
      i.medium_risk_count,
      i.low_risk_count,
      i.total_defects,
      i.closure_recommended,
      i.inspector_summary,
      i.signed_by,
      i.signed_at,
      i.status,

      -- Site
      s.name AS site_name,
      s.address AS site_address,
      s.postcode AS site_postcode,
      s.site_type,
      s.contact_name AS site_contact_name,
      s.contact_phone AS site_contact_phone,

      -- Organisation
      o.name AS org_name,
      o.company_name,
      o.company_address,
      o.company_phone,
      o.company_email,
      o.accreditation_body,
      o.accreditation_number,
      o.report_footer_text,

      -- Inspector
      u.display_name AS inspector_name,
      u.rpii_number,
      u.rpii_grade,
      u.other_qualifications,
      u.insurance_provider,
      u.insurance_policy_number

    FROM inspections i
    INNER JOIN sites s ON s.id = i.site_id
    INNER JOIN organisations o ON o.org_id = i.org_id
    INNER JOIN users u ON u.id = i.inspector_id
    WHERE i.id = $1 AND i.org_id = $2
    LIMIT 1`,
    [inspectionId, orgId],
  );

  const ctx = contextRows[0] as Record<string, unknown> | undefined;
  if (!ctx) {
    throw new Error(`Inspection ${inspectionId} not found for org ${orgId}`);
  }

  // ── Inspection items ──
  const itemRows = await sql(
    `SELECT
      ii.id AS item_id,
      ii.asset_code,
      ii.asset_type,
      ii.overall_condition,
      ii.risk_rating,
      ii.requires_action,
      ii.action_timeframe,
      ii.inspector_notes,
      ii.voice_transcript,
      ii.ai_analysis,
      (SELECT COUNT(*) FROM photos p WHERE p.inspection_item_id = ii.id) AS photo_count
    FROM inspection_items ii
    WHERE ii.inspection_id = $1
    ORDER BY ii.asset_code ASC`,
    [inspectionId],
  );

  // ── Defects (per item) ──
  const defectRows = await sql(
    `SELECT
      d.inspection_item_id,
      d.description,
      d.severity,
      d.defect_category,
      d.bs_en_reference,
      d.action_required,
      d.action_timeframe,
      d.estimated_cost_gbp
    FROM defects d
    INNER JOIN inspection_items ii ON ii.id = d.inspection_item_id
    WHERE ii.inspection_id = $1
    ORDER BY
      CASE d.severity
        WHEN 'very_high' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END ASC`,
    [inspectionId],
  );

  // Group defects by inspection_item_id
  const defectsByItem = new Map<string, PdfDefect[]>();
  for (const row of defectRows as Record<string, unknown>[]) {
    const itemId = row['inspection_item_id'] as string;
    if (!defectsByItem.has(itemId)) {
      defectsByItem.set(itemId, []);
    }
    defectsByItem.get(itemId)?.push({
      description: (row['description'] as string) ?? '',
      severity: (row['severity'] as string) ?? 'medium',
      defectCategory: (row['defect_category'] as string) ?? 'General',
      bsEnReference: (row['bs_en_reference'] as string) ?? null,
      actionRequired: (row['action_required'] as string) ?? 'Inspect and assess',
      actionTimeframe: (row['action_timeframe'] as string) ?? 'next_inspection',
      estimatedCostGbp: (row['estimated_cost_gbp'] as string) ?? null,
    });
  }

  // Assemble items
  const items: PdfInspectionItem[] = (itemRows as Record<string, unknown>[]).map((row) => {
    const itemId = row['item_id'] as string;
    const aiAnalysis = row['ai_analysis'] as Record<string, unknown> | null;

    return {
      assetCode: (row['asset_code'] as string) ?? '',
      assetType: (row['asset_type'] as string) ?? '',
      overallCondition: (row['overall_condition'] as string) ?? null,
      riskRating: (row['risk_rating'] as string) ?? null,
      requiresAction: (row['requires_action'] as boolean) ?? false,
      actionTimeframe: (row['action_timeframe'] as string) ?? null,
      inspectorNotes: (row['inspector_notes'] as string) ?? null,
      voiceTranscript: (row['voice_transcript'] as string) ?? null,
      aiSummary: aiAnalysis?.['summary'] as string ?? null,
      recommendations: Array.isArray(aiAnalysis?.['recommendations'])
        ? (aiAnalysis['recommendations'] as unknown[]).filter((r): r is string => typeof r === 'string')
        : [],
      complianceNotes: Array.isArray(aiAnalysis?.['complianceNotes'])
        ? (aiAnalysis['complianceNotes'] as unknown[]).filter((n): n is string => typeof n === 'string')
        : [],
      photoCount: Number(row['photo_count'] ?? 0),
      defects: defectsByItem.get(itemId) ?? [],
    };
  });

  // Assemble full report data
  const reportData: PdfReportData = {
    org: {
      companyName: (ctx['company_name'] as string) ?? (ctx['org_name'] as string) ?? orgId,
      companyAddress: (ctx['company_address'] as string) ?? null,
      companyPhone: (ctx['company_phone'] as string) ?? null,
      companyEmail: (ctx['company_email'] as string) ?? null,
      accreditationBody: (ctx['accreditation_body'] as string) ?? null,
      accreditationNumber: (ctx['accreditation_number'] as string) ?? null,
      reportFooterText: (ctx['report_footer_text'] as string) ?? null,
    },
    site: {
      name: (ctx['site_name'] as string) ?? 'Unknown Site',
      address: (ctx['site_address'] as string) ?? '',
      postcode: (ctx['site_postcode'] as string) ?? null,
      siteType: (ctx['site_type'] as string) ?? 'playground',
      contactName: (ctx['site_contact_name'] as string) ?? null,
      contactPhone: (ctx['site_contact_phone'] as string) ?? null,
    },
    inspection: {
      id: inspectionId,
      inspectionType: (ctx['inspection_type'] as string) ?? 'routine_visual',
      inspectionDate: (ctx['inspection_date'] as string) ?? new Date().toISOString(),
      startedAt: (ctx['started_at'] as string) ?? new Date().toISOString(),
      completedAt: (ctx['completed_at'] as string) ?? null,
      durationMinutes: (ctx['duration_minutes'] as number) ?? null,
      weatherConditions: (ctx['weather_conditions'] as string) ?? null,
      temperatureC: (ctx['temperature_c'] as number) ?? null,
      surfaceConditions: (ctx['surface_conditions'] as string) ?? null,
      overallRiskRating: (ctx['overall_risk_rating'] as string) ?? null,
      veryHighRiskCount: (ctx['very_high_risk_count'] as number) ?? 0,
      highRiskCount: (ctx['high_risk_count'] as number) ?? 0,
      mediumRiskCount: (ctx['medium_risk_count'] as number) ?? 0,
      lowRiskCount: (ctx['low_risk_count'] as number) ?? 0,
      totalDefects: (ctx['total_defects'] as number) ?? 0,
      closureRecommended: (ctx['closure_recommended'] as boolean) ?? false,
      inspectorSummary: (ctx['inspector_summary'] as string) ?? null,
      signedBy: (ctx['signed_by'] as string) ?? null,
      signedAt: (ctx['signed_at'] as string) ?? null,
    },
    inspector: {
      displayName: (ctx['inspector_name'] as string) ?? 'Unknown Inspector',
      rpiiNumber: (ctx['rpii_number'] as string) ?? null,
      rpiiGrade: (ctx['rpii_grade'] as string) ?? null,
      qualifications: (ctx['other_qualifications'] as string) ?? null,
      insuranceProvider: (ctx['insurance_provider'] as string) ?? null,
      insurancePolicyNumber: (ctx['insurance_policy_number'] as string) ?? null,
    },
    items,
  };

  logger.info('Report data assembled', {
    inspectionId,
    itemCount: items.length,
    totalDefects: reportData.inspection.totalDefects,
    hasSignature: !!reportData.inspection.signedBy,
  });

  return reportData;
}
