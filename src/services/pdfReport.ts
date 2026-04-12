/**
 * InspectVoice — PDF Report Generator (Client-Side)
 * Premium BS EN 1176-compliant inspection report output.
 * Uses pdf-lib (never jspdf) per build standard.
 *
 * Report structure (each major section starts on a fresh page):
 *   Page 1:  Cover page — org branding, site, inspector, metadata
 *   Page 2:  Table of Contents
 *   Page 3:  1.0 Executive Summary — risk boxes, condition breakdown, closure warnings
 *   Page 4:  2.0 Site Details — location, contact, compliance info
 *   Page 5:  3.0 Inspection Methodology — what was checked and how
 *   Page 6+: 4.0 Asset Inspection Results — one asset per page start
 *   Page N:  5.0 Defect Register — tabular summary of all defects
 *   Page N+1: 6.0 Declaration & Sign-Off — inspector declaration, signature
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
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
  ChecklistData,
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
const COLOUR_SECTION_BG = rgb(0.97, 0.97, 0.97);

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
  orgBrandColour?: string;
  photoCountsByItem?: Record<string, number>;
  photosByItem?: Record<string, string[]>;
}

export interface GeneratedReport {
  pdfBytes: Uint8Array;
  filename: string;
  pageCount: number;
}

// =============================================
// WINANSI SANITISATION
// =============================================
const WINANSI_EXTRAS = new Set<number>([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C,
  0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
  0x0153, 0x017E, 0x0178,
]);

function isWinAnsiCodePoint(code: number): boolean {
  if (code === 0x09 || code === 0x0A || code === 0x0D) return true;
  if (code >= 0x20 && code <= 0x7E) return true;
  if (code >= 0xA0 && code <= 0xFF) return true;
  return WINANSI_EXTRAS.has(code);
}

function sanitiseForPdf(text: string): string {
  let result = text
    .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/\u00B0/g, ' deg ')
    .replace(/\u2022/g, '- ')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  let cleaned = '';
  for (let i = 0; i < result.length; i++) {
    const code = result.charCodeAt(i);
    if (isWinAnsiCodePoint(code)) {
      cleaned += result[i];
    }
  }
  return cleaned;
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return COLOUR_ACCENT;
  return rgb(r, g, b);
}

function hexToBgRgb(hex: string): ReturnType<typeof rgb> {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return COLOUR_HEADER_BG;
  return rgb(r * 0.25, g * 0.25, b * 0.25);
}

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
function drawSectionHeading(cursor: Cursor, fonts: PDFFonts, sectionNumber: string, title: string): Cursor {
  const lineHeight = FONT_SIZE_HEADING * LINE_HEIGHT_MULTIPLIER;
  const fullTitle = `${sectionNumber}  ${title}`.toUpperCase();
  cursor.page.drawRectangle({ x: MARGIN_LEFT, y: cursor.y - lineHeight + 2, width: 4, height: lineHeight, color: COLOUR_ACCENT });
  cursor.page.drawText(sanitiseForPdf(fullTitle), {
    x: MARGIN_LEFT + 12, y: cursor.y - FONT_SIZE_HEADING + 2, size: FONT_SIZE_HEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
  });
  cursor.page.drawLine({
    start: { x: MARGIN_LEFT, y: cursor.y - lineHeight - 4 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: cursor.y - lineHeight - 4 },
    thickness: 0.5, color: COLOUR_LIGHT_GREY,
  });
  return { ...cursor, y: cursor.y - lineHeight - 16 };
}

function drawSectionIntro(cursor: Cursor, fonts: PDFFonts, text: string): Cursor {
  const lines = wrapText(text, fonts.italic, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (const line of lines) {
    cursor.page.drawText(line, {
      x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.italic, color: COLOUR_MID_GREY,
    });
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
  }
  return { ...cursor, y: cursor.y - 8 };
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
  return { ...cursor, y: cursor.y - 10 };
}

// =============================================
// COVER PAGE
// =============================================
async function renderCoverPage(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData): Promise<Cursor> {
  const { inspection, site } = data;
  const brandColour = data.orgBrandColour ? hexToRgb(data.orgBrandColour) : COLOUR_ACCENT;
  const headerBg = data.orgBrandColour ? hexToBgRgb(data.orgBrandColour) : COLOUR_HEADER_BG;

  cursor.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 180, width: PAGE_WIDTH, height: 180, color: headerBg });
  cursor.page.drawText(sanitiseForPdf(data.orgName || 'InspectVoice'), {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 60, size: 12, font: fonts.bold, color: brandColour,
  });
  cursor.page.drawText('INSPECTION REPORT', {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 90, size: FONT_SIZE_TITLE, font: fonts.bold, color: COLOUR_WHITE,
  });
  const typeLabel = INSPECTION_TYPE_LABELS[inspection.inspection_type];
  cursor.page.drawText(typeLabel, {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 118, size: 16, font: fonts.regular, color: brandColour,
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

  if (data.orgLogoBase64) {
    try {
      const logoClean = data.orgLogoBase64.includes(',')
        ? data.orgLogoBase64.split(',')[1] ?? data.orgLogoBase64
        : data.orgLogoBase64;
      const logoBytes = Uint8Array.from(atob(logoClean), (c) => c.charCodeAt(0));
      const isJpeg = data.orgLogoBase64.includes('image/jpeg') || data.orgLogoBase64.includes('image/jpg');
      const logoImage = isJpeg ? await doc.embedJpg(logoBytes) : await doc.embedPng(logoBytes);
      const scaled = logoImage.scaleToFit(80, 50);
      cursor.page.drawImage(logoImage, {
        x: PAGE_WIDTH - MARGIN_RIGHT - scaled.width,
        y: PAGE_HEIGHT - 30 - scaled.height,
        width: scaled.width, height: scaled.height,
      });
    } catch { /* Logo embed failed */ }
  }

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

