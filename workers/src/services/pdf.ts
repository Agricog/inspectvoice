/**
 * InspectVoice — PDF Report Generation Service
 * Generates BS EN 1176-7 compliant inspection reports using pdf-lib.
 *
 * Report structure:
 *   1. Report header (company/org branding, report ref, date)
 *   2. Site details (name, address, type, contact)
 *   3. Inspection summary (type, date, inspector, weather, overall risk)
 *   4. Risk overview table (counts by severity)
 *   5. Asset inspection findings (per item: condition, defects, AI analysis)
 *   6. Defect register (all defects with actions and timeframes)
 *   7. Inspector declaration and signature
 *   8. Compliance footer (applicable standards, report version)
 *
 * Note: pdf-lib is installed in workers/package.json. It runs in Cloudflare
 * Workers (no Node.js fs dependency).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { Logger } from '../shared/logger';
import { getWorkerAssetConfig } from './ai';

// =============================================
// CONFIGURATION
// =============================================

const PAGE_WIDTH = 595.28;  // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 60;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const FONT_SIZE_TITLE = 18;
const FONT_SIZE_HEADING = 13;
const FONT_SIZE_SUBHEADING = 11;
const FONT_SIZE_BODY = 9.5;
const FONT_SIZE_SMALL = 8;

const LINE_HEIGHT_BODY = 14;
const LINE_HEIGHT_HEADING = 20;
const SECTION_GAP = 20;

const COLOUR_BLACK = rgb(0, 0, 0);
const COLOUR_DARK_GREY = rgb(0.25, 0.25, 0.25);
const COLOUR_GREY = rgb(0.5, 0.5, 0.5);
const COLOUR_LIGHT_GREY = rgb(0.92, 0.92, 0.92);
const COLOUR_RED = rgb(0.8, 0.1, 0.1);
const COLOUR_AMBER = rgb(0.85, 0.55, 0.05);
const COLOUR_GREEN = rgb(0.1, 0.6, 0.2);
const COLOUR_BLUE = rgb(0.15, 0.3, 0.65);

// =============================================
// INPUT TYPES
// =============================================

export interface PdfReportData {
  readonly org: {
    readonly companyName: string;
    readonly companyAddress: string | null;
    readonly companyPhone: string | null;
    readonly companyEmail: string | null;
    readonly accreditationBody: string | null;
    readonly accreditationNumber: string | null;
    readonly reportFooterText: string | null;
  };
  readonly site: {
    readonly name: string;
    readonly address: string;
    readonly postcode: string | null;
    readonly siteType: string;
    readonly contactName: string | null;
    readonly contactPhone: string | null;
  };
  readonly inspection: {
    readonly id: string;
    readonly inspectionType: string;
    readonly inspectionDate: string;
    readonly startedAt: string;
    readonly completedAt: string | null;
    readonly durationMinutes: number | null;
    readonly weatherConditions: string | null;
    readonly temperatureC: number | null;
    readonly surfaceConditions: string | null;
    readonly overallRiskRating: string | null;
    readonly veryHighRiskCount: number;
    readonly highRiskCount: number;
    readonly mediumRiskCount: number;
    readonly lowRiskCount: number;
    readonly totalDefects: number;
    readonly closureRecommended: boolean;
    readonly inspectorSummary: string | null;
    readonly signedBy: string | null;
    readonly signedAt: string | null;
  };
  readonly inspector: {
    readonly displayName: string;
    readonly rpiiNumber: string | null;
    readonly rpiiGrade: string | null;
    readonly qualifications: string | null;
    readonly insuranceProvider: string | null;
    readonly insurancePolicyNumber: string | null;
  };
  readonly items: readonly PdfInspectionItem[];
}

export interface PdfInspectionItem {
  readonly assetCode: string;
  readonly assetType: string;
  readonly overallCondition: string | null;
  readonly riskRating: string | null;
  readonly requiresAction: boolean;
  readonly actionTimeframe: string | null;
  readonly inspectorNotes: string | null;
  readonly voiceTranscript: string | null;
  readonly aiSummary: string | null;
  readonly defects: readonly PdfDefect[];
}

export interface PdfDefect {
  readonly description: string;
  readonly severity: string;
  readonly defectCategory: string;
  readonly bsEnReference: string | null;
  readonly actionRequired: string;
  readonly actionTimeframe: string;
  readonly estimatedCostGbp: string | null;
}

// =============================================
// PDF GENERATION
// =============================================

/**
 * Generate a complete inspection report PDF.
 *
 * @param data — all report data (org, site, inspection, items, defects)
 * @param requestId — for logging
 * @returns PDF bytes as Uint8Array
 */
