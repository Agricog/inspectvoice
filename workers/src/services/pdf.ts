/**
 * InspectVoice — PDF Report Generation Service
 * Generates BS EN 1176-7 compliant inspection reports using pdf-lib.
 *
 * Report structure:
 *   1. Report header (company/org branding, report ref, date)
 *   2. Site details (name, address, type, contact)
 *   3. Inspection summary (type, date, inspector, weather, overall risk)
 *   4. Risk overview (overall rating + counts by severity)
 *   5. BS EN inspection schedule (checklist of all inspection points)
 *   6. Asset inspection findings (per item: condition, defects, AI summary)
 *   7. Defect register (all defects with actions, timeframes, costs, photo refs)
 *   8. Photo evidence log (cross-referenced list of all photos)
 *   9. Recommendations & compliance notes
 *   10. Inspector declaration and signature
 *   11. Compliance footer (applicable standards, report version)
 *
 * Note: pdf-lib is installed in workers/package.json. It runs in Cloudflare
 * Workers (no Node.js fs dependency).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { Logger } from '../shared/logger';
import { getWorkerAssetConfig, type WorkerInspectionPoint } from './ai';

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
const FONT_SIZE_TINY = 7;

const LINE_HEIGHT_BODY = 14;
const LINE_HEIGHT_HEADING = 20;
const LINE_HEIGHT_TABLE = 13;
const SECTION_GAP = 20;

const COLOUR_BLACK = rgb(0, 0, 0);
const COLOUR_DARK_GREY = rgb(0.25, 0.25, 0.25);
const COLOUR_GREY = rgb(0.5, 0.5, 0.5);
const COLOUR_LIGHT_GREY = rgb(0.92, 0.92, 0.92);
const COLOUR_WHITE = rgb(1, 1, 1);
const COLOUR_RED = rgb(0.8, 0.1, 0.1);
const COLOUR_AMBER = rgb(0.85, 0.55, 0.05);
const COLOUR_YELLOW = rgb(0.7, 0.5, 0.0);
const COLOUR_GREEN = rgb(0.1, 0.6, 0.2);
const COLOUR_BLUE = rgb(0.15, 0.3, 0.65);
const COLOUR_TABLE_HEADER = rgb(0.12, 0.25, 0.5);
const COLOUR_TABLE_STRIPE = rgb(0.96, 0.96, 0.98);

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
  readonly photoIndex: readonly PdfPhotoIndexEntry[];
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
  readonly recommendations: readonly string[];
  readonly complianceNotes: readonly string[];
  readonly photoCount: number;
  readonly defects: readonly PdfDefect[];
  readonly photos: readonly PdfPhoto[];
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

export interface PdfPhoto {
  readonly photoNumber: number;
  readonly photoType: string;
  readonly caption: string | null;
  readonly associatedDefectDescriptions: string[];
}

export interface PdfPhotoIndexEntry {
  readonly number: number;
  readonly assetCode: string;
  readonly photoType: string;
  readonly caption: string | null;
  readonly associatedDefects: string[];
  readonly pdfLabel: string;
}

// =============================================
// PDF GENERATION
// =============================================

/**
 * Generate a complete inspection report PDF.
 *
 * @param data — all report data (org, site, inspection, items, defects, photos)
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
    totalPhotos: data.photoIndex.length,
  });

  const doc = await PDFDocument.create();

  // Set PDF metadata
  doc.setTitle(`Inspection Report — ${data.site.name} — ${data.inspection.inspectionDate}`);
  doc.setAuthor(data.org.companyName);
  doc.setSubject(`BS EN 1176 Inspection Report`);
  doc.setCreator('InspectVoice (inspectvoice.co.uk)');
  doc.setProducer('InspectVoice PDF Generator');

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const ctx: DrawContext = {
    doc,
    fontRegular,
    fontBold,
    fontItalic,
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

  // ── Section 5: BS EN Inspection Schedule ──
  drawInspectionSchedule(ctx, data);

  // ── Section 6: Asset Findings ──
  drawAssetFindingsSection(ctx, data);

  // ── Section 7: Defect Register ──
  drawDefectRegister(ctx, data);

  // ── Section 8: Photo Evidence Log ──
  drawPhotoEvidenceLog(ctx, data);

  // ── Section 9: Recommendations & Compliance ──
  drawRecommendations(ctx, data);

  // ── Section 10: Declaration & Signature ──
  drawSignature(ctx, data);

  // ── Section 11: Applicable Standards ──
  drawApplicableStandards(ctx, data);

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
  fontItalic: PDFFont;
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

/** Draw text and advance cursor. Returns the number of lines drawn. */
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
): number {
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

  return lines.length;
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

/** Draw a section heading with number. */
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

/**
 * Draw a table row with cells at specified column positions.
 */
function drawTableRow(
  ctx: DrawContext,
  cells: readonly { text: string; x: number; width: number; font?: PDFFont; colour?: ReturnType<typeof rgb> }[],
  options: {
    size?: number;
    rowHeight?: number;
    bgColour?: ReturnType<typeof rgb> | null;
  } = {},
): void {
  const size = options.size ?? FONT_SIZE_SMALL;
  const rowHeight = options.rowHeight ?? LINE_HEIGHT_TABLE;

  ensureSpace(ctx, rowHeight + 2);

  // Background fill
  if (options.bgColour) {
    ctx.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: ctx.cursorY - 3,
      width: CONTENT_WIDTH,
      height: rowHeight + 2,
      color: options.bgColour,
    });
  }

  for (const cell of cells) {
    // Truncate text to fit column width
    const font = cell.font ?? ctx.fontRegular;
    let displayText = cell.text;
    while (font.widthOfTextAtSize(displayText, size) > cell.width - 4 && displayText.length > 3) {
      displayText = displayText.slice(0, -4) + '...';
    }

    ctx.currentPage.drawText(displayText, {
      x: cell.x,
      y: ctx.cursorY,
      size,
      font,
      color: cell.colour ?? COLOUR_BLACK,
    });
  }

  ctx.cursorY -= rowHeight;
}

