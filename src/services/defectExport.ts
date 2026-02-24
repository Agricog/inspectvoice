/**
 * InspectVoice — Defect Export Service
 * Generates council-friendly Excel workbooks from defect data.
 *
 * Workbook structure:
 *   1. Summary          — Totals by risk/status, top 20 highest-risk defects
 *   2. All Defects      — Master table (one row per defect, filterable)
 *   3. Site – [Name]    — Per-site sheet with assets + defects
 *
 * Also supports simple CSV export of the master table.
 *
 * Dependencies: xlsx (SheetJS Community Edition)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import * as XLSX from 'xlsx';
import {
  RISK_RATING_LABELS,
  DEFECT_STATUS_LABELS,
  ACTION_TIMEFRAME_LABELS,
  INSPECTION_TYPE_LABELS,
} from '@/types/enums';

// =============================================
// TYPES
// =============================================

export interface ExportDefect {
  id: string;
  description: string;
  remedial_action: string;
  bs_en_reference: string | null;
  severity: string;
  status: string;
  action_timeframe: string;
  due_date: string | null;
  estimated_cost_gbp: number | null;
  actual_cost_gbp: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  deferral_reason: string | null;
  notes: string | null;
  site_id: string;
  site_name: string;
  site_address: string | null;
  site_local_authority: string | null;
  asset_code: string;
  asset_type: string;
  asset_zone: string | null;
  inspection_id: string;
  inspection_type: string;
  inspection_date: string;
  inspector_name: string;
  assigned_to_name: string | null;
  photo_count: number;
  photo_r2_keys: string | null;
}

export interface SiteSummary {
  site_id: string;
  site_name: string;
  site_address: string | null;
  total_assets: number;
  total_defects: number;
  open_defects: number;
  very_high_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

export interface ExportMeta {
  org_id: string;
  exported_at: string;
  total_defects: number;
  total_sites: number;
  filters: {
    status: string | null;
    severity: string | null;
    site_id: string | null;
    from_date: string | null;
    to_date: string | null;
  };
}

export interface DefectExportData {
  defects: ExportDefect[];
  site_summaries: SiteSummary[];
  export_meta: ExportMeta;
}

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function label(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Truncate site names to valid sheet name length (31 chars max in Excel) */
function siteSheetName(siteName: string, index: number): string {
  const prefix = `Site ${index + 1} – `;
  const maxNameLen = 31 - prefix.length;
  const truncated = siteName.length > maxNameLen
    ? siteName.substring(0, maxNameLen - 1) + '…'
    : siteName;
  return `${prefix}${truncated}`;
}

/** Apply column widths to a worksheet */
function setColumnWidths(ws: XLSX.WorkSheet, widths: number[]): void {
  ws['!cols'] = widths.map((w) => ({ wch: w }));
}

// =============================================
// SEVERITY SORT ORDER
// =============================================

const SEVERITY_ORDER: Record<string, number> = {
  very_high: 1,
  high: 2,
  medium: 3,
  low: 4,
};

// =============================================
// SHEET 1: SUMMARY
// =============================================

