/**
 * InspectVoice — PDF Report Generator (Client-Side)
 * Batch 16 — generates professional BS EN 1176-compliant inspection reports.
 * Uses pdf-lib (never jspdf) per build standard.
 *
 * Report sections:
 *   1. Cover page — site name, inspection type, date, inspector, org branding
 *   2. Executive summary — risk counts, condition breakdown, closure warnings
 *   3. Site details — location, contact, compliance info
 *   4. Asset inspection results — per-asset condition, defects, notes, voice transcripts, photo counts
 *   5. Defect register — all defects in tabular format
 *   6. Sign-off — inspector declaration, name, signature timestamp
 *   7. Footer — page numbers, report ID, confidentiality notice
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 *
 * FIX: 3 Mar 2026
 *   - Added photoCountsByItem to ReportData for photo cross-referencing per asset
 *   - Renders "Photos: N captured" in accent green per asset when photos exist
 *
 * FIX: 4 Mar 2026
 *   - Added sanitiseForPdf() to strip non-WinAnsi characters from all dynamic text.
 *     pdf-lib StandardFonts only support WinAnsi encoding (Windows-1252). Any character
 *     outside that range (emoji, CJK, extended Unicode from Whisper/AI output) throws
 *     a silent error that was being swallowed by the catch handler.
 *   - Replaced \u26A0 (warning triangle) with '!!' — not in WinAnsi range.
 *   - Added console.error in downloadReport for debugging.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

import {
  INSPECTION_TYPE_LABELS,
  INSPECTION_TYPE_DESCRIPTIONS,
  RiskRating,
  RISK_RATING_LABELS,
  ConditionRating,
  CONDITION_LABELS,
  ACTION_TIMEFRAME_LABELS,
  COST_BAND_LABELS,
  InspectionStatus,
  INSPECTION_STATUS_LABELS,
} from '@/types';

import type {
  Inspection,
  InspectionItem,
  Site,
  Asset,
  DefectDetail,
} from '@/types';

import { getAssetTypeConfig } from '@config/assetTypes';

// =============================================
// CONFIGURATION
// =============================================

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_TOP = PAGE_HEIGHT - MARGIN_TOP;
const CONTENT_BOTTOM = MARGIN_BOTTOM + 30;

const FONT_SIZE_TITLE = 22;
const FONT_SIZE_HEADING = 14;
const FONT_SIZE_SUBHEADING = 11;
const FONT_SIZE_BODY = 9.5;
const FONT_SIZE_SMALL = 8;
const FONT_SIZE_FOOTER = 7;
const LINE_HEIGHT_MULTIPLIER = 1.4;

const COLOUR_BLACK = rgb(0, 0, 0);
const COLOUR_DARK_GREY = rgb(0.2, 0.2, 0.2);
const COLOUR_MID_GREY = rgb(0.5, 0.5, 0.5);
const COLOUR_LIGHT_GREY = rgb(0.85, 0.85, 0.85);
const COLOUR_WHITE = rgb(1, 1, 1);
const COLOUR_GREEN = rgb(0.13, 0.77, 0.37);
const COLOUR_YELLOW = rgb(0.92, 0.7, 0.03);
const COLOUR_ORANGE = rgb(0.98, 0.45, 0.09);
const COLOUR_RED = rgb(0.94, 0.27, 0.27);
const COLOUR_GREEN_BG = rgb(0.93, 0.98, 0.95);
const COLOUR_YELLOW_BG = rgb(0.99, 0.97, 0.92);
const COLOUR_ORANGE_BG = rgb(0.99, 0.95, 0.92);
const COLOUR_RED_BG = rgb(0.99, 0.93, 0.93);
const COLOUR_ACCENT = rgb(0.13, 0.77, 0.37);
const COLOUR_HEADER_BG = rgb(0.12, 0.14, 0.18);

// =============================================
// TYPES
// =============================================

interface PDFFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

interface Cursor {
  y: number;
  page: PDFPage;
  pageNumber: number;
}

export interface ReportData {
  inspection: Inspection;
  items: InspectionItem[];
  site: Site;
  assets: Asset[];
  orgName: string;
  orgLogoBase64?: string;
  /** Photo counts per inspection_item ID (from pendingPhotos in offlineStore) */
  photoCountsByItem?: Record<string, number>;
}

export interface GeneratedReport {
  pdfBytes: Uint8Array;
  filename: string;
  pageCount: number;
}

// =============================================
// WINANSI SANITISATION
// =============================================

/**
 * Characters valid in WinAnsi (Windows-1252) encoding that pdf-lib
 * StandardFonts support. Anything outside this set crashes pdf-lib silently.
 *
 * Valid ranges:
 *   - U+0020–U+007E  (basic ASCII printable)
 *   - U+00A0–U+00FF  (Latin-1 supplement)
 *   - Specific Windows-1252 extras mapped from U+0080–U+009F range:
 *     \u2026 (ellipsis), \u2014 (em dash), \u2013 (en dash), \u2018/\u2019 (quotes),
 *     \u201C/\u201D (double quotes), \u2022 (bullet), \u2122 (TM), \u00B7 (middle dot), etc.
 */
