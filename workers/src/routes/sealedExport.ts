/**
 * Feature 10: Sealed Export Route Handlers
 * workers/src/routes/sealedExport.ts
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams, SealedExportRow, BundleFile } from '../types';
import { createDb } from '../services/db';
import { checkRateLimit } from '../middleware/rateLimit';
import { sealAndStore } from '../services/sealedExport';
import { generateDefectExcelBytes, type DefectExportData, type ExportDefect, type SiteSummary } from '../services/excelGenerator';
import { generateInspectionPdf, type PdfReportData } from '../services/pdf';
import { jsonResponse } from './helpers';
import { NotFoundError } from '../shared/errors';
import { validateUUID } from '../shared/validation';
import { parseFilterParam } from '../shared/pagination';

// =============================================
// POST /api/v1/sealed-exports/defects
// =============================================

export async function createSealedDefectExport(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'export');
  const db = createDb(ctx);

  // ── Reuse existing export query from defectsExport.ts ──
  const url = new URL(request.url);
  const statusFilter = parseFilterParam(request, 'status');
  const severityFilter = parseFilterParam(request, 'severity');
  const siteFilter = parseFilterParam(request, 'site_id');
  const fromDate = url.searchParams.get('from_date');
  const toDate = url.searchParams.get('to_date');

  const conditions: string[] = ['i.org_id = $1'];
  const params: unknown[] = [ctx.orgId];
  let paramIndex = 2;

  if (statusFilter) { conditions.push(`d.status = $${paramIndex}`); params.push(statusFilter); paramIndex++; }
  if (severityFilter) { conditions.push(`d.severity = $${paramIndex}`); params.push(severityFilter); paramIndex++; }
  if (siteFilter) { conditions.push(`i.site_id = $${paramIndex}`); params.push(siteFilter); paramIndex++; }
  if (fromDate) { conditions.push(`i.inspection_date >= $${paramIndex}`); params.push(fromDate); paramIndex++; }
  if (toDate) { conditions.push(`i.inspection_date <= $${paramIndex}`); params.push(toDate); paramIndex++; }

  const whereClause = conditions.join(' AND ');

  const defects = await db.rawQuery<ExportDefect>(
    `SELECT
      d.id, d.description, d.remedial_action, d.bs_en_reference,
      d.severity, d.status, d.action_timeframe, d.due_date,
      d.estimated_cost_gbp, d.actual_cost_gbp, d.created_at, d.updated_at,
      d.resolved_at, d.resolution_notes, d.deferral_reason, d.notes,
      i.site_id, s.name AS site_name, s.address AS site_address,
      s.local_authority AS site_local_authority, ii.asset_code, ii.asset_type,
      ii.zone AS asset_zone, i.id AS inspection_id, i.inspection_type,
      i.inspection_date,
      COALESCE(u_insp.first_name || ' ' || u_insp.last_name, 'Unknown') AS inspector_name,
      COALESCE(u_assign.first_name || ' ' || u_assign.last_name, NULL) AS assigned_to_name,
      COALESCE(d.photo_count, 0)::int AS photo_count, d.photo_r2_keys
    FROM defects d
    INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
    INNER JOIN inspections i ON ii.inspection_id = i.id
    INNER JOIN sites s ON i.site_id = s.id
    LEFT JOIN users u_insp ON i.inspector_id = u_insp.id
    LEFT JOIN users u_assign ON d.assigned_to = u_assign.id
    WHERE ${whereClause}
    ORDER BY
      CASE d.severity WHEN 'very_high' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC,
      d.created_at DESC`,
    params,
  );

  const siteSummaries = await db.rawQuery<SiteSummary>(
    `SELECT s.id AS site_id, s.name AS site_name, s.address AS site_address,
      COUNT(DISTINCT a.id)::int AS total_assets, COUNT(d.id)::int AS total_defects,
      COUNT(d.id) FILTER (WHERE d.status NOT IN ('resolved','verified'))::int AS open_defects,
      COUNT(d.id) FILTER (WHERE d.severity = 'very_high')::int AS very_high_count,
      COUNT(d.id) FILTER (WHERE d.severity = 'high')::int AS high_count,
      COUNT(d.id) FILTER (WHERE d.severity = 'medium')::int AS medium_count,
      COUNT(d.id) FILTER (WHERE d.severity = 'low')::int AS low_count
    FROM sites s
    LEFT JOIN assets a ON a.site_id = s.id
    LEFT JOIN inspections i ON i.site_id = s.id AND i.org_id = $1
    LEFT JOIN inspection_items ii ON ii.inspection_id = i.id
    LEFT JOIN defects d ON d.inspection_item_id = ii.id
    WHERE s.org_id = $1
    GROUP BY s.id, s.name, s.address ORDER BY s.name ASC`,
    [ctx.orgId],
  );

  const exportData: DefectExportData = {
    defects,
    site_summaries: siteSummaries,
    export_meta: {
      org_id: ctx.orgId,
      exported_at: new Date().toISOString(),
      total_defects: defects.length,
      total_sites: siteSummaries.length,
      filters: {
        status: statusFilter ?? null,
        severity: severityFilter ?? null,
        site_id: siteFilter ?? null,
        from_date: fromDate ?? null,
        to_date: toDate ?? null,
      },
    },
  };

  // Generate Excel bytes server-side
  const excelBytes = generateDefectExcelBytes(exportData);

  const files: BundleFile[] = [{
    path: 'defect-export.xlsx',
    data: excelBytes,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }];

  // Get display name for manifest
  const userRows = await db.rawQuery<{ display_name: string }>(
    `SELECT COALESCE(first_name || ' ' || last_name, email, 'Unknown') AS display_name
     FROM users WHERE id = $1 LIMIT 1`,
    [ctx.userId],
  );
  const displayName = userRows[0]?.display_name ?? 'Unknown';

  const record = await sealAndStore({
    ctx, exportType: 'defect_export', sourceId: null, displayName, files,
  });

  return sealedBundleResponse(ctx, record);
}

// =============================================
// POST /api/v1/sealed-exports/inspections/:id/pdf
// =============================================

export async function createSealedPdfExport(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'export');
  const inspectionId = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  // Gather all data needed by generateInspectionPdf — same as triggerPdfGeneration
  const reportData = await loadPdfReportData(db, ctx.orgId, inspectionId);

  const pdfBytes = await generateInspectionPdf(reportData, ctx.requestId);

  const files: BundleFile[] = [{
    path: 'inspection-report.pdf',
    data: pdfBytes,
    contentType: 'application/pdf',
  }];

  const displayName = reportData.inspector.displayName;

  const record = await sealAndStore({
    ctx, exportType: 'pdf_report', sourceId: inspectionId, displayName, files,
  });

  return sealedBundleResponse(ctx, record);
}

// =============================================
// POST /api/v1/sealed-exports/incidents/:id/claims-pack
// =============================================

export async function createSealedClaimsPack(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'export');
  const incidentId = validateUUID(params['id'], 'id');

  // Import and call the existing claims pack handler to get JSON data
  // We re-call the handler and extract the JSON body
  const { getClaimsPack } = await import('./claimsPack');
  const claimsResponse = await getClaimsPack(request, params, ctx);
  const claimsResult = await claimsResponse.json() as { success: boolean; data: Record<string, unknown> };

  if (!claimsResult.success) {
    throw new NotFoundError('Failed to generate claims pack data');
  }

  const claimsJson = JSON.stringify(claimsResult.data, null, 2);
  const claimsBytes = new TextEncoder().encode(claimsJson);

  // Extract compliance summary
  const complianceSummary = (claimsResult.data as Record<string, unknown>).compliance_summary ?? {};
  const complianceJson = JSON.stringify(complianceSummary, null, 2);
  const complianceBytes = new TextEncoder().encode(complianceJson);

  const files: BundleFile[] = [
    { path: 'claims-pack/claims-pack.json', data: claimsBytes, contentType: 'application/json' },
    { path: 'claims-pack/compliance-summary.json', data: complianceBytes, contentType: 'application/json' },
  ];

  const db = createDb(ctx);
  const userRows = await db.rawQuery<{ display_name: string }>(
    `SELECT COALESCE(first_name || ' ' || last_name, email, 'Unknown') AS display_name
     FROM users WHERE id = $1 LIMIT 1`,
    [ctx.userId],
  );
  const displayName = userRows[0]?.display_name ?? 'Unknown';

  const record = await sealAndStore({
    ctx, exportType: 'claims_pack', sourceId: incidentId, displayName, files,
  });

  return sealedBundleResponse(ctx, record);
}

// =============================================
// GET /api/v1/sealed-exports/:bundleId/download
// =============================================

export async function downloadSealedExport(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const bundleId = validateUUID(params['bundleId'], 'bundleId');
  const db = createDb(ctx);

  const rows = await db.rawQuery<{ r2_key: string; bundle_id: string }>(
    `SELECT r2_key, bundle_id FROM sealed_exports WHERE bundle_id = $1`,
    [bundleId],
  );

  if (!rows[0]) throw new NotFoundError('Sealed bundle not found');

  const r2Object = await ctx.env.INSPECTVOICE_BUCKET.get(rows[0].r2_key);
  if (!r2Object) throw new NotFoundError('Bundle file not found in storage');

  return new Response(r2Object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="InspectVoice_Bundle_${rows[0].bundle_id}.zip"`,
    },
  });
}

// =============================================
// GET /api/v1/sealed-exports
// =============================================

export async function listSealedExports(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const db = createDb(ctx);
  const url = new URL(request.url);
  const exportType = url.searchParams.get('export_type');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (exportType) {
    conditions.push(`export_type = $${idx}`);
    params.push(exportType);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  params.push(offset);

  const rows = await db.rawQuery<SealedExportRow>(
    `SELECT * FROM sealed_exports ${where}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params,
  );

  return jsonResponse({ success: true, data: rows }, ctx.requestId);
}

// =============================================
// HELPERS
// =============================================

/** Return sealed zip as a download response */
async function sealedBundleResponse(ctx: RequestContext, record: SealedExportRow): Promise<Response> {
  const r2Object = await ctx.env.INSPECTVOICE_BUCKET.get(record.r2_key);
  if (!r2Object) throw new NotFoundError('Failed to retrieve sealed bundle from storage');

  return new Response(r2Object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="InspectVoice_Bundle_${record.bundle_id}.zip"`,
      'X-Bundle-Id': record.bundle_id,
      'X-Manifest-SHA256': record.manifest_sha256,
    },
  });
}

/**
 * Load all data needed by generateInspectionPdf.
 * This mirrors the data gathering in your PDF generation queue/route.
 * Adjust queries if your schema differs.
 */
async function loadPdfReportData(
  db: ReturnType<typeof createDb>,
  orgId: string,
  inspectionId: string,
): Promise<PdfReportData> {
  // This is the data-loading layer for PDF reports.
  // Your existing triggerPdfGeneration route likely already loads this data
  // before calling generateInspectionPdf(). If you have a shared loader,
  // import and call it here. Otherwise, this query set matches PdfReportData:

  const inspRows = await db.rawQuery<Record<string, unknown>>(
    `SELECT i.*, s.name AS site_name, s.address AS site_address,
            s.postcode AS site_postcode, s.site_type,
            s.contact_name AS site_contact_name, s.contact_phone AS site_contact_phone,
            u.first_name || ' ' || u.last_name AS inspector_name,
            u.rpii_number, u.rpii_grade, u.qualifications,
            u.insurance_provider, u.insurance_policy_number,
            o.company_name, o.company_address, o.company_phone, o.company_email,
            o.accreditation_body, o.accreditation_number, o.report_footer_text
     FROM inspections i
     INNER JOIN sites s ON i.site_id = s.id
     INNER JOIN users u ON i.inspector_id = u.id
     INNER JOIN organisations o ON i.org_id = o.id
     WHERE i.org_id = $1 AND i.id = $2 LIMIT 1`,
    [orgId, inspectionId],
  );

  if (!inspRows[0]) throw new NotFoundError('Inspection not found');
  const row = inspRows[0];

  // Load inspection items with defects and photos
  const items = await db.rawQuery<Record<string, unknown>>(
    `SELECT ii.*, a.asset_code, a.asset_type
     FROM inspection_items ii
     LEFT JOIN assets a ON ii.asset_id = a.id
     WHERE ii.inspection_id = $1
     ORDER BY ii.created_at ASC`,
    [inspectionId],
  );

  const defects = await db.rawQuery<Record<string, unknown>>(
    `SELECT d.*, ii.id AS inspection_item_id
     FROM defects d
     INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
     WHERE ii.inspection_id = $1
     ORDER BY d.created_at ASC`,
    [inspectionId],
  );

  const photos = await db.rawQuery<Record<string, unknown>>(
    `SELECT p.*, ii.id AS inspection_item_id
     FROM inspection_photos p
     INNER JOIN inspection_items ii ON p.inspection_item_id = ii.id
     WHERE ii.inspection_id = $1
     ORDER BY p.photo_number ASC`,
    [inspectionId],
  );

  // Build PdfReportData shape — map raw rows to the interface
  // This mapping depends on your exact column names. Adjust as needed.
  const pdfData: PdfReportData = {
    org: {
      companyName: String(row.company_name ?? ''),
      companyAddress: row.company_address as string | null,
      companyPhone: row.company_phone as string | null,
      companyEmail: row.company_email as string | null,
      accreditationBody: row.accreditation_body as string | null,
      accreditationNumber: row.accreditation_number as string | null,
      reportFooterText: row.report_footer_text as string | null,
    },
    site: {
      name: String(row.site_name ?? ''),
      address: String(row.site_address ?? ''),
      postcode: row.site_postcode as string | null,
      siteType: String(row.site_type ?? ''),
      contactName: row.site_contact_name as string | null,
      contactPhone: row.site_contact_phone as string | null,
    },
    inspection: {
      id: inspectionId,
      inspectionType: String(row.inspection_type ?? ''),
      inspectionDate: String(row.inspection_date ?? ''),
      startedAt: String(row.started_at ?? ''),
      completedAt: row.completed_at as string | null,
      durationMinutes: row.duration_minutes as number | null,
      weatherConditions: row.weather_conditions as string | null,
      temperatureC: row.temperature_c as number | null,
      surfaceConditions: row.surface_conditions as string | null,
      overallRiskRating: row.overall_risk_rating as string | null,
      veryHighRiskCount: Number(row.very_high_risk_count ?? 0),
      highRiskCount: Number(row.high_risk_count ?? 0),
      mediumRiskCount: Number(row.medium_risk_count ?? 0),
      lowRiskCount: Number(row.low_risk_count ?? 0),
      totalDefects: Number(row.total_defects ?? 0),
      closureRecommended: Boolean(row.closure_recommended),
      inspectorSummary: row.inspector_summary as string | null,
      signedBy: row.signed_by as string | null,
      signedAt: row.signed_at as string | null,
    },
    inspector: {
      displayName: String(row.inspector_name ?? 'Unknown'),
      rpiiNumber: row.rpii_number as string | null,
      rpiiGrade: row.rpii_grade as string | null,
      qualifications: row.qualifications as string | null,
      insuranceProvider: row.insurance_provider as string | null,
      insurancePolicyNumber: row.insurance_policy_number as string | null,
    },
    items: items.map((item) => {
      const itemDefects = defects.filter((d) => d.inspection_item_id === item.id);
      const itemPhotos = photos.filter((p) => p.inspection_item_id === item.id);

      return {
        assetCode: String(item.asset_code ?? ''),
        assetType: String(item.asset_type ?? ''),
        overallCondition: item.overall_condition as string | null,
        riskRating: item.risk_rating as string | null,
        requiresAction: Boolean(item.requires_action),
        actionTimeframe: item.action_timeframe as string | null,
        inspectorNotes: item.inspector_notes as string | null,
        voiceTranscript: item.voice_transcript as string | null,
        aiSummary: item.ai_summary as string | null,
        recommendations: ((item.recommendations as string[]) ?? []),
        complianceNotes: ((item.compliance_notes as string[]) ?? []),
        photoCount: itemPhotos.length,
        defects: itemDefects.map((d) => ({
          description: String(d.description ?? ''),
          severity: String(d.severity ?? ''),
          defectCategory: String(d.defect_category ?? ''),
          bsEnReference: d.bs_en_reference as string | null,
          actionRequired: String(d.remedial_action ?? ''),
          actionTimeframe: String(d.action_timeframe ?? ''),
          estimatedCostGbp: d.estimated_cost_gbp as string | null,
        })),
        photos: itemPhotos.map((p) => ({
          photoNumber: Number(p.photo_number ?? 0),
          photoType: String(p.photo_type ?? ''),
          caption: p.caption as string | null,
          associatedDefectDescriptions: (p.associated_defect_descriptions as string[]) ?? [],
        })),
      };
    }),
    photoIndex: photos.map((p, i) => {
      const parentItem = items.find((item) => item.id === p.inspection_item_id);
      return {
        number: Number(p.photo_number ?? i + 1),
        assetCode: String(parentItem?.asset_code ?? ''),
        photoType: String(p.photo_type ?? ''),
        caption: p.caption as string | null,
        associatedDefects: (p.associated_defect_descriptions as string[]) ?? [],
        pdfLabel: `P${Number(p.photo_number ?? i + 1)}`,
      };
    }),
  };

  return pdfData;
}