// =============================================
// SECTION DRAWERS
// =============================================

function drawReportHeader(ctx: DrawContext, data: PdfReportData): void {
  // Adaptive title based on inspection type
  const typeLabel = getInspectionTypeLabel(data.inspection.inspectionType);
  drawText(ctx, `${typeLabel.toUpperCase()} REPORT`, {
    font: ctx.fontBold,
    size: FONT_SIZE_TITLE,
    colour: COLOUR_BLUE,
  });
  ctx.cursorY -= 2;

  drawText(ctx, 'In accordance with BS EN 1176-7:2020', {
    font: ctx.fontItalic,
    size: FONT_SIZE_SMALL,
    colour: COLOUR_GREY,
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
  drawText(ctx, `Generated: ${formatDateTime(new Date().toISOString())}`, {
    size: FONT_SIZE_SMALL, colour: COLOUR_GREY,
  });

  drawRule(ctx);
}

function drawSiteDetails(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '1. Site Details');

  drawField(ctx, 'Site Name', data.site.name);
  drawField(ctx, 'Address', data.site.address);
  drawField(ctx, 'Postcode', data.site.postcode);
  drawField(ctx, 'Site Type', formatEnum(data.site.siteType));
  drawField(ctx, 'Contact', data.site.contactName);
  drawField(ctx, 'Contact Phone', data.site.contactPhone);
  drawField(ctx, 'Assets Inspected', `${data.items.length} item${data.items.length !== 1 ? 's' : ''}`);
}

function drawInspectionSummary(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '2. Inspection Summary');

  drawField(ctx, 'Inspection Type', getInspectionTypeLabel(data.inspection.inspectionType));
  drawField(ctx, 'Date', formatDate(data.inspection.inspectionDate));
  drawField(ctx, 'Duration', data.inspection.durationMinutes ? `${data.inspection.durationMinutes} minutes` : null);
  drawField(ctx, 'Inspector', data.inspector.displayName);
  drawField(ctx, 'RPII No.', data.inspector.rpiiNumber);
  drawField(ctx, 'RPII Grade', data.inspector.rpiiGrade);
  drawField(ctx, 'Qualifications', data.inspector.qualifications);
  drawField(ctx, 'Weather', data.inspection.weatherConditions);
  drawField(ctx, 'Temperature', data.inspection.temperatureC !== null ? `${data.inspection.temperatureC}°C` : null);
  drawField(ctx, 'Surface Conditions', data.inspection.surfaceConditions);

  if (data.inspection.closureRecommended) {
    ctx.cursorY -= 8;
    ensureSpace(ctx, 30);

    // Red warning box
    ctx.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: ctx.cursorY - 6,
      width: CONTENT_WIDTH,
      height: 22,
      color: rgb(1, 0.92, 0.92),
      borderColor: COLOUR_RED,
      borderWidth: 1,
    });

    ctx.currentPage.drawText('CLOSURE RECOMMENDED — Very high risk defects identified requiring immediate action', {
      x: MARGIN_LEFT + 10,
      y: ctx.cursorY,
      size: FONT_SIZE_BODY,
      font: ctx.fontBold,
      color: COLOUR_RED,
    });
    ctx.cursorY -= 22;
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

  drawText(ctx, `Overall Risk Rating: ${formatEnum(overallRisk)}`, {
    font: ctx.fontBold, size: FONT_SIZE_SUBHEADING, colour: riskColour,
  });

  ctx.cursorY -= 8;

  // Risk count table
  const colSeverity = MARGIN_LEFT + 10;
  const colCount = MARGIN_LEFT + 180;
  const colAction = MARGIN_LEFT + 230;

  // Header row
  drawTableRow(ctx, [
    { text: 'Severity', x: colSeverity, width: 170, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Count', x: colCount, width: 50, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Required Action', x: colAction, width: 240, font: ctx.fontBold, colour: COLOUR_WHITE },
  ], { bgColour: COLOUR_TABLE_HEADER });

  const rows = [
    { label: 'Very High', count: data.inspection.veryHighRiskCount, colour: COLOUR_RED, action: 'Immediate closure / restriction' },
    { label: 'High', count: data.inspection.highRiskCount, colour: COLOUR_AMBER, action: 'Urgent action within 48 hours' },
    { label: 'Medium', count: data.inspection.mediumRiskCount, colour: COLOUR_YELLOW, action: 'Action within 1 month' },
    { label: 'Low', count: data.inspection.lowRiskCount, colour: COLOUR_GREEN, action: 'Next scheduled maintenance' },
  ];

  rows.forEach((row, i) => {
    drawTableRow(ctx, [
      { text: row.label, x: colSeverity, width: 170, font: ctx.fontBold, colour: row.colour },
      { text: String(row.count), x: colCount, width: 50, font: ctx.fontBold, colour: row.count > 0 ? row.colour : COLOUR_GREY },
      { text: row.action, x: colAction, width: 240, colour: COLOUR_DARK_GREY },
    ], { bgColour: i % 2 === 1 ? COLOUR_TABLE_STRIPE : null });
  });

  ctx.cursorY -= 4;
  drawField(ctx, 'Total Defects', String(data.inspection.totalDefects), 10);
  drawField(ctx, 'Total Assets Inspected', String(data.items.length), 10);
  drawField(ctx, 'Total Photos', String(data.photoIndex.length), 10);
}

