/**
 * InspectVoice — Deepgram Transcription Service
 * Converts audio recordings to text using Deepgram's Nova-2 model.
 *
 * Called by the audio processing queue consumer.
 * Supports all audio formats captured by the frontend (webm, ogg, wav, mp4, mpeg).
 *
 * Returns structured transcript with:
 * - Full text
 * - Word-level timestamps (for future highlight/seek features)
 * - Confidence score
 * - Duration
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Logger } from '../shared/logger';
import { BadGatewayError, BadRequestError } from '../shared/errors';

// =============================================
// CONFIGURATION
// =============================================

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

/** Request timeout in milliseconds (2 minutes — audio can be long) */
const REQUEST_TIMEOUT_MS = 120_000;

/** Maximum retries on transient failures */
const MAX_RETRIES = 2;

/** Delay between retries in ms */
const RETRY_DELAY_MS = 2000;

/** Minimum audio size worth transcribing (bytes) — ~0.5s of audio */
const MIN_AUDIO_SIZE = 5_000;

/** Maximum audio size (50MB — Deepgram limit) */
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;

// =============================================
// TRANSCRIPTION RESULT
// =============================================

export interface TranscriptionResult {
  /** Full transcript text */
  readonly transcript: string;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Detected language */
  readonly language: string;
  /** Audio duration in seconds */
  readonly durationSeconds: number;
  /** Individual words with timestamps */
  readonly words: TranscriptionWord[];
  /** Deepgram model used */
  readonly model: string;
  /** Raw request ID from Deepgram */
  readonly deepgramRequestId: string;
}

export interface TranscriptionWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

// =============================================
// TRANSCRIBE AUDIO
// =============================================

/**
 * Send audio data to Deepgram for transcription.
 *
 * @param audioData — raw audio bytes (ArrayBuffer from R2)
 * @param mimeType — audio MIME type (e.g. 'audio/webm')
 * @param apiKey — Deepgram API key (from env bindings)
 * @param requestId — for logging
 * @returns TranscriptionResult
 * @throws BadRequestError if audio is too small or too large
 * @throws BadGatewayError if Deepgram is unavailable or returns an error
 */
export async function transcribeAudio(
  audioData: ArrayBuffer,
  mimeType: string,
  apiKey: string,
  requestId: string,
): Promise<TranscriptionResult> {
  const logger = Logger.minimal(requestId);

  // ── Input validation ─────────────────────
  if (audioData.byteLength < MIN_AUDIO_SIZE) {
    logger.warn('Audio too small for transcription', {
      sizeBytes: audioData.byteLength,
      minRequired: MIN_AUDIO_SIZE,
    });
    throw new BadRequestError(
      `Audio file too small (${audioData.byteLength} bytes). Minimum ${MIN_AUDIO_SIZE} bytes required.`,
    );
  }

  if (audioData.byteLength > MAX_AUDIO_SIZE) {
    logger.warn('Audio exceeds maximum size', {
      sizeBytes: audioData.byteLength,
      maxAllowed: MAX_AUDIO_SIZE,
    });
    throw new BadRequestError(
      `Audio file too large (${(audioData.byteLength / (1024 * 1024)).toFixed(1)}MB). Maximum 50MB.`,
    );
  }

  logger.info('Starting Deepgram transcription', {
    audioSizeBytes: audioData.byteLength,
    mimeType,
  });

  // ── Build URL with query parameters ──────
  const url = buildDeepgramUrl();

  // Resolve the base MIME type (strip codec info)
  const contentType = mimeType.split(';')[0]?.trim() ?? mimeType;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.info('Retrying Deepgram transcription', { attempt });
      await delay(RETRY_DELAY_MS * attempt);
    }

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': contentType,
        },
        body: audioData,
      }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          logger.error('Deepgram client error', null, {
            status: response.status,
            error: errorBody.slice(0, 500),
          });
          throw new BadGatewayError(`Deepgram transcription failed: ${response.status}`);
        }

        // Retry on server errors (5xx)
        lastError = new Error(`Deepgram ${response.status}: ${errorBody.slice(0, 200)}`);
        continue;
      }

      const data = await response.json() as DeepgramResponse;

      // Extract the best transcript
      const channel = data.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];

      if (!alternative || !alternative.transcript) {
        logger.warn('Deepgram returned empty transcript', {
          hasResults: !!data.results,
          hasChannels: !!data.results?.channels?.length,
        });

        return {
          transcript: '',
          confidence: 0,
          language: 'en',
          durationSeconds: data.metadata?.duration ?? 0,
          words: [],
          model: extractModelName(data),
          deepgramRequestId: data.metadata?.request_id ?? '',
        };
      }

      const result: TranscriptionResult = {
        transcript: alternative.transcript,
        confidence: alternative.confidence ?? 0,
        language: channel?.detected_language ?? 'en',
        durationSeconds: data.metadata?.duration ?? 0,
        words: (alternative.words ?? []).map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
        model: extractModelName(data),
        deepgramRequestId: data.metadata?.request_id ?? '',
      };

      logger.info('Deepgram transcription complete', {
        transcriptLength: result.transcript.length,
        confidence: result.confidence,
        durationSeconds: result.durationSeconds,
        wordCount: result.words.length,
        model: result.model,
      });

      return result;
    } catch (error) {
      if (error instanceof BadGatewayError || error instanceof BadRequestError) throw error;

      lastError = error instanceof Error ? error : new Error('Unknown error');
      logger.warn('Deepgram transcription attempt failed', {
        attempt,
        error: lastError.message,
      });
    }
  }

  // All retries exhausted
  logger.error('Deepgram transcription failed after retries', lastError);
  throw new BadGatewayError('Deepgram transcription service unavailable');
}