export async function generateInspectionPdf(
  data: PdfReportData,
  requestId: string,
): Promise<Uint8Array> {
  const logger = Logger.minimal(requestId);
  logger.info('Generating PDF report', {
    inspectionId: data.inspection.id,
    itemCount: data.items.length,
    totalDefects: data.inspection.totalDefects,
  });

  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: DrawContext = {
    doc,
    fontRegular,
    fontBold,
    currentPage: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    cursorY: PAGE_HEIGHT - MARGIN_TOP,
  };

  // ── Section 1: Header ──
  drawReportHeader(ctx, data);

  // ── Section 2: Site Details ──
  drawSiteDetails(ctx, data);

  // ── Section 3: Inspection Summary ──
  drawInspectionSummary(ctx, data);

  // ── Section 4: Risk Overview ──
  drawRiskOverview(ctx, data);

  // ── Section 5: Asset Findings ──
  for (const item of data.items) {
    drawAssetFindings(ctx, item);
  }

  // ── Section 6: Defect Register ──
  drawDefectRegister(ctx, data);

  // ── Section 7: Declaration & Signature ──
  drawSignature(ctx, data);

  // ── Footer on all pages ──
  drawFooterOnAllPages(ctx, data);

  const pdfBytes = await doc.save();

  logger.info('PDF generated', {
    inspectionId: data.inspection.id,
    pages: doc.getPageCount(),
    sizeBytes: pdfBytes.length,
  });

  return pdfBytes;
}

// =============================================
// DRAWING CONTEXT
// =============================================

interface DrawContext {
  doc: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  currentPage: PDFPage;
  cursorY: number;
}

/** Ensure enough vertical space; add new page if not. */
function ensureSpace(ctx: DrawContext, needed: number): void {
  if (ctx.cursorY - needed < MARGIN_BOTTOM) {
    ctx.currentPage = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.cursorY = PAGE_HEIGHT - MARGIN_TOP;
  }
}

/** Draw text and advance cursor. */
function drawText(
  ctx: DrawContext,
  text: string,
  options: {
    font?: PDFFont;
    size?: number;
    colour?: ReturnType<typeof rgb>;
    indent?: number;
    maxWidth?: number;
  } = {},
): void {
  const font = options.font ?? ctx.fontRegular;
  const size = options.size ?? FONT_SIZE_BODY;
  const colour = options.colour ?? COLOUR_BLACK;
  const indent = options.indent ?? 0;
  const maxWidth = options.maxWidth ?? (CONTENT_WIDTH - indent);

  // Word-wrap
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  for (const l of lines) {
    ensureSpace(ctx, LINE_HEIGHT_BODY);
    ctx.currentPage.drawText(l, {
      x: MARGIN_LEFT + indent,
      y: ctx.cursorY,
      size,
      font,
      color: colour,
    });
    ctx.cursorY -= LINE_HEIGHT_BODY;
  }
}

/** Draw a horizontal rule. */
function drawRule(ctx: DrawContext, colour: ReturnType<typeof rgb> = COLOUR_LIGHT_GREY): void {
  ensureSpace(ctx, 8);
  ctx.currentPage.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.cursorY },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.cursorY },
    thickness: 0.5,
    color: colour,
  });
  ctx.cursorY -= 8;
}

/** Draw a section heading. */
function drawHeading(ctx: DrawContext, text: string): void {
  ctx.cursorY -= SECTION_GAP;
  ensureSpace(ctx, LINE_HEIGHT_HEADING + 8);
  drawText(ctx, text, { font: ctx.fontBold, size: FONT_SIZE_HEADING, colour: COLOUR_BLUE });
  drawRule(ctx, COLOUR_BLUE);
}