/**
 * BS EN Inspection Schedule — THE differentiator.
 */
function drawInspectionSchedule(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '4. BS EN Inspection Schedule');

  drawText(ctx, 'The following inspection points were assessed for each asset in accordance with the applicable BS EN standard and the inspection type performed.', {
    size: FONT_SIZE_SMALL, colour: COLOUR_GREY,
  });

  ctx.cursorY -= 4;

  // Key
  drawText(ctx, 'Key:  \u2713 Inspected — defect(s) found    \u25CF Inspected — satisfactory    \u25CB Not assessed for this inspection type', {
    size: FONT_SIZE_SMALL, colour: COLOUR_GREY, font: ctx.fontItalic,
  });

  ctx.cursorY -= 8;

  for (const item of data.items) {
    const config = getWorkerAssetConfig(item.assetType);
    const inspectionType = data.inspection.inspectionType;

    ensureSpace(ctx, 60);

    // Asset sub-header
    drawText(ctx, `${item.assetCode} — ${config.name}`, {
      font: ctx.fontBold, size: FONT_SIZE_BODY, colour: COLOUR_DARK_GREY,
    });
    drawText(ctx, `Standard: ${config.complianceStandard}`, {
      size: FONT_SIZE_SMALL, colour: COLOUR_GREY, indent: 5,
    });

    ctx.cursorY -= 2;

    // Table header
    const colStatus = MARGIN_LEFT + 5;
    const colPoint = MARGIN_LEFT + 30;
    const colDesc = MARGIN_LEFT + 200;

    drawTableRow(ctx, [
      { text: 'Status', x: colStatus, width: 25, font: ctx.fontBold, colour: COLOUR_WHITE },
      { text: 'Inspection Point', x: colPoint, width: 170, font: ctx.fontBold, colour: COLOUR_WHITE },
      { text: 'Description', x: colDesc, width: 260, font: ctx.fontBold, colour: COLOUR_WHITE },
    ], { bgColour: COLOUR_TABLE_HEADER });

    // Inspection points for this asset
    for (let i = 0; i < config.inspectionPoints.length; i++) {
      const point = config.inspectionPoints[i];
      if (!point) continue;

      const isApplicable = point.appliesTo.includes(inspectionType);

      const hasDefect = item.defects.some((d) =>
        d.description.toLowerCase().includes(point.label.toLowerCase().split('/')[0] ?? '') ||
        d.defectCategory.toLowerCase().includes(point.label.toLowerCase().split('/')[0] ?? ''),
      );

      const status = !isApplicable ? '\u25CB' : hasDefect ? '\u2713' : '\u25CF';
      const statusColour = !isApplicable ? COLOUR_GREY : hasDefect ? COLOUR_AMBER : COLOUR_GREEN;

      ensureSpace(ctx, LINE_HEIGHT_TABLE + 2);

      drawTableRow(ctx, [
        { text: status, x: colStatus + 5, width: 20, font: ctx.fontBold, colour: statusColour },
        { text: point.label, x: colPoint, width: 170, font: ctx.fontRegular },
        { text: point.description, x: colDesc, width: 260, colour: COLOUR_DARK_GREY },
      ], { bgColour: i % 2 === 1 ? COLOUR_TABLE_STRIPE : null });
    }

    ctx.cursorY -= 6;
  }
}