// =============================================
// TABLE OF CONTENTS
// =============================================
function renderTableOfContents(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = addPage(doc, cursor, fonts, reportId);

  cursor.page.drawText('TABLE OF CONTENTS', {
    x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_HEADING, size: FONT_SIZE_HEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
  });
  cursor.page.drawLine({
    start: { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_HEADING * LINE_HEIGHT_MULTIPLIER - 4 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: cursor.y - FONT_SIZE_HEADING * LINE_HEIGHT_MULTIPLIER - 4 },
    thickness: 0.5, color: COLOUR_LIGHT_GREY,
  });
  cursor = { ...cursor, y: cursor.y - FONT_SIZE_HEADING * LINE_HEIGHT_MULTIPLIER - 24 };

  const tocItems: Array<[string, string]> = [
    ['1.0', 'Executive Summary'],
    ['2.0', 'Site Details'],
    ['3.0', 'Inspection Methodology'],
    ['4.0', 'Asset Inspection Results'],
  ];

  const sortedItems = [...data.items].sort((a, b) => a.asset_code.localeCompare(b.asset_code));
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i]!;
    const config = getAssetTypeConfig(item.asset_type);
    const typeName = config?.name ?? item.asset_type;
    tocItems.push([`4.${i + 1}`, `${item.asset_code} - ${typeName}`]);
  }

  const allDefects = data.items.flatMap((i) => i.defects);
  if (allDefects.length > 0) {
    tocItems.push(['5.0', 'Defect Register']);
    tocItems.push(['6.0', 'Declaration & Sign-Off']);
  } else {
    tocItems.push(['5.0', 'Declaration & Sign-Off']);
  }

  const lineHeight = FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 6;
  for (const [number, title] of tocItems) {
    const isSubSection = number.includes('.') && !number.endsWith('.0');
    const indent = isSubSection ? 20 : 0;
    const font = isSubSection ? fonts.regular : fonts.bold;
    const colour = isSubSection ? COLOUR_MID_GREY : COLOUR_DARK_GREY;

    cursor.page.drawText(sanitiseForPdf(number), {
      x: MARGIN_LEFT + indent, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_ACCENT,
    });
    cursor.page.drawText(sanitiseForPdf(title), {
      x: MARGIN_LEFT + indent + 40, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font, color: colour,
    });

    const titleWidth = font.widthOfTextAtSize(sanitiseForPdf(title), FONT_SIZE_BODY);
    const dotsStart = MARGIN_LEFT + indent + 40 + titleWidth + 8;
    const dotsEnd = PAGE_WIDTH - MARGIN_RIGHT;
    if (dotsEnd > dotsStart + 20) {
      let dotX = dotsStart;
      while (dotX < dotsEnd) {
        cursor.page.drawText('.', { x: dotX, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_LIGHT_GREY });
        dotX += 4;
      }
    }
    cursor = { ...cursor, y: cursor.y - lineHeight };
  }

  return cursor;
}