const WINANSI_EXTRAS = new Set<number>([
  0x20AC, // € Euro sign
  0x201A, // ‚ single low-9 quote
  0x0192, // ƒ latin small f with hook
  0x201E, // „ double low-9 quote
  0x2026, // … horizontal ellipsis
  0x2020, // † dagger
  0x2021, // ‡ double dagger
  0x02C6, // ˆ modifier circumflex
  0x2030, // ‰ per mille
  0x0160, // Š S with caron
  0x2039, // ‹ single left angle quote
  0x0152, // Œ OE ligature
  0x017D, // Ž Z with caron
  0x2018, // ' left single quote
  0x2019, // ' right single quote / apostrophe
  0x201C, // " left double quote
  0x201D, // " right double quote
  0x2022, // • bullet
  0x2013, // – en dash
  0x2014, // — em dash
  0x02DC, // ˜ small tilde
  0x2122, // ™ trade mark
  0x0161, // š s with caron
  0x203A, // › single right angle quote
  0x0153, // œ oe ligature
  0x017E, // ž z with caron
  0x0178, // Ÿ Y with diaeresis
]);

function isWinAnsiCodePoint(code: number): boolean {
  // Basic ASCII printable + tab/newline
  if (code === 0x09 || code === 0x0A || code === 0x0D) return true;
  if (code >= 0x20 && code <= 0x7E) return true;
  // Latin-1 supplement
  if (code >= 0xA0 && code <= 0xFF) return true;
  // Windows-1252 extras
  return WINANSI_EXTRAS.has(code);
}

/**
 * Replace common non-WinAnsi Unicode with WinAnsi equivalents,
 * then strip anything still outside the valid range.
 *
 * Applied to ALL dynamic text before passing to pdf-lib drawText().
 */
function sanitiseForPdf(text: string): string {
  // Common substitutions for characters Whisper/AI might produce
  let result = text
    .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")   // smart single quotes → ASCII apostrophe
    .replace(/[\u201C\u201D\u201F]/g, '"')            // smart double quotes → ASCII quote
    .replace(/\u2026/g, '...')                         // ellipsis → three dots
    .replace(/\u2014/g, ' - ')                         // em dash → spaced hyphen
    .replace(/\u2013/g, '-')                           // en dash → hyphen
    .replace(/\u00B0/g, ' deg ')                       // degree → text (safe in WinAnsi but sometimes garbled)
    .replace(/\u2022/g, '- ')                          // bullet → dash
    .replace(/\u00A0/g, ' ')                           // non-breaking space → regular space
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');      // zero-width chars → remove

  // Strip any remaining non-WinAnsi characters
  let cleaned = '';
  for (let i = 0; i < result.length; i++) {
    const code = result.charCodeAt(i);
    if (isWinAnsiCodePoint(code)) {
      cleaned += result[i];
    }
    // else: silently drop the character
  }

  return cleaned;
}

/** Sanitise a value that might be null/undefined */
function safe(text: string | null | undefined): string {
  return sanitiseForPdf(text ?? '');
}

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function riskColour(rating: RiskRating | string | null): ReturnType<typeof rgb> {
  switch (rating) {
    case RiskRating.VERY_HIGH: return COLOUR_RED;
    case RiskRating.HIGH: return COLOUR_ORANGE;
    case RiskRating.MEDIUM: return COLOUR_YELLOW;
    case RiskRating.LOW: return COLOUR_GREEN;
    default: return COLOUR_MID_GREY;
  }
}

function riskBgColour(rating: RiskRating | string | null): ReturnType<typeof rgb> {
  switch (rating) {
    case RiskRating.VERY_HIGH: return COLOUR_RED_BG;
    case RiskRating.HIGH: return COLOUR_ORANGE_BG;
    case RiskRating.MEDIUM: return COLOUR_YELLOW_BG;
    case RiskRating.LOW: return COLOUR_GREEN_BG;
    default: return COLOUR_LIGHT_GREY;
  }
}