function buildSummarySheet(
  data: DefectExportData,
): XLSX.WorkSheet {
  const { defects, site_summaries, export_meta } = data;
  const rows: (string | number | null)[][] = [];

  // ── Header ─────────────────────────────────
  rows.push(['InspectVoice — Citywide Defect Summary']);
  rows.push([`Exported: ${formatDate(export_meta.exported_at)}`]);
  rows.push([`Total Sites: ${export_meta.total_sites}`, '', `Total Defects: ${export_meta.total_defects}`]);
  rows.push([]); // spacer

  // ── Risk Distribution ──────────────────────
  rows.push(['RISK DISTRIBUTION']);
  rows.push(['Severity', 'Count', '% of Total']);

  const severityGroups = { very_high: 0, high: 0, medium: 0, low: 0 };
  for (const d of defects) {
    const sev = d.severity as keyof typeof severityGroups;
    if (sev in severityGroups) severityGroups[sev]++;
  }

  const total = defects.length || 1;
  rows.push(['Very High', severityGroups.very_high, `${((severityGroups.very_high / total) * 100).toFixed(1)}%`]);
  rows.push(['High', severityGroups.high, `${((severityGroups.high / total) * 100).toFixed(1)}%`]);
  rows.push(['Medium', severityGroups.medium, `${((severityGroups.medium / total) * 100).toFixed(1)}%`]);
  rows.push(['Low', severityGroups.low, `${((severityGroups.low / total) * 100).toFixed(1)}%`]);
  rows.push([]); // spacer

  // ── Status Distribution ────────────────────
  rows.push(['STATUS DISTRIBUTION']);
  rows.push(['Status', 'Count']);

  const statusGroups: Record<string, number> = {};
  for (const d of defects) {
    statusGroups[d.status] = (statusGroups[d.status] ?? 0) + 1;
  }

  for (const [status, count] of Object.entries(statusGroups).sort((a, b) => b[1] - a[1])) {
    rows.push([label(status, DEFECT_STATUS_LABELS), count]);
  }
  rows.push([]); // spacer

  // ── Site Overview ──────────────────────────
  rows.push(['SITE OVERVIEW']);
  rows.push(['Site Name', 'Address', 'Total Assets', 'Total Defects', 'Open', 'Very High', 'High', 'Medium', 'Low']);

  for (const site of site_summaries) {
    rows.push([
      site.site_name,
      site.site_address ?? '',
      site.total_assets,
      site.total_defects,
      site.open_defects,
      site.very_high_count,
      site.high_count,
      site.medium_count,
      site.low_count,
    ]);
  }
  rows.push([]); // spacer

  // ── Top 20 Highest-Risk Defects ────────────
  rows.push(['TOP 20 HIGHEST-RISK DEFECTS']);
  rows.push(['Site', 'Asset', 'Description', 'Severity', 'Action Required', 'Timescale', 'Due Date', 'Status']);

  const top20 = [...defects]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5))
    .slice(0, 20);

  for (const d of top20) {
    rows.push([
      d.site_name,
      `${d.asset_code} (${d.asset_type})`,
      d.description,
      label(d.severity, RISK_RATING_LABELS),
      d.remedial_action,
      label(d.action_timeframe, ACTION_TIMEFRAME_LABELS),
      formatDate(d.due_date),
      label(d.status, DEFECT_STATUS_LABELS),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColumnWidths(ws, [30, 30, 14, 14, 10, 12, 10, 10, 10]);

  return ws;
}

// =============================================
// SHEET 2: ALL DEFECTS (MASTER TABLE)
// =============================================

function buildAllDefectsSheet(defects: ExportDefect[]): XLSX.WorkSheet {
  const headers = [
    'Site Name',
    'Site Address',
    'Local Authority',
    'Asset Code',
    'Asset Type',
    'Asset Zone',
    'Defect Description',
    'BS EN Reference',
    'Risk Rating',
    'Status',
    'Action Required',
    'Action Timescale',
    'Due Date',
    'Estimated Cost (£)',
    'Actual Cost (£)',
    'Inspection Type',
    'Inspection Date',
    'Inspector',
    'Assigned To',
    'Resolution Notes',
    'Resolved Date',
    'Photos',
    'Date Identified',
    'Last Updated',
  ];

  const rows: (string | number | null)[][] = [headers];

  for (const d of defects) {
    rows.push([
      d.site_name,
      d.site_address ?? '',
      d.site_local_authority ?? '',
      d.asset_code,
      d.asset_type,
      d.asset_zone ?? '',
      d.description,
      d.bs_en_reference ?? '',
      label(d.severity, RISK_RATING_LABELS),
      label(d.status, DEFECT_STATUS_LABELS),
      d.remedial_action,
      label(d.action_timeframe, ACTION_TIMEFRAME_LABELS),
      formatDate(d.due_date),
      d.estimated_cost_gbp,
      d.actual_cost_gbp,
      label(d.inspection_type, INSPECTION_TYPE_LABELS),
      formatDate(d.inspection_date),
      d.inspector_name,
      d.assigned_to_name ?? '',
      d.resolution_notes ?? '',
      formatDate(d.resolved_at),
      d.photo_count > 0 ? `${d.photo_count} photo${d.photo_count !== 1 ? 's' : ''}` : '',
      formatDate(d.created_at),
      formatDate(d.updated_at),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColumnWidths(ws, [
    25, 30, 18, 12, 16, 14, 50, 16, 12, 14,
    50, 16, 12, 14, 14, 16, 12, 18, 18, 40,
    12, 10, 12, 12,
  ]);

  // Auto-filter on header row
  ws['!autofilter'] = { ref: `A1:X${rows.length}` };

  return ws;
}

// =============================================
// SHEET 3+: PER-SITE SHEETS
// =============================================

function buildSiteSheet(
  siteSummary: SiteSummary,
  siteDefects: ExportDefect[],
): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [];

  // ── Site header ────────────────────────────
  rows.push([siteSummary.site_name]);
  rows.push([siteSummary.site_address ?? '']);
  rows.push([
    `Assets: ${siteSummary.total_assets}`,
    '',
    `Defects: ${siteSummary.total_defects}`,
    '',
    `Open: ${siteSummary.open_defects}`,
  ]);
  rows.push([]); // spacer

  // ── Risk summary for this site ─────────────
  rows.push(['Risk Summary']);
  rows.push(['Very High', siteSummary.very_high_count]);
  rows.push(['High', siteSummary.high_count]);
  rows.push(['Medium', siteSummary.medium_count]);
  rows.push(['Low', siteSummary.low_count]);
  rows.push([]); // spacer

  // ── Defect table ───────────────────────────
  rows.push([
    'Asset Code', 'Asset Type', 'Zone', 'Defect Description', 'BS EN Ref',
    'Risk Rating', 'Status', 'Action Required', 'Timescale', 'Due Date',
    'Est. Cost (£)', 'Actual Cost (£)', 'Inspector', 'Inspection Date', 'Photos',
  ]);

  for (const d of siteDefects) {
    rows.push([
      d.asset_code,
      d.asset_type,
      d.asset_zone ?? '',
      d.description,
      d.bs_en_reference ?? '',
      label(d.severity, RISK_RATING_LABELS),
      label(d.status, DEFECT_STATUS_LABELS),
      d.remedial_action,
      label(d.action_timeframe, ACTION_TIMEFRAME_LABELS),
      formatDate(d.due_date),
      d.estimated_cost_gbp,
      d.actual_cost_gbp,
      d.inspector_name,
      formatDate(d.inspection_date),
      d.photo_count > 0 ? `${d.photo_count}` : '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  setColumnWidths(ws, [12, 16, 14, 50, 16, 12, 14, 50, 16, 12, 14, 14, 18, 12, 8]);

  // Auto-filter on defect table headers (row 11 = index 10)
  const headerRow = 11;
  if (siteDefects.length > 0) {
    ws['!autofilter'] = { ref: `A${headerRow}:O${headerRow + siteDefects.length}` };
  }

  return ws;
}

// =============================================
// MAIN EXPORT FUNCTIONS
// =============================================

/**
 * Generate and download a multi-sheet Excel workbook.
 *
 * Sheets:
 *   1. Summary
 *   2. All Defects (master table with auto-filter)
 *   3+ Site – [Name] (one per site with defects)
 */
export function generateExcelWorkbook(data: DefectExportData): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryWs = buildSummarySheet(data);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Sheet 2: All Defects (master table)
  const allDefectsWs = buildAllDefectsSheet(data.defects);
  XLSX.utils.book_append_sheet(wb, allDefectsWs, 'All Defects');

  // Sheet 3+: Per-site sheets (only for sites with defects)
  const defectsBySite = new Map<string, ExportDefect[]>();
  for (const d of data.defects) {
    const existing = defectsBySite.get(d.site_id) ?? [];
    existing.push(d);
    defectsBySite.set(d.site_id, existing);
  }

  const sitesWithDefects = data.site_summaries.filter(
    (s) => defectsBySite.has(s.site_id),
  );

  for (let i = 0; i < sitesWithDefects.length; i++) {
    const site = sitesWithDefects[i]!;
    const siteDefects = defectsBySite.get(site.site_id) ?? [];
    const sheetName = siteSheetName(site.site_name, i);
    const siteWs = buildSiteSheet(site, siteDefects);
    XLSX.utils.book_append_sheet(wb, siteWs, sheetName);
  }

  // Trigger download
  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `InspectVoice_Defects_${timestamp}.xlsx`);
}

/**
 * Generate and download a simple CSV of the master defect table.
 * Single flat file — no sheets, no formatting. For quick import into other systems.
 */
export function generateCsvExport(defects: ExportDefect[]): void {
  const ws = buildAllDefectsSheet(defects);
  const csv = XLSX.utils.sheet_to_csv(ws);

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `InspectVoice_Defects_${timestamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