// =============================================
// 1.0 EXECUTIVE SUMMARY
// =============================================
function renderExecutiveSummary(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = addPage(doc, cursor, fonts, reportId);
  cursor = drawSectionHeading(cursor, fonts, '1.0', 'Executive Summary');
  cursor = drawSectionIntro(cursor, fonts,
    'Overview of inspection findings including risk severity distribution, asset condition breakdown, and any immediate action requirements.',
  );

  const { inspection, items } = data;
  const boxWidth = CONTENT_WIDTH / 4 - 4;
  const boxHeight = 50;
  const allDefects = items.flatMap((i) => i.defects);

  // Use inspection-level counts as the authoritative source — these are written
  // from local in-memory data at sign-off time and are always correct.
  // Fall back to recalculating from items only if the inspection record
  // has no counts yet (e.g. unsigned draft preview).
  const totalDefectsForCounts = allDefects.length;
  const useInspectionCounts = (
    inspection.very_high_risk_count > 0 ||
    inspection.high_risk_count > 0 ||
    inspection.medium_risk_count > 0 ||
    inspection.low_risk_count > 0
  );
  const riskData: Array<[string, number, ReturnType<typeof rgb>, ReturnType<typeof rgb>]> = [
    [
      'Very High',
      useInspectionCounts
        ? inspection.very_high_risk_count
        : allDefects.filter((d) => d.risk_rating === RiskRating.VERY_HIGH).length,
      COLOUR_RED, COLOUR_RED_BG,
    ],
    [
      'High',
      useInspectionCounts
        ? inspection.high_risk_count
        : allDefects.filter((d) => d.risk_rating === RiskRating.HIGH).length,
      COLOUR_ORANGE, COLOUR_ORANGE_BG,
    ],
    [
      'Medium',
      useInspectionCounts
        ? inspection.medium_risk_count
        : allDefects.filter((d) => d.risk_rating === RiskRating.MEDIUM).length,
      COLOUR_YELLOW, COLOUR_YELLOW_BG,
    ],
    [
      'Low',
      useInspectionCounts
        ? inspection.low_risk_count
        : allDefects.filter((d) => d.risk_rating === RiskRating.LOW).length,
      COLOUR_GREEN, COLOUR_GREEN_BG,
    ],
  ];
  void totalDefectsForCounts; // used below for condition breakdown

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
  cursor = { ...cursor, y: cursor.y - boxHeight - 20 };

  const cc = {
    good: items.filter((i) => i.overall_condition === ConditionRating.GOOD).length,
    fair: items.filter((i) => i.overall_condition === ConditionRating.FAIR).length,
    poor: items.filter((i) => i.overall_condition === ConditionRating.POOR).length,
    dangerous: items.filter((i) => i.overall_condition === ConditionRating.DANGEROUS).length,
  };

  cursor = drawLabelValue(cursor, fonts, 'Assets Inspected', String(items.length));
  cursor = drawLabelValue(cursor, fonts, 'Total Defects', String(allDefects.length));
  cursor = drawLabelValue(cursor, fonts, 'Condition Breakdown', `Good: ${cc.good} / Fair: ${cc.fair} / Poor: ${cc.poor} / Dangerous: ${cc.dangerous}`);

  if (inspection.immediate_action_required) {
    cursor = drawLabelValue(cursor, fonts, 'Immediate Action', 'REQUIRED - see defect register');
  }
  if (inspection.closure_recommended && inspection.closure_reason) {
    cursor = drawLabelValue(cursor, fonts, 'Closure Reason', safe(inspection.closure_reason));
  }

  if (inspection.inspector_summary) {
    cursor = { ...cursor, y: cursor.y - 12 };
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

  return cursor;
}

// =============================================
// 2.0 SITE DETAILS
// =============================================
function renderSiteDetails(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = addPage(doc, cursor, fonts, reportId);
  cursor = drawSectionHeading(cursor, fonts, '2.0', 'Site Details');
  cursor = drawSectionIntro(cursor, fonts, 'Location, access, and contact information for the inspected site.');

  const { site } = data;
  cursor = drawLabelValue(cursor, fonts, 'Site Name', safe(site.name));
  cursor = drawLabelValue(cursor, fonts, 'Address', `${safe(site.address)}${site.postcode ? ', ' + safe(site.postcode) : ''}`);
  cursor = drawLabelValue(cursor, fonts, 'Coordinates', `${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}`);
  if (site.contact_name) cursor = drawLabelValue(cursor, fonts, 'Contact', safe(site.contact_name));
  if (site.contact_phone) cursor = drawLabelValue(cursor, fonts, 'Phone', safe(site.contact_phone));
  if (site.contact_email) cursor = drawLabelValue(cursor, fonts, 'Email', safe(site.contact_email));
  if (site.access_notes) cursor = drawLabelValue(cursor, fonts, 'Access Notes', safe(site.access_notes));

  return cursor;
}

// =============================================
// 3.0 INSPECTION METHODOLOGY
// =============================================
function renderMethodology(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Cursor {
  cursor = addPage(doc, cursor, fonts, reportId);
  cursor = drawSectionHeading(cursor, fonts, '3.0', 'Inspection Methodology');
  cursor = drawSectionIntro(cursor, fonts, 'This section describes the inspection approach, standards applied, and scope of assessment.');

  const typeLabel = INSPECTION_TYPE_LABELS[data.inspection.inspection_type];
  const typeDesc = INSPECTION_TYPE_DESCRIPTIONS[data.inspection.inspection_type];

  cursor = drawLabelValue(cursor, fonts, 'Inspection Type', typeLabel);
  cursor = { ...cursor, y: cursor.y - 4 };
  const descLines = wrapText(typeDesc, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (const line of descLines) {
    cursor.page.drawText(line, { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
  }
  cursor = { ...cursor, y: cursor.y - 12 };

  cursor = drawLabelValue(cursor, fonts, 'Standards Applied', 'BS EN 1176-1:2017, BS EN 1176-7:2020, BS EN 1177:2018');
  cursor = { ...cursor, y: cursor.y - 8 };

  const scopeText =
    'Each asset was assessed for structural integrity, surface condition, entrapment hazards, ' +
    'impact surfacing adequacy, clearance zones, and compliance with the applicable parts of BS EN 1176. ' +
    'A structured checklist was completed for each asset based on its type. Voice observations, ' +
    'photographic evidence, and manual notes were captured on site. Defects were classified by risk ' +
    'severity (Very High, High, Medium, Low) with recommended remedial actions and timeframes.';
  const scopeLines = wrapText(scopeText, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (const line of scopeLines) {
    cursor.page.drawText(line, { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
  }
  cursor = { ...cursor, y: cursor.y - 16 };

  // Risk severity key
  cursor.page.drawText('Risk Severity Key', {
    x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_SUBHEADING, size: FONT_SIZE_SUBHEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
  });
  cursor = { ...cursor, y: cursor.y - FONT_SIZE_SUBHEADING * LINE_HEIGHT_MULTIPLIER - 8 };

  const riskKey: Array<[string, string, ReturnType<typeof rgb>, ReturnType<typeof rgb>]> = [
    ['Very High', 'Immediate closure or restricted access required. Risk of serious injury.', COLOUR_RED, COLOUR_RED_BG],
    ['High', 'Action required within 48 hours. Significant safety concern.', COLOUR_ORANGE, COLOUR_ORANGE_BG],
    ['Medium', 'Action required within 1 month. Monitor and schedule repair.', COLOUR_YELLOW, COLOUR_YELLOW_BG],
    ['Low', 'Routine maintenance. Address at next scheduled service.', COLOUR_GREEN, COLOUR_GREEN_BG],
  ];

  for (const [label, desc, textCol, bgCol] of riskKey) {
    const rowHeight = 24;
    cursor.page.drawRectangle({ x: MARGIN_LEFT, y: cursor.y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: bgCol });
    drawBadge(cursor.page, fonts, label, MARGIN_LEFT + 6, cursor.y - 16, textCol, bgCol);
    const badgeWidth = fonts.bold.widthOfTextAtSize(sanitiseForPdf(label), FONT_SIZE_SMALL) + 20;
    cursor.page.drawText(sanitiseForPdf(desc), {
      x: MARGIN_LEFT + badgeWidth + 12, y: cursor.y - 16, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_DARK_GREY,
    });
    cursor = { ...cursor, y: cursor.y - rowHeight - 4 };
  }

  return cursor;
}

// =============================================
// 4.0 ASSET INSPECTION RESULTS
// =============================================
async function renderAssetResults(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string): Promise<Cursor> {
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
    const subSection = `4.${idx + 1}`;

    // Each asset starts on a fresh page
    cursor = addPage(doc, cursor, fonts, reportId);

    if (idx === 0) {
      cursor = drawSectionHeading(cursor, fonts, '4.0', 'Asset Inspection Results');
      cursor = drawSectionIntro(cursor, fonts,
        `Detailed findings for each of the ${items.length} asset(s) inspected, including condition assessment, checklist completion, photographic evidence, voice observations, and identified defects.`,
      );
      cursor = { ...cursor, y: cursor.y - 8 };
    }

    // Asset sub-heading
    const headerHeight = 26;
    cursor.page.drawRectangle({ x: MARGIN_LEFT, y: cursor.y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: COLOUR_SECTION_BG, borderColor: COLOUR_LIGHT_GREY, borderWidth: 0.5 });
    cursor.page.drawText(sanitiseForPdf(`${subSection}  ${item.asset_code} - ${typeName}`), {
      x: MARGIN_LEFT + 8, y: cursor.y - 17, size: FONT_SIZE_SUBHEADING, font: fonts.bold, color: COLOUR_DARK_GREY,
    });
    if (item.overall_condition) {
      const condLabel = CONDITION_LABELS[item.overall_condition];
      drawBadge(cursor.page, fonts, condLabel, PAGE_WIDTH - MARGIN_RIGHT - 80, cursor.y - 18, conditionColour(item.overall_condition), riskBgColour(item.risk_rating));
    }
    cursor = { ...cursor, y: cursor.y - headerHeight - 10 };

    if (config?.complianceStandard) {
      cursor.page.drawText(sanitiseForPdf(config.complianceStandard), { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_ACCENT });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 4 };
    }

    // Asset details
    if (asset) {
      const detailLines: Array<[string, string]> = [];
      const mfgParts = [asset.manufacturer, asset.model, asset.serial_number].filter(Boolean);
      if (mfgParts.length > 0) detailLines.push(['Equipment', sanitiseForPdf(mfgParts.join(' / '))]);
      if (asset.install_date) detailLines.push(['Installed', formatDate(asset.install_date)]);
      if (asset.purchase_cost_gbp || asset.expected_lifespan_years) {
        const parts: string[] = [];
        if (asset.purchase_cost_gbp) parts.push(`Cost: £${String(asset.purchase_cost_gbp)}`);
        if (asset.expected_lifespan_years) parts.push(`Expected lifespan: ${String(asset.expected_lifespan_years)} years`);
        detailLines.push(['Investment', parts.join(' / ')]);
      }
      if (asset.surface_type || asset.fall_height_mm || asset.impact_attenuation_required_mm) {
        const safetyParts: string[] = [];
        if (asset.surface_type) safetyParts.push(`Surface: ${sanitiseForPdf(asset.surface_type)}`);
        if (asset.fall_height_mm) safetyParts.push(`Fall height: ${String(asset.fall_height_mm)}mm`);
        if (asset.impact_attenuation_required_mm) safetyParts.push(`Surfacing depth: ${String(asset.impact_attenuation_required_mm)}mm`);
        detailLines.push(['Safety', safetyParts.join(' / ')]);
      }
      if (asset.maintenance_notes) detailLines.push(['Maintenance', sanitiseForPdf(asset.maintenance_notes)]);

      for (const [label, value] of detailLines) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER + 4);
        const labelText = sanitiseForPdf(label + ':');
        cursor.page.drawText(labelText, {
          x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.bold, color: COLOUR_MID_GREY,
        });
        const lw = fonts.bold.widthOfTextAtSize(labelText, FONT_SIZE_SMALL) + 6;
        const vLines = wrapText(value, fonts.regular, FONT_SIZE_SMALL, CONTENT_WIDTH - 12 - lw);
        for (let vIdx = 0; vIdx < vLines.length; vIdx++) {
          cursor.page.drawText(vLines[vIdx] ?? '', {
            x: MARGIN_LEFT + 6 + lw, y: cursor.y - FONT_SIZE_SMALL - (vIdx * FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER),
            size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_DARK_GREY,
          });
        }
        cursor = { ...cursor, y: cursor.y - (Math.max(1, vLines.length) * FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER) - 2 };
      }
    }

    cursor = { ...cursor, y: cursor.y - 4 };
    cursor = drawHorizontalRule(cursor);

    // Photos
    const photoCount = data.photoCountsByItem?.[item.id] ?? 0;
    if (photoCount > 0) {
      cursor.page.drawText(`Photos: ${String(photoCount)} captured`, {
        x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_ACCENT,
      });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 4 };
    }
    const itemPhotos = data.photosByItem?.[item.id];
    if (itemPhotos && itemPhotos.length > 0) {
      const photoWidth = 160;
      const photoHeight = 120;
      const photosPerRow = 3;
      const photoGap = 8;
      for (let pIdx = 0; pIdx < itemPhotos.length; pIdx++) {
        const col = pIdx % photosPerRow;
        if (col === 0) cursor = ensureSpace(doc, cursor, fonts, reportId, photoHeight + 12);
        const xPos = MARGIN_LEFT + 6 + col * (photoWidth + photoGap);
        try {
          const base64 = itemPhotos[pIdx]!;
          const imageBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const image = await doc.embedJpg(imageBytes);
          const scaled = image.scaleToFit(photoWidth, photoHeight);
          cursor.page.drawImage(image, { x: xPos, y: cursor.y - scaled.height, width: scaled.width, height: scaled.height });
          if (col === photosPerRow - 1 || pIdx === itemPhotos.length - 1) {
            cursor = { ...cursor, y: cursor.y - photoHeight - photoGap };
          }
        } catch { /* Skip unembeddable photos */ }
      }
    }

    // Checklist
    const checklist = (item as unknown as Record<string, unknown>).checklist_data as ChecklistData | null;
    if (checklist && (checklist.standard.length > 0 || checklist.custom.length > 0)) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 30);
      const allChecks = [
        ...checklist.standard.map((c) => ({ label: c.label, completed: c.completed, isCustom: false })),
        ...checklist.custom.map((c) => ({ label: c.label, completed: c.completed, isCustom: true })),
      ];
      const completedCount = allChecks.filter((c) => c.completed).length;
      cursor.page.drawText(`Inspection Checklist (${completedCount}/${allChecks.length}):`, {
        x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_DARK_GREY,
      });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER - 2 };
      for (const check of allChecks) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER + 2);
        const tick = check.completed ? '[x]' : '[ ]';
        const prefix = check.isCustom ? `${tick} (Custom) ` : `${tick} `;
        const checkColour = check.completed ? COLOUR_GREEN : COLOUR_MID_GREY;
        cursor.page.drawText(sanitiseForPdf(`${prefix}${check.label}`), {
          x: MARGIN_LEFT + 12, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.regular, color: checkColour,
        });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER };
      }
      if (checklist.dismissed.length > 0) {
        cursor.page.drawText(`${checklist.dismissed.length} item(s) marked N/A`, {
          x: MARGIN_LEFT + 12, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY,
        });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER };
      }
      cursor = { ...cursor, y: cursor.y - 6 };
    }

    // Voice transcript
    if (item.voice_transcript) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 40);
      cursor.page.drawText('Voice Observation:', { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_DARK_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      const tLines = wrapText(item.voice_transcript, fonts.italic, FONT_SIZE_BODY, CONTENT_WIDTH - 12);
      for (const line of tLines) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
        cursor.page.drawText(line, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.italic, color: COLOUR_DARK_GREY });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      }
      cursor = { ...cursor, y: cursor.y - 4 };
    }

    // Inspector notes
    if (item.inspector_notes) {
      cursor = ensureSpace(doc, cursor, fonts, reportId, 40);
      cursor.page.drawText('Inspector Notes:', { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_DARK_GREY });
      cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      const nLines = wrapText(item.inspector_notes, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH - 12);
      for (const line of nLines) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
        cursor.page.drawText(line, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
      }
      cursor = { ...cursor, y: cursor.y - 4 };
    }

    // Defects
   if (item.defects.length > 0) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, 30);
        cursor.page.drawText(`Defects (${item.defects.length}):`, { x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_ORANGE });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER - 4 };
        for (const defect of item.defects) {
          cursor = renderDefectBlock(doc, cursor, fonts, defect, reportId);
        }
      }

      // Resolved Previous Findings
      const resolvedFindings = (item as unknown as Record<string, unknown>).resolved_findings as Array<{
        description: string;
        bs_en_reference: string;
        severity: string;
        remedial_action: string;
        first_reported: string;
        consecutive_inspections: number;
        resolved_at: string;
      }> | null | undefined;
      if (resolvedFindings && resolvedFindings.length > 0) {
        cursor = ensureSpace(doc, cursor, fonts, reportId, 30);
        cursor.page.drawText(`Resolved Previous Findings (${resolvedFindings.length}):`, {
          x: MARGIN_LEFT + 6, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.bold, color: COLOUR_GREEN,
        });
        cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER - 4 };
        for (const rf of resolvedFindings) {
          cursor = ensureSpace(doc, cursor, fonts, reportId, 50);
          const rfIndent = MARGIN_LEFT + 12;
          drawBadge(cursor.page, fonts, 'Resolved', rfIndent, cursor.y - FONT_SIZE_BODY - 1, COLOUR_GREEN, COLOUR_GREEN_BG);
          const resolvedBadgeW = fonts.bold.widthOfTextAtSize('Resolved', FONT_SIZE_SMALL) + 20;
          const sevLabel = RISK_RATING_LABELS[rf.severity as RiskRating] ?? rf.severity;
          cursor.page.drawText(sanitiseForPdf(sevLabel), {
            x: rfIndent + resolvedBadgeW + 4, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_MID_GREY,
          });
          if (rf.bs_en_reference) {
            const sevW = fonts.regular.widthOfTextAtSize(sanitiseForPdf(sevLabel), FONT_SIZE_SMALL);
            cursor.page.drawText(sanitiseForPdf(rf.bs_en_reference), {
              x: rfIndent + resolvedBadgeW + sevW + 12, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_ACCENT,
            });
          }
          cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER - 2 };
          const descLines = wrapText(rf.description, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH - 24);
          for (const line of descLines) {
            cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER + 2);
            cursor.page.drawText(line, { x: rfIndent, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_MID_GREY });
            cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
          }
          if (rf.remedial_action) {
            const remLines = wrapText(`Remedy: ${rf.remedial_action}`, fonts.regular, FONT_SIZE_SMALL, CONTENT_WIDTH - 24);
            for (const line of remLines) {
              cursor = ensureSpace(doc, cursor, fonts, reportId, FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER + 2);
              cursor.page.drawText(line, { x: rfIndent, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.regular, color: COLOUR_MID_GREY });
              cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER };
            }
          }
          const metaParts: string[] = [];
          metaParts.push(`First reported ${formatDate(rf.first_reported)}`);
          if (rf.consecutive_inspections > 1) metaParts.push(`Open ${rf.consecutive_inspections} visits before resolution`);
          cursor.page.drawText(sanitiseForPdf(metaParts.join(' - ')), {
            x: rfIndent, y: cursor.y - FONT_SIZE_SMALL, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY,
          });
          cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 8 };
        }
      }
  }

  return cursor;
}