// =============================================
// URL CONSTRUCTION
// =============================================

/**
 * Build the Deepgram API URL with correct parameter format.
 *
 * IMPORTANT: Deepgram expects repeated `keywords=` parameters, NOT a single
 * comma-separated value. URLSearchParams.append() handles this correctly.
 *
 * Correct: ?keywords=swing:3&keywords=slide:3&keywords=corrosion:4
 * Wrong:   ?keywords=swing:3,slide:3,corrosion:4
 */
function buildDeepgramUrl(): string {
  const params = new URLSearchParams();

  // Model selection
  params.set('model', 'nova-2');
  params.set('language', 'en-GB');

  // Features
  params.set('punctuate', 'true');
  params.set('smart_format', 'true');
  params.set('diarize', 'false');
  params.set('paragraphs', 'true');
  params.set('utterances', 'false');

  // Keyword boosting — each keyword:boost is a SEPARATE parameter
  const keywords = getKeywordBoosts();
  for (const kw of keywords) {
    params.append('keywords', kw);
  }

  return `${DEEPGRAM_API_URL}?${params.toString()}`;
}

// =============================================
// KEYWORD BOOSTING
// =============================================

/**
 * Playground inspection terminology for Deepgram keyword boosting.
 * Each entry is "keyword:boost" where boost is -10 to 10.
 * Higher boost = more likely to be recognised in noisy outdoor audio.
 *
 * Includes common UK inspector colloquialisms so Deepgram doesn't
 * mangle informal speech into unrecognisable text.
 */
function getKeywordBoosts(): string[] {
  return [
    // Equipment types
    'swing:3', 'slide:3', 'climbing:3', 'roundabout:3', 'seesaw:3',
    'springer:3', 'zipline:3', 'zip wire:3', 'trim trail:3', 'MUGA:5',
    'multi-play:3', 'climbing frame:3', 'monkey bars:3', 'balance beam:3',
    'overhead ladder:3', 'spring rocker:3', 'sandpit:3',

    // Defect terminology
    'corrosion:4', 'rust:3', 'crack:3', 'splinter:3', 'entrapment:5',
    'protrusion:4', 'shearing:4', 'pinch point:4', 'trip hazard:4',
    'head entrapment:5', 'finger entrapment:5', 'clothing entrapment:5',
    'sharp edge:4', 'missing cap:3', 'worn bearing:3', 'delamination:4',
    'UV degradation:4', 'fatigue crack:4',

    // Surface/impact
    'wetpour:4', 'impact area:4', 'fall height:4', 'critical fall height:5',
    'surfacing:3', 'rubber mulch:3', 'bark mulch:3', 'impact absorber:4',

    // Standards
    'BS EN 1176:5', 'BS EN 1177:5', 'BS EN 16630:5', 'RPII:5', 'RoSPA:5',

    // Risk levels
    'very high risk:5', 'high risk:4', 'medium risk:3', 'low risk:3',

    // Actions
    'immediate action:4', 'closure required:5', 'repair needed:3',
    'monitoring:3', 'replacement:3', 'decommission:4', 'taken out of use:4',

    // Structural
    'foundation:3', 'footing:3', 'bolt:3', 'chain:3', 'bearing:3',
    'bushing:3', 'weld:3', 'galvanising:3', 'ferrule:3', 'thimble:3',

    // Inspector colloquialisms (boost recognition of informal UK speech)
    'dodgy:3', 'knackered:3', 'shot:2', 'iffy:2', 'sorted:2',
    'bodged:3', 'botched:3', 'seized:3', 'wobble:3', 'play:2',
    'gone:2', 'rusted through:3', 'snapped:3', 'hanging off:3',
  ];
}

// =============================================
// DEEPGRAM RESPONSE TYPES
// =============================================

interface DeepgramResponse {
  readonly results?: {
    readonly channels?: Array<{
      readonly alternatives?: Array<{
        readonly transcript: string;
        readonly confidence?: number;
        readonly words?: Array<{
          readonly word: string;
          readonly start: number;
          readonly end: number;
          readonly confidence: number;
        }>;
      }>;
      readonly detected_language?: string;
    }>;
  };
  readonly metadata?: {
    readonly request_id?: string;
    readonly duration?: number;
    readonly model_info?: Record<string, { name: string }>;
  };
}

// =============================================
// HELPERS
// =============================================

/**
 * Extract model name from Deepgram response metadata.
 */
function extractModelName(data: DeepgramResponse): string {
  const modelInfo = data.metadata?.model_info;
  if (!modelInfo) return 'nova-2';

  const firstKey = Object.keys(modelInfo)[0];
  if (!firstKey) return 'nova-2';

  return modelInfo[firstKey]?.name ?? 'nova-2';
}

/**
 * Fetch with timeout using AbortController.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BadGatewayError('Deepgram transcription timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Simple delay helper.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