function conditionColour(rating: ConditionRating | null): ReturnType<typeof rgb> {
  switch (rating) {
    case ConditionRating.GOOD: return COLOUR_GREEN;
    case ConditionRating.FAIR: return COLOUR_YELLOW;
    case ConditionRating.POOR: return COLOUR_ORANGE;
    case ConditionRating.DANGEROUS: return COLOUR_RED;
    default: return COLOUR_MID_GREY;
  }
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const sanitised = sanitiseForPdf(text);
  const lines: string[] = [];
  const paragraphs = sanitised.split('\n');
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') { lines.push(''); continue; }
    const words = paragraph.split(' ');
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function truncateText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string {
  const sanitised = sanitiseForPdf(text);
  if (font.widthOfTextAtSize(sanitised, fontSize) <= maxWidth) return sanitised;
  let truncated = sanitised;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + '...', fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

function buildFilename(site: Site, inspection: Inspection): string {
  const siteName = site.name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 40);
  const typeLabel = INSPECTION_TYPE_LABELS[inspection.inspection_type].replace(/\s+/g, '-');
  const date = inspection.inspection_date.split('T')[0] ?? inspection.inspection_date;
  return `InspectVoice-${siteName}-${typeLabel}-${date}.pdf`;
}

// =============================================
// PAGE MANAGEMENT
// =============================================

function addPage(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, reportId: string): Cursor {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const pageNumber = cursor.pageNumber + 1;
  drawFooter(page, fonts, reportId, pageNumber);
  return { y: CONTENT_TOP, page, pageNumber };
}

function ensureSpace(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, reportId: string, requiredHeight: number): Cursor {
  if (cursor.y - requiredHeight < CONTENT_BOTTOM) return addPage(doc, cursor, fonts, reportId);
  return cursor;
}

function drawFooter(page: PDFPage, fonts: PDFFonts, reportId: string, pageNumber: number): void {
  page.drawLine({
    start: { x: MARGIN_LEFT, y: MARGIN_BOTTOM + 15 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: MARGIN_BOTTOM + 15 },
    thickness: 0.5, color: COLOUR_LIGHT_GREY,
  });
  page.drawText(`Report: ${reportId}`, {
    x: MARGIN_LEFT, y: MARGIN_BOTTOM, size: FONT_SIZE_FOOTER, font: fonts.regular, color: COLOUR_MID_GREY,
  });
  const confText = 'CONFIDENTIAL - For authorised use only';
  const confWidth = fonts.italic.widthOfTextAtSize(confText, FONT_SIZE_FOOTER);
  page.drawText(confText, {
    x: (PAGE_WIDTH - confWidth) / 2, y: MARGIN_BOTTOM, size: FONT_SIZE_FOOTER, font: fonts.italic, color: COLOUR_MID_GREY,
  });
  const pageText = `Page ${pageNumber}`;
  const pageWidth = fonts.regular.widthOfTextAtSize(pageText, FONT_SIZE_FOOTER);
  page.drawText(pageText, {
    x: PAGE_WIDTH - MARGIN_RIGHT - pageWidth, y: MARGIN_BOTTOM, size: FONT_SIZE_FOOTER, font: fonts.regular, color: COLOUR_MID_GREY,
  });
}

// =============================================
// DRAWING HELPERS
// =============================================

function drawSectionHeading(cursor: Cursor, fonts: PDFFonts, title: string): Cursor {
  const lineHeight = FONT_SIZE_HEADING * LINE_HEIGHT_MULTIPLIER;
  cursor.page.drawRectangle({ x: MARGIN_LEFT, y: cursor.y - lineHeight + 2, width: 3, height: lineHeight, color: COLOUR_ACCENT });
  cursor.page.drawText(title.toUpperCase(), {
    x: MARGIN_LEFT + 10, y: cursor.y - FONT_SIZE_HEADING + 2, size: FONT_SIZE_HEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
  });
  cursor.page.drawLine({
    start: { x: MARGIN_LEFT, y: cursor.y - lineHeight - 2 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: cursor.y - lineHeight - 2 },
    thickness: 0.5, color: COLOUR_LIGHT_GREY,
  });
  return { ...cursor, y: cursor.y - lineHeight - 12 };
}

function drawLabelValue(cursor: Cursor, fonts: PDFFonts, label: string, value: string, labelWidth: number = 140): Cursor {
  const lineHeight = FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER;
  cursor.page.drawText(label, {
    x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_MID_GREY,
  });
  const safeValue = sanitiseForPdf(value || '-');
  const valueLines = wrapText(safeValue, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH - labelWidth);
  for (let i = 0; i < valueLines.length; i++) {
    cursor.page.drawText(valueLines[i] ?? '', {
      x: MARGIN_LEFT + labelWidth, y: cursor.y - FONT_SIZE_BODY - (i * lineHeight), size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_BLACK,
    });
  }
  const totalHeight = Math.max(1, valueLines.length) * lineHeight + 2;
  return { ...cursor, y: cursor.y - totalHeight };
}

function drawBadge(page: PDFPage, fonts: PDFFonts, text: string, x: number, y: number, textColour: ReturnType<typeof rgb>, bgColour: ReturnType<typeof rgb>): void {
  const fontSize = FONT_SIZE_SMALL;
  const safeText = sanitiseForPdf(text);
  const textWidth = fonts.bold.widthOfTextAtSize(safeText, fontSize);
  const padding = 6;
  const badgeWidth = textWidth + padding * 2;
  const badgeHeight = fontSize + 6;
  page.drawRectangle({ x, y: y - 2, width: badgeWidth, height: badgeHeight, color: bgColour, borderColor: textColour, borderWidth: 0.5 });
  page.drawText(safeText, { x: x + padding, y: y + 2, size: fontSize, font: fonts.bold, color: textColour });
}

function drawHorizontalRule(cursor: Cursor): Cursor {
  cursor.page.drawLine({
    start: { x: MARGIN_LEFT, y: cursor.y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: cursor.y },
    thickness: 0.5, color: COLOUR_LIGHT_GREY,
  });
  return { ...cursor, y: cursor.y - 8 };
}

// =============================================
// SECTION RENDERERS
// =============================================

function renderCoverPage(cursor: Cursor, fonts: PDFFonts, data: ReportData): Cursor {
  const { inspection, site } = data;

  cursor.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 180, width: PAGE_WIDTH, height: 180, color: COLOUR_HEADER_BG });

  cursor.page.drawText(sanitiseForPdf(data.orgName || 'InspectVoice'), {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 60, size: 12, font: fonts.bold, color: COLOUR_ACCENT,
  });
  cursor.page.drawText('INSPECTION REPORT', {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 90, size: FONT_SIZE_TITLE, font: fonts.bold, color: COLOUR_WHITE,
  });

  const typeLabel = INSPECTION_TYPE_LABELS[inspection.inspection_type];
  cursor.page.drawText(typeLabel, {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 118, size: 16, font: fonts.regular, color: COLOUR_GREEN,
  });

  const typeDesc = INSPECTION_TYPE_DESCRIPTIONS[inspection.inspection_type];
  const descLines = wrapText(typeDesc, fonts.italic, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (let i = 0; i < descLines.length; i++) {
    cursor.page.drawText(descLines[i] ?? '', {
      x: MARGIN_LEFT, y: PAGE_HEIGHT - 140 - (i * FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER),
      size: FONT_SIZE_BODY, font: fonts.italic, color: rgb(0.7, 0.7, 0.7),
    });
  }

  cursor.page.drawText('Conducted in accordance with BS EN 1176-7:2020', {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 170, size: FONT_SIZE_SMALL, font: fonts.italic, color: rgb(0.6, 0.6, 0.6),
  });

  let y = PAGE_HEIGHT - 220;
  cursor.page.drawText(sanitiseForPdf(site.name), { x: MARGIN_LEFT, y, size: 18, font: fonts.bold, color: COLOUR_DARK_GREY });
  y -= 24;

  const addressLines = wrapText(site.address, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (const line of addressLines) {
    cursor.page.drawText(line, { x: MARGIN_LEFT, y, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_MID_GREY });
    y -= FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER;
  }
  if (site.postcode) {
    cursor.page.drawText(sanitiseForPdf(site.postcode), { x: MARGIN_LEFT, y, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_MID_GREY });
    y -= FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER;
  }
  y -= 20;

  const infoItems: Array<[string, string]> = [
    ['Report ID', inspection.id.substring(0, 8).toUpperCase()],
    ['Inspection Date', formatDate(inspection.inspection_date)],
    ['Inspector', safe(inspection.signed_by) || '-'],
    ['Status', INSPECTION_STATUS_LABELS[inspection.status]],
    ['Duration', inspection.duration_minutes ? `${inspection.duration_minutes} minutes` : '-'],
    ['Weather', safe(inspection.weather_conditions) || '-'],
    ['Surface', safe(inspection.surface_conditions) || '-'],
    ['Assets', `${data.items.length} inspected`],
  ];

  const colWidth = CONTENT_WIDTH / 2;
  for (let i = 0; i < infoItems.length; i++) {
    const [label, value] = infoItems[i]!;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN_LEFT + (col * colWidth);
    const rowY = y - (row * (FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER * 2 + 4));
    cursor.page.drawText(label, { x, y: rowY, size: FONT_SIZE_SMALL, font: fonts.bold, color: COLOUR_MID_GREY });
    cursor.page.drawText(sanitiseForPdf(value), { x, y: rowY - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_BLACK });
  }

  const gridRows = Math.ceil(infoItems.length / 2);
  y -= gridRows * (FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER * 2 + 4) + 20;

  if (inspection.closure_recommended || inspection.immediate_action_required) {
    cursor.page.drawRectangle({ x: MARGIN_LEFT, y: y - 40, width: CONTENT_WIDTH, height: 40, color: COLOUR_RED_BG, borderColor: COLOUR_RED, borderWidth: 1 });
    const warningText = inspection.closure_recommended
      ? '!! CLOSURE RECOMMENDED - Dangerous conditions identified'
      : '!! IMMEDIATE ACTION REQUIRED - High risk items identified';
    cursor.page.drawText(warningText, { x: MARGIN_LEFT + 12, y: y - 26, size: FONT_SIZE_SUBHEADING, font: fonts.bold, color: COLOUR_RED });
    y -= 60;
  }

  return { ...cursor, y };
}

function renderExecutiveSummary(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = ensureSpace(doc, cursor, fonts, reportId, 200);
  cursor = drawSectionHeading(cursor, fonts, 'Executive Summary');

  const { inspection, items } = data;
  const boxWidth = CONTENT_WIDTH / 4 - 4;
  const boxHeight = 50;
  const riskData: Array<[string, number, ReturnType<typeof rgb>, ReturnType<typeof rgb>]> = [
    ['Very High', inspection.very_high_risk_count, COLOUR_RED, COLOUR_RED_BG],
    ['High', inspection.high_risk_count, COLOUR_ORANGE, COLOUR_ORANGE_BG],
    ['Medium', inspection.medium_risk_count, COLOUR_YELLOW, COLOUR_YELLOW_BG],
    ['Low', inspection.low_risk_count, COLOUR_GREEN, COLOUR_GREEN_BG],
  ];

  for (let i = 0; i < riskData.length; i++) {
    const [label, count, textCol, bgCol] = riskData[i]!;
    const x = MARGIN_LEFT + i * (boxWidth + 5);
    cursor.page.drawRectangle({ x, y: cursor.y - boxHeight, width: boxWidth, height: boxHeight, color: bgCol, borderColor: textCol, borderWidth: 0.5 });
    const countStr = String(count);
    const countWidth = fonts.bold.widthOfTextAtSize(countStr, 20);
    cursor.page.drawText(countStr, { x: x + (boxWidth - countWidth) / 2, y: cursor.y - 22, size: 20, font: fonts.bold, color: textCol });
    const labelWidth = fonts.regular.widthOfTextAtSize(label, FONT_SIZE_SMALL);
    cursor.page.drawText(label, { x: x + (boxWidth - labelWidth) / 2, y: cursor.y - 40, size: FONT_SIZE_SMALL, font: fonts.regular, color: textCol });
  }

  cursor = { ...cursor, y: cursor.y - boxHeight - 16 };

  const conditionCounts = {
    good: items.filter((i) => i.overall_condition === ConditionRating.GOOD).length,
    fair: items.filter((i) => i.overall_condition === ConditionRating.FAIR).length,
    poor: items.filter((i) => i.overall_condition === ConditionRating.POOR).length,
    dangerous: items.filter((i) => i.overall_condition === ConditionRating.DANGEROUS).length,
  };

  cursor = drawLabelValue(cursor, fonts, 'Assets Inspected', String(items.length));
  cursor = drawLabelValue(cursor, fonts, 'Total Defects', String(inspection.total_defects));
  cursor = drawLabelValue(cursor, fonts, 'Condition Breakdown',
    `Good: ${conditionCounts.good} / Fair: ${conditionCounts.fair} / Poor: ${conditionCounts.poor} / Dangerous: ${conditionCounts.dangerous}`);

  if (inspection.immediate_action_required) {
    cursor = drawLabelValue(cursor, fonts, 'Immediate Action', 'REQUIRED - see defect register');
  }
  if (inspection.closure_recommended && inspection.closure_reason) {
    cursor = drawLabelValue(cursor, fonts, 'Closure Reason', safe(inspection.closure_reason));
  }

  if (inspection.inspector_summary) {
    cursor = ensureSpace(doc, cursor, fonts, reportId, 60);
    cursor = { ...cursor, y: cursor.y - 8 };
    cursor.page.drawText('Inspector Summary', {
      x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_SUBHEADING, size: FONT_SIZE_SUBHEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
    });
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_SUBHEADING * LINE_HEIGHT_MULTIPLIER - 4 };
    const summaryLines = wrapText(inspection.inspector_summary, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
    for (const line of summaryLines) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
      cursor.page.drawText(line, { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
    }
  }

  cursor = { ...cursor, y: cursor.y - 12 };
  return cursor;
}

function renderSiteDetails(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = ensureSpace(doc, cursor, fonts, reportId, 160);
  cursor = drawSectionHeading(cursor, fonts, 'Site Details');
  const { site } = data;
  cursor = drawLabelValue(cursor, fonts, 'Site Name', safe(site.name));
  cursor = drawLabelValue(cursor, fonts, 'Address', `${safe(site.address)}${site.postcode ? ', ' + safe(site.postcode) : ''}`);
  cursor = drawLabelValue(cursor, fonts, 'Coordinates', `${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}`);
  if (site.contact_name) cursor = drawLabelValue(cursor, fonts, 'Contact', safe(site.contact_name));
  if (site.contact_phone) cursor = drawLabelValue(cursor, fonts, 'Phone', safe(site.contact_phone));
  if (site.contact_email) cursor = drawLabelValue(cursor, fonts, 'Email', safe(site.contact_email));
  if (site.access_notes) cursor = drawLabelValue(cursor, fonts, 'Access Notes', safe(site.access_notes));
  cursor = { ...cursor, y: cursor.y - 12 };
  return cursor;
}

function renderAssetResults(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = ensureSpace(doc, cursor, fonts, reportId, 80);
  cursor = drawSectionHeading(cursor, fonts, 'Asset Inspection Results');

  const { items, assets } = data;
  const assetMap = new Map<string, Asset>();
  for (const asset of assets) {
    assetMap.set(asset.id, asset);
    assetMap.set(asset.asset_code, asset);
  }

  const sortedItems = [...items].sort((a, b) => a.asset_code.localeCompare(b.asset_code));

  for (let idx = 0; idx < sortedItems.length; idx++) {
    const item = sortedItems[idx]!;
    const asset = assetMap.get(item.asset_id ?? '') ?? assetMap.get(item.asset_code);
    const config = getAssetTypeConfig(item.asset_type);
    const typeName = config?.name ?? item.asset_type;

    const estimatedHeight = 80 + (item.defects.length * 50) + (item.inspector_notes ? 40 : 0);
    cursor = ensureSpace(doc, cursor, fonts, reportId, Math.min(estimatedHeight, 200));

    const headerHeight = 22;
    cursor.page.drawRectangle({ x: MARGIN_LEFT, y: cursor.y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: rgb(0.95, 0.95, 0.95) });
    cursor.page.drawText(sanitiseForPdf(`${item.asset_code} - ${typeName}`), {
      x: MARGIN_LEFT + 6, y: cursor.y - 15, size: FONT_SIZE_SUBHEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
    });

    if (item.overall_condition) {
      const condLabel = CONDITION_LABELS[item.overall_condition];
      drawBadge(cursor.page, fonts, condLabel, PAGE_WIDTH - MARGIN_RIGHT - 80, cursor.y - 16, conditionColour(item.overall_condition), riskBgColour(item.risk_rating));
    }

    cursor = { ...cursor, y: cursor.y - headerHeight - 8 };

    if (config?.complianceStandard) {
      cursor.page.drawText(sanitiseForPdf(config.complianceStandard), { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_ACCENT });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 2 };
    }

    if (asset?.manufacturer) {
      const mfgParts = [asset.manufacturer, asset.model, asset.serial_number].filter(Boolean);
      const mfgText = sanitiseForPdf(mfgParts.join(' / '));
      cursor.page.drawText(mfgText, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_MID_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 2 };
    }

    // Photo count (from local capture via pendingPhotos)
    const photoCount = data.photoCountsByItem?.[item.id] ?? 0;
    if (photoCount > 0) {
      const photoText = `Photos: ${String(photoCount)} captured`;
      cursor.page.drawText(photoText, {
        x: MARGIN_LEFT + 6,
        y: cursor.y - FONT_SIZE_SMALL,
        size: FONT_SIZE_SMALL,
        font: fonts.regular,
        color: COLOUR_ACCENT,
      });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 2 };
    }

    if (item.voice_transcript) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 40);
      cursor.page.drawText('Voice Observation:', { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_DARK_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      const transcriptLines = wrapText(item.voice_transcript, fonts.italic, FONT_SIZE_BODY, CONTENT_WIDTH - 12);
      for (const line of transcriptLines) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
        cursor.page.drawText(line, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.italic, color: COLOUR_DARK_GREY });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      }
      cursor = { ...cursor, y: cursor.y - 4 };
    }

    if (item.inspector_notes) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 40);
      cursor.page.drawText('Inspector Notes:', { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_DARK_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      const noteLines = wrapText(item.inspector_notes, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH - 12);
      for (const line of noteLines) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
        cursor.page.drawText(line, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      }
      cursor = { ...cursor, y: cursor.y - 4 };
    }

    if (item.defects.length > 0) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 30);
      cursor.page.drawText(`Defects (${item.defects.length}):`, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_ORANGE });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER - 4 };
      for (const defect of item.defects) {
        cursor = renderDefectBlock(doc, cursor, fonts, defect, reportId);
      }
    }

    if (idx < sortedItems.length - 1) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 12);
      cursor = drawHorizontalRule(cursor);
    }
  }

  cursor = { ...cursor, y: cursor.y - 12 };
  return cursor;
}