function renderDefectBlock(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, defect: DefectDetail, reportId: string): Cursor {
  cursor = ensureSpace(doc, cursor, fonts, reportId, 60);
  const lineHeight = FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER;
  const indent = MARGIN_LEFT + 12;

  const defectRecord = defect as unknown as Record<string, unknown>;
  const isRecurring = Boolean(defectRecord._recurring);
  const consecutiveVisits = (defectRecord._consecutive_inspections as number) ?? 0;
  const firstReported = defectRecord._first_reported as string | undefined;

  const riskLabel = RISK_RATING_LABELS[defect.risk_rating] ?? 'Unknown';
  drawBadge(cursor.page, fonts, riskLabel, indent, cursor.y - FONT_SIZE_BODY - 1, riskColour(defect.risk_rating), riskBgColour(defect.risk_rating));

  let badgeOffset = fonts.bold.widthOfTextAtSize(sanitiseForPdf(riskLabel), FONT_SIZE_SMALL) + 20;

  if (isRecurring) {
    drawBadge(cursor.page, fonts, 'RECURRING', indent + badgeOffset, cursor.y - FONT_SIZE_BODY - 1, COLOUR_ORANGE, COLOUR_ORANGE_BG);
    badgeOffset += fonts.bold.widthOfTextAtSize('RECURRING', FONT_SIZE_SMALL) + 24;
    if (consecutiveVisits > 1) {
      const visitText = `Open ${consecutiveVisits} visits`;
      cursor.page.drawText(sanitiseForPdf(visitText), {
        x: indent + badgeOffset, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_SMALL, font: fonts.bold, color: COLOUR_RED,
      });
      badgeOffset += fonts.bold.widthOfTextAtSize(sanitiseForPdf(visitText), FONT_SIZE_SMALL) + 8;
    }
    if (firstReported) {
      const frText = `First reported ${formatDate(firstReported)}`;
      cursor.page.drawText(sanitiseForPdf(frText), {
        x: indent + badgeOffset, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY,
      });
    }
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_SMALL * LINE_HEIGHT_MULTIPLIER - 2 };
  }
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