function drawAssetFindingsSection(ctx: DrawContext, data: PdfReportData): void {
  drawHeading(ctx, '5. Asset Inspection Findings');

  for (const item of data.items) {
    drawAssetFindings(ctx, item, data.inspection.inspectionType);
  }
}

function drawAssetFindings(ctx: DrawContext, item: PdfInspectionItem, inspectionType: string): void {
  ensureSpace(ctx, 80);
  ctx.cursorY -= SECTION_GAP / 2;

  const config = getWorkerAssetConfig(item.assetType);

  // Asset header with condition badge
  const conditionLabel = item.overallCondition
    ? formatEnum(item.overallCondition)
    : 'Not assessed';

  drawText(ctx, `${item.assetCode} — ${config.name}`, {
    font: ctx.fontBold, size: FONT_SIZE_SUBHEADING, colour: COLOUR_DARK_GREY,
  });

  drawField(ctx, 'Condition', conditionLabel, 10);
  drawField(ctx, 'Risk Rating', item.riskRating ? formatEnum(item.riskRating) : 'Not assessed', 10);

  if (item.requiresAction) {
    drawField(ctx, 'Action Required', item.actionTimeframe ? formatEnum(item.actionTimeframe) : 'Yes', 10);
  }

  // Photo references with numbered cross-refs
  if (item.photoCount > 0) {
    const photoNums = item.photos.map((p) => `P${p.photoNumber}`).join(', ');
    drawField(ctx, 'Photos', `${item.photoCount} photo${item.photoCount !== 1 ? 's' : ''} (${photoNums})`, 10);
  }

  if (item.inspectorNotes) {
    ctx.cursorY -= 2;
    drawText(ctx, 'Inspector Notes:', { font: ctx.fontBold, size: FONT_SIZE_SMALL, indent: 10 });
    drawText(ctx, item.inspectorNotes, { indent: 15, size: FONT_SIZE_SMALL });
  }

  if (item.aiSummary) {
    ctx.cursorY -= 2;
    drawText(ctx, 'Findings Summary:', { font: ctx.fontBold, size: FONT_SIZE_SMALL, indent: 10 });
    drawText(ctx, item.aiSummary, { indent: 15, size: FONT_SIZE_SMALL });
  }

  // Defects for this asset
  if (item.defects.length > 0) {
    ctx.cursorY -= 6;
    drawText(ctx, `Defects (${item.defects.length}):`, {
      font: ctx.fontBold, size: FONT_SIZE_SMALL, indent: 10,
    });

    for (const defect of item.defects) {
      ensureSpace(ctx, 45);
      const sevColour = getRiskColour(defect.severity);

      // Find photo refs for this defect
      const defectPhotos = item.photos.filter((p) =>
        p.associatedDefectDescriptions.some((d) => d === defect.description) || p.photoType === 'defect',
      );
      const photoRef = defectPhotos.length > 0
        ? ` [${defectPhotos.map((p) => `P${p.photoNumber}`).join(', ')}]`
        : '';

      drawText(ctx, `[${formatEnum(defect.severity)}] ${defect.description}${photoRef}`, {
        indent: 15, font: ctx.fontBold, size: FONT_SIZE_SMALL, colour: sevColour,
      });
      drawText(ctx, `Action: ${defect.actionRequired} (${formatEnum(defect.actionTimeframe)})`, {
        indent: 25, size: FONT_SIZE_SMALL,
      });
      if (defect.bsEnReference) {
        drawText(ctx, `Ref: ${defect.bsEnReference}`, { indent: 25, size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
      }
      if (defect.estimatedCostGbp) {
        drawText(ctx, `Est. Cost: ${defect.estimatedCostGbp}`, { indent: 25, size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
      }
    }
  } else {
    drawText(ctx, 'No defects identified.', { indent: 10, size: FONT_SIZE_SMALL, colour: COLOUR_GREEN });
  }

  drawRule(ctx, COLOUR_LIGHT_GREY);
}

function drawDefectRegister(ctx: DrawContext, data: PdfReportData): void {
  const allDefects = data.items.flatMap((item) =>
    item.defects.map((d) => ({ ...d, assetCode: item.assetCode, itemPhotos: item.photos })),
  );

  if (allDefects.length === 0) return;

  drawHeading(ctx, '6. Defect Register');

  drawText(ctx, 'All defects identified during this inspection, listed by severity. Photo references (P1, P2, etc.) cross-reference the Photo Evidence Log. This register should be used to track remedial actions to completion.', {
    size: FONT_SIZE_SMALL, colour: COLOUR_GREY,
  });

  ctx.cursorY -= 6;

  // Table header — with Photo Ref column
  const colNo = MARGIN_LEFT;
  const colAsset = MARGIN_LEFT + 20;
  const colSev = MARGIN_LEFT + 72;
  const colDesc = MARGIN_LEFT + 128;
  const colAction = MARGIN_LEFT + 278;
  const colPhoto = MARGIN_LEFT + 388;
  const colCost = MARGIN_LEFT + 442;

  drawTableRow(ctx, [
    { text: '#', x: colNo, width: 20, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Asset', x: colAsset, width: 52, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Severity', x: colSev, width: 56, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Description', x: colDesc, width: 150, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Action / Timeframe', x: colAction, width: 110, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Photo Ref', x: colPhoto, width: 54, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Est. Cost', x: colCost, width: 53, font: ctx.fontBold, colour: COLOUR_WHITE },
  ], { bgColour: COLOUR_TABLE_HEADER });

  // Sort by severity (very_high first)
  const sorted = [...allDefects].sort((a, b) => {
    const order: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });

  sorted.forEach((defect, i) => {
    ensureSpace(ctx, LINE_HEIGHT_TABLE + 2);
    const sevColour = getRiskColour(defect.severity);

    // Build photo ref for this defect
    const defectPhotos = defect.itemPhotos.filter((p) =>
      p.associatedDefectDescriptions.some((d) => d === defect.description) || p.photoType === 'defect',
    );
    const photoRef = defectPhotos.length > 0
      ? defectPhotos.map((p) => `P${p.photoNumber}`).join(', ')
      : '\u2014';

    drawTableRow(ctx, [
      { text: String(i + 1), x: colNo, width: 20 },
      { text: defect.assetCode, x: colAsset, width: 52, font: ctx.fontBold },
      { text: formatEnum(defect.severity), x: colSev, width: 56, colour: sevColour, font: ctx.fontBold },
      { text: defect.description, x: colDesc, width: 150 },
      { text: `${formatEnum(defect.actionTimeframe)}`, x: colAction, width: 110 },
      { text: photoRef, x: colPhoto, width: 54, colour: COLOUR_BLUE },
      { text: defect.estimatedCostGbp ?? '\u2014', x: colCost, width: 53, colour: COLOUR_GREY },
    ], { bgColour: i % 2 === 1 ? COLOUR_TABLE_STRIPE : null });
  });
}

/**
 * Photo Evidence Log — cross-referenced table of all photos taken.
 * Each photo is numbered P1, P2, etc. and linked back to defects.
 */
function drawPhotoEvidenceLog(ctx: DrawContext, data: PdfReportData): void {
  if (!data.photoIndex || data.photoIndex.length === 0) return;

  drawHeading(ctx, '7. Photo Evidence Log');

  drawText(ctx, `${data.photoIndex.length} photograph${data.photoIndex.length !== 1 ? 's' : ''} captured during this inspection. Each photo is cross-referenced with the relevant asset and defect(s) in the defect register above.`, {
    size: FONT_SIZE_SMALL, colour: COLOUR_GREY,
  });

  ctx.cursorY -= 6;

  // Table header
  const colNum = MARGIN_LEFT;
  const colAsset = MARGIN_LEFT + 30;
  const colType = MARGIN_LEFT + 90;
  const colDesc = MARGIN_LEFT + 150;

  drawTableRow(ctx, [
    { text: 'Photo', x: colNum, width: 30, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Asset', x: colAsset, width: 60, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Type', x: colType, width: 60, font: ctx.fontBold, colour: COLOUR_WHITE },
    { text: 'Description / Associated Defect', x: colDesc, width: 345, font: ctx.fontBold, colour: COLOUR_WHITE },
  ], { bgColour: COLOUR_TABLE_HEADER });

  for (let i = 0; i < data.photoIndex.length; i++) {
    const entry = data.photoIndex[i];
    if (!entry) continue;

    ensureSpace(ctx, LINE_HEIGHT_TABLE + 2);

    const description = entry.associatedDefects.length > 0
      ? entry.associatedDefects[0] ?? ''
      : entry.caption ?? formatEnum(entry.photoType);

    drawTableRow(ctx, [
      { text: `P${entry.number}`, x: colNum, width: 30, font: ctx.fontBold, colour: COLOUR_BLUE },
      { text: entry.assetCode, x: colAsset, width: 60, font: ctx.fontBold },
      { text: formatEnum(entry.photoType), x: colType, width: 60, colour: COLOUR_GREY },
      { text: description, x: colDesc, width: 345 },
    ], { bgColour: i % 2 === 1 ? COLOUR_TABLE_STRIPE : null });
  }

  ctx.cursorY -= 6;
}

/**
 * Consolidated recommendations and compliance notes from all AI analyses.
 */
function drawRecommendations(ctx: DrawContext, data: PdfReportData): void {
  const allRecs = data.items.flatMap((item) =>
    item.recommendations.map((r) => ({ assetCode: item.assetCode, text: r })),
  );
  const allNotes = data.items.flatMap((item) =>
    item.complianceNotes.map((n) => ({ assetCode: item.assetCode, text: n })),
  );

  if (allRecs.length === 0 && allNotes.length === 0) return;

  drawHeading(ctx, '8. Recommendations & Compliance Notes');

  if (allRecs.length > 0) {
    drawText(ctx, 'Recommendations:', { font: ctx.fontBold, size: FONT_SIZE_BODY });
    for (const rec of allRecs) {
      ensureSpace(ctx, LINE_HEIGHT_BODY);
      drawText(ctx, `\u2022 [${rec.assetCode}] ${rec.text}`, { indent: 10, size: FONT_SIZE_SMALL });
    }
    ctx.cursorY -= 6;
  }

  if (allNotes.length > 0) {
    drawText(ctx, 'Compliance Notes:', { font: ctx.fontBold, size: FONT_SIZE_BODY });
    for (const note of allNotes) {
      ensureSpace(ctx, LINE_HEIGHT_BODY);
      drawText(ctx, `\u2022 [${note.assetCode}] ${note.text}`, { indent: 10, size: FONT_SIZE_SMALL });
    }
  }
}

function drawSignature(ctx: DrawContext, data: PdfReportData): void {
  const sectionNum = hasRecommendations(data) ? '9' : '8';
  drawHeading(ctx, `${sectionNum}. Inspector Declaration`);

  drawText(ctx, 'I confirm that this inspection has been carried out in accordance with BS EN 1176-7:2020 and represents an accurate record of findings at the time of inspection. Equipment not listed in this report was not inspected.', {
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

    // Signature line
    ctx.cursorY -= 8;
    ctx.currentPage.drawLine({
      start: { x: MARGIN_LEFT, y: ctx.cursorY },
      end: { x: MARGIN_LEFT + 200, y: ctx.cursorY },
      thickness: 0.5,
      color: COLOUR_BLACK,
    });
    ctx.cursorY -= LINE_HEIGHT_BODY;
    drawText(ctx, 'Digital Signature', { size: FONT_SIZE_SMALL, colour: COLOUR_GREY });
  } else {
    drawText(ctx, '[NOT YET SIGNED]', { font: ctx.fontBold, colour: COLOUR_AMBER });
  }
}

/**
 * List all BS EN standards referenced in this report.
 */
function drawApplicableStandards(ctx: DrawContext, data: PdfReportData): void {
  const sectionNum = hasRecommendations(data) ? '10' : '9';
  drawHeading(ctx, `${sectionNum}. Applicable Standards`);

  // Collect unique standards from all inspected asset types
  const standards = new Set<string>();
  standards.add('BS EN 1176-1:2017 — Playground equipment — General safety requirements and test methods');
  standards.add('BS EN 1176-7:2020 — Playground equipment — Guidance on installation, inspection, maintenance and operation');
  standards.add('BS EN 1177:2018 — Impact attenuating playground surfacing');

  for (const item of data.items) {
    const config = getWorkerAssetConfig(item.assetType);
    const parts = config.complianceStandard.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (part.startsWith('BS EN')) {
        standards.add(part);
      }
    }
  }

  const sortedStandards = [...standards].sort();
  for (const std of sortedStandards) {
    drawText(ctx, `\u2022 ${std}`, { size: FONT_SIZE_SMALL, indent: 5 });
  }
}

function drawFooterOnAllPages(ctx: DrawContext, data: PdfReportData): void {
  const pages = ctx.doc.getPages();
  const totalPages = pages.length;

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    if (!page) continue;

    // Top border line
    page.drawLine({
      start: { x: MARGIN_LEFT, y: PAGE_HEIGHT - MARGIN_TOP + 15 },
      end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: PAGE_HEIGHT - MARGIN_TOP + 15 },
      thickness: 0.5,
      color: COLOUR_LIGHT_GREY,
    });

    // Bottom border line
    page.drawLine({
      start: { x: MARGIN_LEFT, y: MARGIN_BOTTOM - 15 },
      end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: MARGIN_BOTTOM - 15 },
      thickness: 0.5,
      color: COLOUR_LIGHT_GREY,
    });

    // Page number (right)
    const pageText = `Page ${i + 1} of ${totalPages}`;
    const pageTextWidth = ctx.fontRegular.widthOfTextAtSize(pageText, FONT_SIZE_SMALL);
    page.drawText(pageText, {
      x: PAGE_WIDTH - MARGIN_RIGHT - pageTextWidth,
      y: 25,
      size: FONT_SIZE_SMALL,
      font: ctx.fontRegular,
      color: COLOUR_GREY,
    });

    // Report ref (left)
    page.drawText(`IV-${data.inspection.id.slice(0, 8).toUpperCase()}`, {
      x: MARGIN_LEFT,
      y: 25,
      size: FONT_SIZE_SMALL,
      font: ctx.fontRegular,
      color: COLOUR_GREY,
    });

    // Custom footer text (left, lower)
    if (data.org.reportFooterText) {
      page.drawText(data.org.reportFooterText.slice(0, 100), {
        x: MARGIN_LEFT,
        y: 15,
        size: FONT_SIZE_TINY,
        font: ctx.fontRegular,
        color: COLOUR_GREY,
      });
    }

    // Generated by line (centre, lower)
    const genText = 'Generated by InspectVoice — inspectvoice.co.uk';
    const genWidth = ctx.fontRegular.widthOfTextAtSize(genText, FONT_SIZE_TINY);
    page.drawText(genText, {
      x: (PAGE_WIDTH - genWidth) / 2,
      y: 15,
      size: FONT_SIZE_TINY,
      font: ctx.fontRegular,
      color: COLOUR_GREY,
    });
  }
}

// =============================================
// HELPERS
// =============================================

function hasRecommendations(data: PdfReportData): boolean {
  return data.items.some((item) => item.recommendations.length > 0 || item.complianceNotes.length > 0);
}

function getRiskColour(rating: string): ReturnType<typeof rgb> {
  switch (rating) {
    case 'very_high': return COLOUR_RED;
    case 'high': return COLOUR_AMBER;
    case 'medium': return COLOUR_YELLOW;
    case 'low': return COLOUR_GREEN;
    default: return COLOUR_DARK_GREY;
  }
}

function getConditionColour(condition: string | null): ReturnType<typeof rgb> {
  switch (condition) {
    case 'good': return COLOUR_GREEN;
    case 'fair': return COLOUR_YELLOW;
    case 'poor': return COLOUR_AMBER;
    case 'dangerous': return COLOUR_RED;
    default: return COLOUR_DARK_GREY;
  }
}

function getInspectionTypeLabel(type: string): string {
  return {
    routine_visual: 'Routine Visual Inspection',
    operational: 'Operational Inspection',
    annual_main: 'Annual Main Inspection',
    post_repair: 'Post-Repair Inspection',
    ad_hoc: 'Ad Hoc Inspection',
  }[type] ?? type;
}

/** Format snake_case enum values for display: "very_high" -> "Very High" */
function formatEnum(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
