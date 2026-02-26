/**
 * InspectVoice — Email Template Builder
 * Builds HTML email content for summary notification emails.
 *
 * Uses inline styles only (email client compatibility).
 * No external CSS, no JavaScript, tables for layout.
 * Tested pattern: Outlook, Gmail, Apple Mail safe.
 *
 * UPDATED: Feature 17 — adds manufacturer recall alert section.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// TYPES
// =============================================

export interface SummaryEmailData {
  orgName: string;
  periodLabel: string;
  frequency: string;
  recipientName: string;
  generatedAt: string;

  // Hotlist (top priority defects)
  hotlistItems: HotlistItem[];

  // Period stats
  inspectionsCompleted: number;
  newDefectsRaised: number;
  defectsResolved: number;
  overdueDefects: number;
  sitesInspected: number;

  // Upcoming inspections due
  upcomingInspections: UpcomingInspection[];

  // Active manufacturer recalls (Feature 17)
  activeRecalls: RecallEmailItem[];

  // Config: what sections were requested
  showHotlist: boolean;
  showInspections: boolean;
  showDefects: boolean;
  showOverdue: boolean;
}

export interface HotlistItem {
  siteName: string;
  assetCode: string;
  description: string;
  severity: string;
  daysOpen: number;
  daysOverdue: number | null;
  madeSafe: boolean;
  bsEnReference: string | null;
}

export interface UpcomingInspection {
  siteName: string;
  inspectionType: string;
  dueDate: string;
  daysUntilDue: number;
}

export interface RecallEmailItem {
  title: string;
  manufacturer: string;
  severity: string;
  matchedAssetCount: number;
  unacknowledgedCount: number;
}

// =============================================
// COLOUR PALETTE (inline-safe)
// =============================================

const COLORS = {
  primary: '#16a34a',       // Green-600
  primaryDark: '#15803d',   // Green-700
  danger: '#dc2626',        // Red-600
  dangerBg: '#fef2f2',      // Red-50
  warning: '#d97706',       // Amber-600
  warningBg: '#fffbeb',     // Amber-50
  success: '#16a34a',       // Green-600
  successBg: '#f0fdf4',     // Green-50
  textPrimary: '#111827',   // Gray-900
  textSecondary: '#6b7280', // Gray-500
  border: '#e5e7eb',        // Gray-200
  bgLight: '#f9fafb',       // Gray-50
  white: '#ffffff',
  purple: '#7c3aed',        // Violet-600 — used for recall section
  purpleBg: '#f5f3ff',      // Violet-50
} as const;

// =============================================
// BUILD SUMMARY EMAIL HTML
// =============================================

export function buildSummaryEmailHtml(data: SummaryEmailData): string {
  const sections: string[] = [];

  // Stats overview (always shown)
  sections.push(buildStatsSection(data));

  // Manufacturer recalls (Feature 17 — always shown if any exist, high visibility)
  if (data.activeRecalls.length > 0) {
    sections.push(buildRecallSection(data.activeRecalls));
  }

  // Hotlist
  if (data.showHotlist && data.hotlistItems.length > 0) {
    sections.push(buildHotlistSection(data.hotlistItems));
  }

  // Overdue alert
  if (data.showOverdue && data.overdueDefects > 0) {
    sections.push(buildOverdueSection(data.overdueDefects));
  }

  // Upcoming inspections
  if (data.showInspections && data.upcomingInspections.length > 0) {
    sections.push(buildUpcomingSection(data.upcomingInspections));
  }

  // No-activity fallback
  if (
    data.inspectionsCompleted === 0
    && data.newDefectsRaised === 0
    && data.defectsResolved === 0
    && data.hotlistItems.length === 0
    && data.activeRecalls.length === 0
  ) {
    sections.push(buildNoActivitySection());
  }

  return wrapInLayout(data, sections.join(''));
}

// =============================================
// LAYOUT WRAPPER
// =============================================

function wrapInLayout(data: SummaryEmailData, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-GB" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(data.orgName)} — Inspection Summary</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bgLight};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.bgLight};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${COLORS.white};border-radius:8px;border:1px solid ${COLORS.border};">

          <!-- Header -->
          <tr>
            <td style="background-color:${COLORS.primary};padding:24px 32px;border-radius:8px 8px 0 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td>
                    <h1 style="margin:0;color:${COLORS.white};font-size:22px;font-weight:700;line-height:1.3;">
                      ${escapeHtml(data.orgName)}
                    </h1>
                    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px;line-height:1.4;">
                      ${capitalise(data.frequency)} Inspection Summary &mdash; ${escapeHtml(data.periodLabel)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:24px 32px 0;">
              <p style="margin:0;color:${COLORS.textPrimary};font-size:15px;line-height:1.5;">
                Hi ${escapeHtml(data.recipientName)},
              </p>
              <p style="margin:8px 0 0;color:${COLORS.textSecondary};font-size:14px;line-height:1.5;">
                Here&rsquo;s your ${data.frequency} summary of inspection activity across your sites.
              </p>
            </td>
          </tr>

          <!-- Body sections -->
          <tr>
            <td style="padding:16px 32px 24px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid ${COLORS.border};">
              <p style="margin:0;color:${COLORS.textSecondary};font-size:12px;line-height:1.5;">
                This email was generated automatically by InspectVoice on ${escapeHtml(data.generatedAt)}.
                To change your notification preferences or unsubscribe, visit your
                <a href="https://inspectvoice.co.uk/settings/notifications" style="color:${COLORS.primary};text-decoration:underline;">notification settings</a>.
              </p>
              <p style="margin:8px 0 0;color:${COLORS.textSecondary};font-size:11px;line-height:1.5;">
                &copy; ${new Date().getFullYear()} InspectVoice &mdash; Autaimate Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// =============================================
// STATS SECTION
// =============================================

function buildStatsSection(data: SummaryEmailData): string {
  const stats = [
    { label: 'Inspections', value: String(data.inspectionsCompleted), color: COLORS.primary },
    { label: 'New Defects', value: String(data.newDefectsRaised), color: data.newDefectsRaised > 0 ? COLORS.warning : COLORS.textSecondary },
    { label: 'Resolved', value: String(data.defectsResolved), color: COLORS.success },
    { label: 'Overdue', value: String(data.overdueDefects), color: data.overdueDefects > 0 ? COLORS.danger : COLORS.success },
  ];

  const statCells = stats.map((s) => `
    <td align="center" width="25%" style="padding:12px 4px;">
      <p style="margin:0;font-size:28px;font-weight:700;color:${s.color};line-height:1.2;">
        ${s.value}
      </p>
      <p style="margin:4px 0 0;font-size:11px;color:${COLORS.textSecondary};text-transform:uppercase;letter-spacing:0.5px;line-height:1.3;">
        ${s.label}
      </p>
    </td>
  `).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.bgLight};border-radius:8px;margin:16px 0;">
      <tr>${statCells}</tr>
    </table>
  `;
}

// =============================================
// RECALL SECTION (Feature 17)
// =============================================

function buildRecallSection(recalls: RecallEmailItem[]): string {
  const totalUnacknowledged = recalls.reduce((sum, r) => sum + r.unacknowledgedCount, 0);
  const hasCritical = recalls.some((r) => r.severity === 'critical');

  const borderColor = hasCritical ? COLORS.danger : COLORS.warning;
  const bgColor = hasCritical ? COLORS.dangerBg : COLORS.warningBg;

  const rows = recalls.map((recall) => {
    const severityColor = recall.severity === 'critical'
      ? COLORS.danger
      : recall.severity === 'high'
        ? COLORS.warning
        : COLORS.textSecondary;
    const severityLabel = recall.severity.toUpperCase();

    const pendingTag = recall.unacknowledgedCount > 0
      ? `<span style="color:${COLORS.danger};font-size:11px;font-weight:600;"> &mdash; ${recall.unacknowledgedCount} pending review</span>`
      : '<span style="color:#16a34a;font-size:11px;"> &#10003; All acknowledged</span>';

    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};vertical-align:top;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td>
                <span style="display:inline-block;padding:2px 8px;border-radius:3px;background-color:${severityColor};color:${COLORS.white};font-size:10px;font-weight:700;letter-spacing:0.5px;">
                  ${severityLabel}
                </span>
                <span style="color:${COLORS.textSecondary};font-size:12px;margin-left:8px;">
                  ${escapeHtml(recall.manufacturer)} &middot; ${recall.matchedAssetCount} asset${recall.matchedAssetCount !== 1 ? 's' : ''} affected
                </span>
                ${pendingTag}
              </td>
            </tr>
            <tr>
              <td style="padding-top:4px;">
                <p style="margin:0;color:${COLORS.textPrimary};font-size:13px;font-weight:600;line-height:1.4;">
                  ${escapeHtml(truncate(recall.title, 100))}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      <tr>
        <td style="padding:0 0 8px;">
          <h2 style="margin:0;color:${borderColor};font-size:16px;font-weight:700;line-height:1.3;">
            &#9888;&#65039; Manufacturer Recalls (${recalls.length})
          </h2>
          ${totalUnacknowledged > 0
            ? `<p style="margin:4px 0 0;color:${COLORS.danger};font-size:13px;font-weight:600;">${totalUnacknowledged} asset${totalUnacknowledged !== 1 ? 's' : ''} require${totalUnacknowledged === 1 ? 's' : ''} acknowledgement</p>`
            : ''}
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${borderColor};border-radius:6px;background-color:${bgColor};margin-bottom:16px;">
      ${rows}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:0 0 8px;">
          <a href="https://inspectvoice.co.uk/recalls" style="color:${COLORS.primary};font-size:13px;text-decoration:underline;">
            Review all recalls in InspectVoice &rarr;
          </a>
        </td>
      </tr>
    </table>
  `;
}

// =============================================
// HOTLIST SECTION
// =============================================

function buildHotlistSection(items: HotlistItem[]): string {
  const rows = items.map((item) => {
    const severityColor = item.severity === 'very_high' ? COLORS.danger : COLORS.warning;
    const severityLabel = item.severity === 'very_high' ? 'VERY HIGH' : 'HIGH';
    const overdueTag = item.daysOverdue !== null && item.daysOverdue > 0
      ? `<span style="color:${COLORS.danger};font-size:11px;font-weight:600;"> &mdash; ${item.daysOverdue}d overdue</span>`
      : '';
    const madeSafeTag = item.madeSafe
      ? `<span style="color:${COLORS.success};font-size:11px;"> &#9989; Made safe</span>`
      : '';

    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};vertical-align:top;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td>
                <span style="display:inline-block;padding:2px 8px;border-radius:3px;background-color:${severityColor};color:${COLORS.white};font-size:10px;font-weight:700;letter-spacing:0.5px;">
                  ${severityLabel}
                </span>
                <span style="color:${COLORS.textSecondary};font-size:12px;margin-left:8px;">
                  ${escapeHtml(item.assetCode)} &middot; ${item.daysOpen}d open${overdueTag}
                </span>
                ${madeSafeTag}
              </td>
            </tr>
            <tr>
              <td style="padding-top:4px;">
                <p style="margin:0;color:${COLORS.textPrimary};font-size:13px;line-height:1.4;">
                  ${escapeHtml(truncate(item.description, 120))}
                </p>
                <p style="margin:2px 0 0;color:${COLORS.textSecondary};font-size:12px;">
                  ${escapeHtml(item.siteName)}${item.bsEnReference ? ` &middot; ${escapeHtml(item.bsEnReference)}` : ''}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      <tr>
        <td style="padding:0 0 8px;">
          <h2 style="margin:0;color:${COLORS.danger};font-size:16px;font-weight:700;line-height:1.3;">
            &#128680; Priority Defect Hotlist (${items.length})
          </h2>
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${COLORS.border};border-radius:6px;margin-bottom:16px;">
      ${rows}
    </table>
  `;
}

// =============================================
// OVERDUE ALERT SECTION
// =============================================

function buildOverdueSection(overdueCount: number): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.dangerBg};border:1px solid ${COLORS.danger};border-radius:6px;margin:16px 0;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0;color:${COLORS.danger};font-size:14px;font-weight:700;line-height:1.4;">
            &#9888;&#65039; ${overdueCount} overdue defect${overdueCount !== 1 ? 's' : ''} require${overdueCount === 1 ? 's' : ''} attention
          </p>
          <p style="margin:4px 0 0;color:${COLORS.textSecondary};font-size:13px;line-height:1.4;">
            These defects have passed their action timeframe deadline. Review and resolve to maintain compliance.
          </p>
        </td>
      </tr>
    </table>
  `;
}

// =============================================
// UPCOMING INSPECTIONS SECTION
// =============================================

function buildUpcomingSection(inspections: UpcomingInspection[]): string {
  const rows = inspections.map((insp) => {
    const urgencyColor = insp.daysUntilDue <= 0
      ? COLORS.danger
      : insp.daysUntilDue <= 3
        ? COLORS.warning
        : COLORS.textSecondary;

    const urgencyLabel = insp.daysUntilDue <= 0
      ? 'OVERDUE'
      : insp.daysUntilDue === 1
        ? 'Tomorrow'
        : `${insp.daysUntilDue}d`;

    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${COLORS.border};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="width:70%;">
                <p style="margin:0;color:${COLORS.textPrimary};font-size:13px;line-height:1.4;">
                  ${escapeHtml(insp.siteName)}
                </p>
                <p style="margin:2px 0 0;color:${COLORS.textSecondary};font-size:12px;">
                  ${escapeHtml(formatInspectionType(insp.inspectionType))} &middot; Due ${escapeHtml(insp.dueDate)}
                </p>
              </td>
              <td align="right" style="width:30%;">
                <span style="color:${urgencyColor};font-size:12px;font-weight:600;">
                  ${urgencyLabel}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
      <tr>
        <td style="padding:0 0 8px;">
          <h2 style="margin:0;color:${COLORS.textPrimary};font-size:16px;font-weight:700;line-height:1.3;">
            &#128197; Upcoming Inspections (${inspections.length})
          </h2>
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${COLORS.border};border-radius:6px;margin-bottom:16px;">
      ${rows}
    </table>
  `;
}

// =============================================
// NO ACTIVITY SECTION
// =============================================

function buildNoActivitySection(): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.successBg};border-radius:6px;margin:16px 0;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <p style="margin:0;font-size:28px;">&#9989;</p>
          <p style="margin:8px 0 0;color:${COLORS.success};font-size:15px;font-weight:600;">
            No inspection activity this period
          </p>
          <p style="margin:4px 0 0;color:${COLORS.textSecondary};font-size:13px;">
            All quiet across your sites. Next summary will be sent on your scheduled date.
          </p>
        </td>
      </tr>
    </table>
  `;
}

// =============================================
// UTILITY HELPERS
// =============================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatInspectionType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