// =============================================
// 5.0 DEFECT REGISTER
// =============================================
function renderDefectRegister(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string, sectionNumber: string): Cursor {
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

  cursor = addPage(doc, cursor, fonts, reportId);
  cursor = drawSectionHeading(cursor, fonts, sectionNumber, 'Defect Register');
  cursor = drawSectionIntro(cursor, fonts,
    `Summary of all ${allDefects.length} defect(s) identified during inspection, ordered by risk severity.`,
  );

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

  return cursor;
}

// =============================================
// 6.0 DECLARATION & SIGN-OFF
// =============================================
function renderSignOff(doc: PDFDocument, cursor: Cursor, fonts: PDFFonts, data: ReportData, reportId: string, sectionNumber: string): Cursor {
  cursor = addPage(doc, cursor, fonts, reportId);
  cursor = drawSectionHeading(cursor, fonts, sectionNumber, 'Declaration & Sign-Off');
  cursor = drawSectionIntro(cursor, fonts, 'Formal declaration of inspection accuracy and compliance with BS EN 1176-7:2020.');

  const { inspection } = data;

  const declaration =
    'I declare that this inspection has been carried out in accordance with BS EN 1176-7:2020. ' +
    'All observations have been made to the best of my professional ability and the findings recorded ' +
    'in this report are an accurate representation of the condition of the equipment and surfacing ' +
    'at the time of inspection. This report should be read in conjunction with any previous inspection ' +
    'reports and manufacturer maintenance instructions.';

  const declLines = wrapText(declaration, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
  for (const line of declLines) {
    cursor.page.drawText(line, { x: MARGIN_LEFT, y: cursor.y - FONT_SIZE_BODY, size: FONT_SIZE_BODY, font: fonts.regular, color: COLOUR_DARK_GREY });
    cursor = { ...cursor, y: cursor.y - FONT_SIZE_BODY * LINE_HEIGHT_MULTIPLIER };
  }

  cursor = { ...cursor, y: cursor.y - 24 };

  if (inspection.status === InspectionStatus.SIGNED || inspection.status === InspectionStatus.EXPORTED) {
    cursor = drawLabelValue(cursor, fonts, 'Signed By', safe(inspection.signed_by) || '-');
    cursor = drawLabelValue(cursor, fonts, 'Signed At', formatDateTime(inspection.signed_at));
    cursor = { ...cursor, y: cursor.y - 24 };
    cursor.page.drawLine({ start: { x: MARGIN_LEFT, y: cursor.y }, end: { x: MARGIN_LEFT + 200, y: cursor.y }, thickness: 1, color: COLOUR_BLACK });
    cursor.page.drawText('Inspector Signature', { x: MARGIN_LEFT, y: cursor.y - 14, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY });
    cursor.page.drawLine({ start: { x: MARGIN_LEFT + 260, y: cursor.y }, end: { x: MARGIN_LEFT + 400, y: cursor.y }, thickness: 1, color: COLOUR_BLACK });
    cursor.page.drawText('Date', { x: MARGIN_LEFT + 260, y: cursor.y - 14, size: FONT_SIZE_SMALL, font: fonts.italic, color: COLOUR_MID_GREY });
    cursor = { ...cursor, y: cursor.y - 36 };
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

  cursor = await renderCoverPage(doc, cursor, fonts, data);
  cursor = renderTableOfContents(doc, cursor, fonts, data, reportId);
  cursor = renderExecutiveSummary(doc, cursor, fonts, data, reportId);
  cursor = renderSiteDetails(doc, cursor, fonts, data, reportId);
  cursor = renderMethodology(doc, cursor, fonts, data, reportId);
  cursor = await renderAssetResults(doc, cursor, fonts, data, reportId);

  const hasDefects = data.items.some((i) => i.defects.length > 0);
  if (hasDefects) {
    cursor = renderDefectRegister(doc, cursor, fonts, data, reportId, '5.0');
    cursor = renderSignOff(doc, cursor, fonts, data, reportId, '6.0');
  } else {
    cursor = renderSignOff(doc, cursor, fonts, data, reportId, '5.0');
  }

  // Final pass: "Page X of Y"
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
