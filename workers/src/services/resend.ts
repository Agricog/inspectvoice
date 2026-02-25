/**
 * InspectVoice — Resend Email Service
 * Thin wrapper around Resend HTTP API for sending emails.
 *
 * Uses fetch directly (no SDK) for Cloudflare Workers compatibility.
 * Includes retry with exponential backoff for transient failures.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// TYPES
// =============================================

interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
  tags?: Array<{ name: string; value: string }>;
}

interface ResendSuccessResponse {
  id: string;
}

interface ResendErrorResponse {
  statusCode: number;
  message: string;
  name: string;
}

interface SendResult {
  success: boolean;
  messageId: string | null;
  error: string | null;
}

// =============================================
// CONSTANTS
// =============================================

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/**
 * Verified sender — must match your Resend domain.
 * Update this once your production domain is verified.
 */
const FROM_ADDRESS = 'InspectVoice <notifications@inspectvoice.co.uk>';
const REPLY_TO_ADDRESS = 'support@inspectvoice.co.uk';

// =============================================
// SEND EMAIL
// =============================================

/**
 * Send a single email via Resend.
 *
 * @param apiKey — RESEND_API_KEY from env
 * @param to — recipient email address(es)
 * @param subject — email subject line
 * @param html — rendered HTML body
 * @param tags — optional tracking tags
 * @returns SendResult with messageId on success
 */
export async function sendEmail(
  apiKey: string,
  to: string[],
  subject: string,
  html: string,
  tags?: Array<{ name: string; value: string }>,
): Promise<SendResult> {
  // Validate inputs before hitting API
  if (!apiKey) {
    return { success: false, messageId: null, error: 'RESEND_API_KEY not configured' };
  }
  if (to.length === 0) {
    return { success: false, messageId: null, error: 'No recipients provided' };
  }

  const payload: ResendEmailPayload = {
    from: FROM_ADDRESS,
    to,
    subject,
    html,
    reply_to: REPLY_TO_ADDRESS,
  };

  if (tags && tags.length > 0) {
    payload.tags = tags;
  }

  // Retry loop with exponential backoff
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      // 2xx — success
      if (response.ok) {
        const data = (await response.json()) as ResendSuccessResponse;
        return {
          success: true,
          messageId: data.id,
          error: null,
        };
      }

      // 4xx — client error, don't retry (bad request, invalid email, etc.)
      if (response.status >= 400 && response.status < 500) {
        const errorData = (await response.json()) as ResendErrorResponse;
        return {
          success: false,
          messageId: null,
          error: `Resend ${response.status}: ${errorData.message}`,
        };
      }

      // 5xx — server error, retry
      lastError = `Resend ${response.status}: server error`;
    } catch (err: unknown) {
      // Network error — retry
      lastError = err instanceof Error ? err.message : 'Network error';
    }

    // Wait before retry (exponential backoff)
    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    messageId: null,
    error: `Failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
  };
}

// =============================================
// SEND SUMMARY EMAIL (convenience wrapper)
// =============================================

/**
 * Send a summary notification email with standard InspectVoice tags.
 *
 * @param apiKey — RESEND_API_KEY
 * @param recipientEmail — single recipient email
 * @param orgName — organisation name for subject line
 * @param frequency — daily/weekly/monthly (for tags)
 * @param periodLabel — human-readable period (e.g. "17–24 Feb 2026")
 * @param html — rendered HTML body
 * @returns SendResult
 */
export async function sendSummaryEmail(
  apiKey: string,
  recipientEmail: string,
  orgName: string,
  frequency: string,
  periodLabel: string,
  html: string,
): Promise<SendResult> {
  const subject = `${orgName} — ${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Inspection Summary (${periodLabel})`;

  return sendEmail(
    apiKey,
    [recipientEmail],
    subject,
    html,
    [
      { name: 'type', value: 'summary' },
      { name: 'frequency', value: frequency },
    ],
  );
}