/** Draw a label:value pair. */
function drawField(ctx: DrawContext, label: string, value: string | null | undefined, indent: number = 0): void {
  if (!value) return;
  ensureSpace(ctx, LINE_HEIGHT_BODY);
  const labelWidth = ctx.fontBold.widthOfTextAtSize(`${label}: `, FONT_SIZE_BODY);
  ctx.currentPage.drawText(`${label}: `, {
    x: MARGIN_LEFT + indent,
    y: ctx.cursorY,
    size: FONT_SIZE_BODY,
    font: ctx.fontBold,
    color: COLOUR_DARK_GREY,
  });
  ctx.currentPage.drawText(value, {
    x: MARGIN_LEFT + indent + labelWidth,
    y: ctx.cursorY,
    size: FONT_SIZE_BODY,
    font: ctx.fontRegular,
    color: COLOUR_BLACK,
  });
  ctx.cursorY -= LINE_HEIGHT_BODY;
}

// =============================================
// SECTION DRAWERS
// =============================================

function drawReportHeader(ctx: DrawContext, data: PdfReportData): void {
  drawText(ctx, 'PLAYGROUND INSPECTION REPORT', {
    font: ctx.fontBold,
    size: FONT_SIZE_TITLE,
    colour: COLOUR_BLUE,
  });
  ctx.cursorY -= 4;

  drawText(ctx, data.org.companyName, { font: ctx.fontBold, size: FONT_SIZE_SUBHEADING });

  if (data.org.companyAddress) {
    drawText(ctx, data.org.companyAddress, { size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
  }

  const contactParts: string[] = [];
  if (data.org.companyPhone) contactParts.push(data.org.companyPhone);
  if (data.org.companyEmail) contactParts.push(data.org.companyEmail);
  if (contactParts.length > 0) {
    drawText(ctx, contactParts.join('  |  '), { size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
  }

  if (data.org.accreditationBody) {
    drawText(ctx, `Accreditation: ${data.org.accreditationBody} ${data.org.accreditationNumber ?? ''}`.trim(), {
      size: FONT_SIZE_SMALL, colour: COLOUR_GREY,
    });
  }

  ctx.cursorY -= 4;
  drawText(ctx, `Report Ref: IV-${data.inspection.id.slice(0, 8).toUpperCase()}`, {
    font: ctx.fontBold, size: FONT_SIZE_SMALL, colour: COLOUR_DARK_GREY,
  });

  drawRule(ctx);
}

function drawSiteDetails(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '1. Site Details');

  drawField(ctx, 'Site Name', data.site.name);
  drawField(ctx, 'Address', data.site.address);
  drawField(ctx, 'Postcode', data.site.postcode);
  drawField(ctx, 'Site Type', data.site.siteType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  drawField(ctx, 'Contact', data.site.contactName);
  drawField(ctx, 'Contact Phone', data.site.contactPhone);
}

function drawInspectionSummary(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '2. Inspection Summary');

  const typeLabel = {
    routine_visual: 'Routine Visual Inspection',
    operational: 'Operational Inspection',
    annual_main: 'Annual Main Inspection',
  }[data.inspection.inspectionType] ?? data.inspection.inspectionType;

  drawField(ctx, 'Inspection Type', typeLabel);
  drawField(ctx, 'Date', formatDate(data.inspection.inspectionDate));
  drawField(ctx, 'Duration', data.inspection.durationMinutes ? `${data.inspection.durationMinutes} minutes` : null);
  drawField(ctx, 'Inspector', data.inspector.displayName);
  drawField(ctx, 'RPII No.', data.inspector.rpiiNumber);
  drawField(ctx, 'RPII Grade', data.inspector.rpiiGrade);
  drawField(ctx, 'Weather', data.inspection.weatherConditions);
  drawField(ctx, 'Temperature', data.inspection.temperatureC !== null ? `${data.inspection.temperatureC}°C` : null);
  drawField(ctx, 'Surface Conditions', data.inspection.surfaceConditions);

  if (data.inspection.closureRecommended) {
    ctx.cursorY -= 6;
    drawText(ctx, '⚠ CLOSURE RECOMMENDED — Very high risk defects identified', {
      font: ctx.fontBold, size: FONT_SIZE_SUBHEADING, colour: COLOUR_RED,
    });
  }

  if (data.inspection.inspectorSummary) {
    ctx.cursorY -= 6;
    drawText(ctx, 'Inspector Summary:', { font: ctx.fontBold, size: FONT_SIZE_BODY });
    drawText(ctx, data.inspection.inspectorSummary, { indent: 10 });
  }
}

function drawRiskOverview(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '3. Risk Overview');

  const overallRisk = data.inspection.overallRiskRating ?? 'Not assessed';
  const riskColour = getRiskColour(overallRisk);

  drawText(ctx, `Overall Risk Rating: ${overallRisk.replace(/_/g, ' ').toUpperCase()}`, {
    font: ctx.fontBold, size: FONT_SIZE_SUBHEADING, colour: riskColour,
  });

  ctx.cursorY -= 8;

  // Risk count table
  const rows = [
    { label: 'Very High Risk', count: data.inspection.veryHighRiskCount, colour: COLOUR_RED },
    { label: 'High Risk', count: data.inspection.highRiskCount, colour: COLOUR_AMBER },
    { label: 'Medium Risk', count: data.inspection.mediumRiskCount, colour: rgb(0.7, 0.5, 0.0) },
    { label: 'Low Risk', count: data.inspection.lowRiskCount, colour: COLOUR_GREEN },
  ];

  for (const row of rows) {
    ensureSpace(ctx, LINE_HEIGHT_BODY);
    ctx.currentPage.drawText(`${row.label}:`, {
      x: MARGIN_LEFT + 10,
      y: ctx.cursorY,
      size: FONT_SIZE_BODY,
      font: ctx.fontBold,
      color: row.colour,
    });
    ctx.currentPage.drawText(String(row.count), {
      x: MARGIN_LEFT + 150,
      y: ctx.cursorY,
      size: FONT_SIZE_BODY,
      font: ctx.fontBold,
      color: row.colour,
    });
    ctx.cursorY -= LINE_HEIGHT_BODY;
  }

  drawField(ctx, 'Total Defects', String(data.inspection.totalDefects), 10);
}

function drawAssetFindings(ctx: DrawContext, item: PdfInspectionItem): void {
  ensureSpace(ctx, 80);
  ctx.cursorY -= SECTION_GAP / 2;

  const config = getWorkerAssetConfig(item.assetType);
  const conditionColour = getConditionColour(item.overallCondition);

  // Asset header
  drawText(ctx, `${item.assetCode} — ${config.name}`, {
    font: ctx.fontBold, size: FONT_SIZE_SUBHEADING, colour: COLOUR_DARK_GREY,
  });

  drawField(ctx, 'Condition', item.overallCondition?.replace(/_/g, ' ').toUpperCase() ?? 'Not assessed', 10);
  drawField(ctx, 'Risk Rating', item.riskRating?.replace(/_/g, ' ').toUpperCase() ?? 'Not assessed', 10);

  if (item.requiresAction) {
    drawField(ctx, 'Action Required', item.actionTimeframe?.replace(/_/g, ' ') ?? 'Yes', 10);
  }

  if (item.inspectorNotes) {
    drawText(ctx, `Inspector Notes: ${item.inspectorNotes}`, { indent: 10, size: FONT_SIZE_SMALL });
  }

  if (item.aiSummary) {
    drawText(ctx, `AI Summary: ${item.aiSummary}`, { indent: 10, size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
  }

  // Defects for this asset
  if (item.defects.length > 0) {
    ctx.cursorY -= 4;
    for (const defect of item.defects) {
      ensureSpace(ctx, 40);
      const sevColour = getRiskColour(defect.severity);

      drawText(ctx, `[${defect.severity.replace(/_/g, ' ').toUpperCase()}] ${defect.description}`, {
        indent: 15, font: ctx.fontBold, size: FONT_SIZE_SMALL, colour: sevColour,
      });
      drawText(ctx, `Action: ${defect.actionRequired} (${defect.actionTimeframe.replace(/_/g, ' ')})`, {
        indent: 25, size: FONT_SIZE_SMALL,
      });
      if (defect.bsEnReference) {
        drawText(ctx, `Ref: ${defect.bsEnReference}`, { indent: 25, size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
      }
    }
  } else {
    drawText(ctx, 'No defects identified.', { indent: 10, size: FONT_SIZE_SMALL, colour: COLOUR_GREEN });
  }

  drawRule(ctx, COLOUR_LIGHT_GREY);
}

function drawDefectRegister(ctx: DrawContext, data: PdfReportData): void {
  const allDefects = data.items.flatMap((item) =>
    item.defects.map((d) => ({ ...d, assetCode: item.assetCode })),
  );

  if (allDefects.length === 0) return;

  drawHeading(ctx, '5. Defect Register');

  let defectNum = 1;
  for (const defect of allDefects) {
    ensureSpace(ctx, 50);
    const sevColour = getRiskColour(defect.severity);

    drawText(ctx, `${defectNum}. [${defect.assetCode}] ${defect.description}`, {
      font: ctx.fontBold, size: FONT_SIZE_BODY, colour: sevColour,
    });
    drawField(ctx, 'Severity', defect.severity.replace(/_/g, ' ').toUpperCase(), 15);
    drawField(ctx, 'Category', defect.defectCategory, 15);
    drawField(ctx, 'Action', `${defect.actionRequired} (${defect.actionTimeframe.replace(/_/g, ' ')})`, 15);
    if (defect.bsEnReference) drawField(ctx, 'BS EN Ref', defect.bsEnReference, 15);
    if (defect.estimatedCostGbp) drawField(ctx, 'Est. Cost', defect.estimatedCostGbp, 15);

    ctx.cursorY -= 4;
    defectNum++;
  }
}

function drawSignature(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '6. Inspector Declaration');

  drawText(ctx, 'I confirm that this inspection has been carried out in accordance with BS EN 1176-7:2020 and represents an accurate record of findings at the time of inspection.', {
    size: FONT_SIZE_BODY,
  });

  ctx.cursorY -= 10;

  drawField(ctx, 'Inspector', data.inspector.displayName);
  drawField(ctx, 'RPII No.', data.inspector.rpiiNumber);
  drawField(ctx, 'Qualifications', data.inspector.qualifications);
  drawField(ctx, 'Insurance', data.inspector.insuranceProvider
    ? `${data.inspector.insuranceProvider} (${data.inspector.insurancePolicyNumber ?? 'N/A'})`
    : null);

  ctx.cursorY -= 10;

  if (data.inspection.signedBy) {
    drawField(ctx, 'Signed By', data.inspection.signedBy);
    drawField(ctx, 'Signed At', data.inspection.signedAt ? formatDateTime(data.inspection.signedAt) : null);
  } else {
    drawText(ctx, '[NOT YET SIGNED]', { font: ctx.fontBold, colour: COLOUR_AMBER });
  }
}

function drawFooterOnAllPages(ctx: DrawContext, data: PdfReportData): void {
  const pages = ctx.doc.getPages();
  const totalPages = pages.length;

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    if (!page) continue;

    // Page number
    page.drawText(`Page ${i + 1} of ${totalPages}`, {
      x: PAGE_WIDTH - MARGIN_RIGHT - 70,
      y: 25,
      size: FONT_SIZE_SMALL,
      font: ctx.fontRegular,
      color: COLOUR_GREY,
    });

    // Report ref
    page.drawText(`IV-${data.inspection.id.slice(0, 8).toUpperCase()}`, {
      x: MARGIN_LEFT,
      y: 25,
      size: FONT_SIZE_SMALL,
      font: ctx.fontRegular,
      color: COLOUR_GREY,
    });

    // Custom footer text
    if (data.org.reportFooterText) {
      page.drawText(data.org.reportFooterText.slice(0, 100), {
        x: MARGIN_LEFT,
        y: 15,
        size: 7,
        font: ctx.fontRegular,
        color: COLOUR_GREY,
      });
    }

    // Generated by line
    page.drawText('Generated by InspectVoice — inspectvoice.co.uk', {
      x: PAGE_WIDTH / 2 - 85,
      y: 15,
      size: 7,
      font: ctx.fontRegular,
      color: COLOUR_GREY,
    });
  }
}

// =============================================
// HELPERS
// =============================================

function getRiskColour(rating: string): ReturnType<typeof rgb> {
  switch (rating) {
    case 'very_high': return COLOUR_RED;
    case 'high': return COLOUR_AMBER;
    case 'medium': return rgb(0.7, 0.5, 0.0);
    case 'low': return COLOUR_GREEN;
    default: return COLOUR_DARK_GREY;
  }
}

function getConditionColour(condition: string | null): ReturnType<typeof rgb> {
  switch (condition) {
    case 'good': return COLOUR_GREEN;
    case 'fair': return rgb(0.7, 0.5, 0.0);
    case 'poor': return COLOUR_AMBER;
    case 'dangerous': return COLOUR_RED;
    default: return COLOUR_DARK_GREY;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
      + ' at '
      + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