function renderDefectBlock(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, defect: DefectDetail, reportId: string): Cursor {
  cursor = ensureSpace(doc, cursor, fonts, reportId, 60);
  const lineHeight = FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER;
  const indent = MARGIN_LEFT + 12;

  const riskLabel = RISK_RATING_LABELS[defect.risk_rating] ?? 'Unknown';
  drawBadge(cursor.page, fonts, riskLabel, indent, cursor.y - FONT_SIZE_BODY - 1, riskColour(defect.risk_rating), riskBgColour(defect.risk_rating));

  const badgeOffset = fonts.bold.widthOfTextAtSize(sanitiseForPdf(riskLabel), FONT_SIZE_SMALL) + 20;
  const descLines = wrapText(defect.description, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH - 24 - badgeOffset);

  for (let i = 0; i < descLines.length; i++) {
    const xPos = i === 0 ? indent + badgeOffset : indent;
    cursor.page.drawText(descLines[i] ?? '', { x: xPos, y: cursor.y - FONT_SIZE_BODY - (i * lineHeight), size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
  }
  cursor = { ...cursor, y: cursor.y - (Math.max(1, descLines.length) * lineHeight) - 2 };

  const metaItems: string[] = [];
  if (defect.bs_en_reference) metaItems.push(`Ref: ${safe(defect.bs_en_reference)}`);
  if (defect.remedial_action) metaItems.push(`Action: ${safe(defect.remedial_action).substring(0, 80)}`);
  if (defect.action_timeframe) metaItems.push(`Timeframe: ${ACTION_TIMEFRAME_LABELS[defect.action_timeframe] ?? defect.action_timeframe}`);
  if (defect.estimated_cost_band) metaItems.push(`Est. Cost: ${COST_BAND_LABELS[defect.estimated_cost_band] ?? defect.estimated_cost_band}`);

  if (metaItems.length > 0) {
    const metaText = metaItems.join(' / ');
    const metaLines = wrapText(metaText, fonts.regular, FONT_SIZE_SMALL, CONTENT_WIDTH - 24);
    for (const line of metaLines) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, lineHeight);
      cursor.page.drawText(line, { x: indent, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_MID_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER };
    }
  }

  cursor = { ...cursor, y: cursor.y - 6 };
  return cursor;
}

function renderDefectRegister(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  const allDefects: Array<{ assetCode: string; defect: DefectDetail }> = [];
  for (const item of data.items) {
    for (const defect of item.defects) {
      allDefects.push({ assetCode: item.asset_code, defect });
    }
  }
  if (allDefects.length === 0) return cursor;

  const riskOrder: Record<string, number> = {
    [RiskRating.VERY_HIGH]: 0, [RiskRating.HIGH]: 1, [RiskRating.MEDIUM]: 2, [RiskRating.LOW]: 3,
  };
  allDefects.sort((a, b) => (riskOrder[a.defect.risk_rating] ?? 4) - (riskOrder[b.defect.risk_rating] ?? 4));

  cursor = ensureSpace(doc, cursor, fonts, reportId, 80);
  cursor = drawSectionHeading(cursor, fonts, 'Defect Register');

  const colWidths = [50, 50, 190, 90, 70, 45];
  const headers = ['Asset', 'Risk', 'Description', 'Action', 'Timeframe', 'Cost'];
  const rowHeight = 18;

  function drawTableHeader(c: Cursor): Cursor {
    c.page.drawRectangle({ x: MARGIN_LEFT, y: c.y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: rgb(0.93, 0.93, 0.93) });
    let xPos = MARGIN_LEFT + 4;
    for (let i = 0; i < headers.length; i++) {
      c.page.drawText(headers[i]!, { x: xPos, y: c.y - 13, size: FONT_SIZE_SMALL, font: fonts.bold, color: COLOUR_DARK_GREY });
      xPos += colWidths[i]!;
    }
    return { ...c, y: c.y - rowHeight };
  }

  cursor = drawTableHeader(cursor);

  for (const { assetCode, defect } of allDefects) {
    cursor = ensureSpace(doc, cursor, fonts, reportId, rowHeight + 4);
    if (cursor.y > CONTENT_TOP - 5) cursor = drawTableHeader(cursor);

    const rowY = cursor.y;
    cursor.page.drawRectangle({ x: MARGIN_LEFT, y: rowY - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: riskBgColour(defect.risk_rating) });

    let xPos = MARGIN_LEFT + 4;
    cursor.page.drawText(truncateText(assetCode, fonts.mono, FONT_SIZE_SMALL, colWidths[0]! - 8), { x: xPos, y: rowY - 13, size: FONT_SIZE_SMALL, font: fonts.mono, color: COLOUR_DARK_GREY });
    xPos += colWidths[0]!;
    cursor.page.drawText(sanitiseForPdf(RISK_RATING_LABELS[defect.risk_rating] ?? '-'), { x: xPos, y: rowY - 13, size: FONT_SIZE_SMALL, font: fonts.bold, color: riskColour(defect.risk_rating) });
    xPos += colWidths[1]!;
    cursor.page.drawText(truncateText(defect.description, fonts.regular, FONT_SIZE_SMALL, colWidths[2]! - 8), { x: xPos, y: rowY - 13, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_DARK_GREY });
    xPos += colWidths[2]!;
    cursor.page.drawText(truncateText(defect.remedial_action ?? '-', fonts.regular, FONT_SIZE_SMALL, colWidths[3]! - 8), { x: xPos, y: rowY - 13, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_DARK_GREY });
    xPos += colWidths[3]!;
    cursor.page.drawText(truncateText(ACTION_TIMEFRAME_LABELS[defect.action_timeframe] ?? '-', fonts.regular, FONT_SIZE_SMALL, colWidths[4]! - 8), { x: xPos, y: rowY - 13, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_DARK_GREY });
    xPos += colWidths[4]!;
    cursor.page.drawText(sanitiseForPdf(COST_BAND_LABELS[defect.estimated_cost_band] ?? '-'), { x: xPos, y: rowY - 13, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_DARK_GREY });

    cursor = { ...cursor, y: rowY - rowHeight };
  }

  cursor = { ...cursor, y: cursor.y - 12 };
  return cursor;
}

function renderSignOff(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = ensureSpace(doc, cursor, fonts, reportId, 180);
  cursor = drawSectionHeading(cursor, fonts, 'Declaration & Sign-Off');

  const { inspection } = data;
  const declaration =
    'I declare that this inspection has been carried out in accordance with BS EN 1176-7:2020. ' +
    'All observations have been made to the best of my professional ability and the findings recorded ' +
    'in this report are an accurate representation of the condition of the equipment and surfacing ' +
    'at the time of inspection. This report should be read in conjunction with any previous inspection ' +
    'reports and manufacturer maintenance instructions.';

  const declLines = wrapText(declaration, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (const line of declLines) {
    cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
    cursor.page.drawText(line, { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
  }

  cursor = { ...cursor, y: cursor.y - 20 };

  if (inspection.status === InspectionStatus.SIGNED || inspection.status === InspectionStatus.EXPORTED) {
    cursor = drawLabelValue(cursor, fonts, 'Signed By', safe(inspection.signed_by) || '-');
    cursor = drawLabelValue(cursor, fonts, 'Signed At', formatDateTime(inspection.signed_at));

    cursor = { ...cursor, y: cursor.y - 20 };
    cursor.page.drawLine({ start: { x: MARGIN_LEFT, y: cursor.y }, end: { x: MARGIN_LEFT + 200, y: cursor.y }, thickness: 1, color: COLOUR_BLACK });
    cursor.page.drawText('Inspector Signature', { x: MARGIN_LEFT, y: cursor.y - 12, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY });

    cursor.page.drawLine({ start: { x: MARGIN_LEFT + 260, y: cursor.y }, end: { x: MARGIN_LEFT + 400, y: cursor.y }, thickness: 1, color: COLOUR_BLACK });
    cursor.page.drawText('Date', { x: MARGIN_LEFT + 260, y: cursor.y - 12, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY });

    cursor = { ...cursor, y: cursor.y - 30 };
    cursor.page.drawText(
      'This report was digitally signed and is immutable. Any modifications will require a new inspection.',
      { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY },
    );
  } else {
    cursor.page.drawText('DRAFT - This inspection has not yet been signed off.', {
      x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_SUBHEADING, size: FONT_SIZE_SUBHEADING, font: fonts.bold, color: COLOUR_ORANGE,
    });
  }

  return cursor;
}

// =============================================
// MAIN GENERATOR
// =============================================

export async function generateInspectionReport(data: ReportData): Promise<GeneratedReport> {
  const doc = await PDFDocument.create();
  const reportId = data.inspection.id.substring(0, 8).toUpperCase();

  const fonts: PDFFonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  doc.setTitle(`Inspection Report - ${sanitiseForPdf(data.site.name)}`);
  doc.setSubject(`${INSPECTION_TYPE_LABELS[data.inspection.inspection_type]} Inspection`);
  doc.setAuthor(sanitiseForPdf(data.inspection.signed_by ?? data.orgName));
  doc.setCreator('InspectVoice');
  doc.setProducer('InspectVoice PDF Generator (pdf-lib)');
  doc.setCreationDate(new Date());

  const firstPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawFooter(firstPage, fonts, reportId, 1);

  let cursor: Cursor = { y: CONTENT_TOP, page: firstPage, pageNumber: 1 };

  cursor = renderCoverPage(cursor, fonts, data);
  cursor = addPage(doc, cursor, fonts, reportId);
  cursor = renderExecutiveSummary(doc, cursor, fonts, data, reportId);
  cursor = renderSiteDetails(doc, cursor, fonts, data, reportId);
  cursor = renderAssetResults(doc, cursor, fonts, data, reportId);
  cursor = renderDefectRegister(doc, cursor, fonts, data, reportId);
  cursor = renderSignOff(doc, cursor, fonts, data, reportId);

  const totalPages = doc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = doc.getPage(i);
    const pageNum = i + 1;
    const pageText = `Page ${pageNum} of ${totalPages}`;
    const pageWidth = fonts.regular.widthOfTextAtSize(pageText, FONT_SIZE_FOOTER);
    page.drawRectangle({
      x: PAGE_WIDTH - MARGIN_RIGHT - pageWidth - 5, y: MARGIN_BOTTOM - 3,
      width: pageWidth + 10, height: FONT_SIZE_FOOTER + 6, color: COLOUR_WHITE,
    });
    page.drawText(pageText, {
      x: PAGE_WIDTH - MARGIN_RIGHT - pageWidth, y: MARGIN_BOTTOM,
      size: FONT_SIZE_FOOTER, font: fonts.regular, color: COLOUR_MID_GREY,
    });
  }

  const pdfBytes = await doc.save();
  const filename = buildFilename(data.site, data.inspection);
  return { pdfBytes, filename, pageCount: totalPages };
}

export async function generateReportBlob(data: ReportData): Promise<{ blob: Blob; filename: string; pageCount: number }> {
  const report = await generateInspectionReport(data);
  const blob = new Blob([report.pdfBytes as BlobPart], { type: 'application/pdf' });
  return { blob, filename: report.filename, pageCount: report.pageCount };
}

export async function downloadReport(data: ReportData): Promise<void> {
  const { blob, filename } = await generateReportBlob(data);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}
