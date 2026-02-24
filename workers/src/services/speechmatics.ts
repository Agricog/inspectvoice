/**
 * InspectVoice — Speechmatics Transcription Service
 * Batch transcription via Speechmatics REST API (EU region).
 *
 * Replaces Deepgram. Uses:
 *   - Enhanced operating point (highest accuracy)
 *   - Custom dictionary (additional_vocab) for playground terminology
 *   - Disfluency removal (um, uh, etc.)
 *   - en-GB output locale
 *   - Poll-based job completion with exponential backoff
 *
 * Flow:
 *   1. Submit audio + config as multipart form to POST /v2/jobs
 *   2. Poll GET /v2/jobs/{id} until status = 'done'
 *   3. Fetch transcript from GET /v2/jobs/{id}/transcript?format=json-v2
 *   4. Extract text + confidence from results
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Logger } from '../shared/logger';
import { BadRequestError } from '../shared/errors';

// =============================================
// CONFIGURATION
// =============================================

/** Speechmatics EU batch endpoint */
const API_BASE = 'https://eu1.asr.api.speechmatics.com/v2';

/** Minimum audio size in bytes (reject silence/corrupt files) */
const MIN_AUDIO_BYTES = 1_000;

/** Maximum audio size in bytes (50MB — Speechmatics limit) */
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/** Maximum time to wait for transcription job to complete (ms) */
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/** Initial poll interval (ms) */
const POLL_INTERVAL_INITIAL_MS = 2_000;

/** Maximum poll interval (ms) */
const POLL_INTERVAL_MAX_MS = 10_000;

/** Confidence below this triggers a warning log */
const LOW_CONFIDENCE_THRESHOLD = 0.7;

// =============================================
// TYPES
// =============================================

export interface TranscriptionResult {
  /** Full transcript text */
  readonly transcript: string;
  /** Average confidence score (0-1) */
  readonly confidence: number;
  /** Speechmatics job ID */
  readonly jobId: string;
  /** Audio duration in seconds */
  readonly durationSeconds: number;
  /** Model info */
  readonly model: string;
}

/** Speechmatics job status response */
interface JobStatusResponse {
  readonly job: {
    readonly id: string;
    readonly status: 'running' | 'done' | 'rejected';
    readonly duration?: number;
    readonly error?: string;
  };
}

/** Speechmatics JSON v2 transcript format */
interface TranscriptResponse {
  readonly metadata: {
    readonly created_at: string;
    readonly type: string;
    readonly transcription_config: {
      readonly language: string;
      readonly operating_point?: string;
    };
  };
  readonly results: readonly TranscriptResult[];
}

interface TranscriptResult {
  readonly type: 'word' | 'punctuation';
  readonly start_time: number;
  readonly end_time: number;
  readonly alternatives: readonly {
    readonly content: string;
    readonly confidence: number;
    readonly language?: string;
  }[];
  readonly is_eos?: boolean;
}

// =============================================
// CUSTOM DICTIONARY
// =============================================

/**
 * Playground and inspection terminology that Speechmatics
 * should recognise. Includes UK colloquialisms inspectors use.
 *
 * Format: { content: "word", sounds_like: ["phonetic hints"] }
 */
function buildCustomDictionary(): { content: string; sounds_like?: string[] }[] {
  return [
    // Equipment types
    { content: 'swing' },
    { content: 'slide' },
    { content: 'roundabout' },
    { content: 'seesaw' },
    { content: 'climbing frame' },
    { content: 'monkey bars' },
    { content: 'balance beam' },
    { content: 'springer', sounds_like: ['spring er'] },
    { content: 'multiplay', sounds_like: ['multi play'] },
    { content: 'zip wire', sounds_like: ['zip line'] },
    { content: 'MUGA', sounds_like: ['moo gah', 'muga'] },
    { content: 'skatepark' },
    { content: 'halfpipe', sounds_like: ['half pipe'] },
    { content: 'trim trail' },
    { content: 'overhead ladder' },

    // Surface types
    { content: 'wetpour', sounds_like: ['wet pour', 'wet pore'] },
    { content: 'rubber mulch' },
    { content: 'bark mulch' },
    { content: 'artificial grass' },
    { content: 'impact attenuation' },

    // Defect terms
    { content: 'corrosion' },
    { content: 'rust' },
    { content: 'splintering' },
    { content: 'delamination', sounds_like: ['de lamination'] },
    { content: 'subsidence' },
    { content: 'entrapment' },
    { content: 'protrusion' },
    { content: 'shackle' },
    { content: 'bearing' },
    { content: 'bush', sounds_like: ['bushing'] },
    { content: 'chain link' },
    { content: 'fixings' },
    { content: 'bolts' },
    { content: 'welds' },
    { content: 'graffiti' },
    { content: 'vandalism' },
    { content: 'head entrapment' },
    { content: 'finger entrapment' },
    { content: 'clothing entrapment' },
    { content: 'pinch point' },
    { content: 'trip hazard' },
    { content: 'sharp edge' },
    { content: 'missing cap' },
    { content: 'worn bearing' },
    { content: 'critical fall height' },

    // Standards
    { content: 'BS EN 1176', sounds_like: ['B S E N eleven seventy six', 'B S E N one one seven six'] },
    { content: 'BS EN 1177', sounds_like: ['B S E N eleven seventy seven', 'B S E N one one seven seven'] },
    { content: 'RoSPA', sounds_like: ['rospa'] },
    { content: 'RPII', sounds_like: ['R P I I', 'R P two I'] },

    // Actions
    { content: 'immediate action' },
    { content: 'closure required' },
    { content: 'decommission' },

    // UK inspector slang
    { content: 'dodgy', sounds_like: ['dodgey'] },
    { content: 'knackered', sounds_like: ['nackered'] },
    { content: 'bodged', sounds_like: ['bodge'] },
    { content: 'iffy' },
    { content: 'gone', sounds_like: ['gon'] },
    { content: 'shot' },
  ];
}

// =============================================
// TRANSCRIPTION
// =============================================

/**
 * Transcribe audio using Speechmatics Batch API.
 *
 * @param audioBytes — raw audio bytes (from R2)
 * @param mimeType — audio MIME type (e.g. 'audio/webm', 'audio/mp4')
 * @param apiKey — Speechmatics API key
 * @param requestId — for logging
 * @returns TranscriptionResult with transcript text and confidence
 */
export async function transcribeAudio(
  audioBytes: ArrayBuffer,
  mimeType: string,
  apiKey: string,
  requestId: string,
): Promise<TranscriptionResult> {
  const logger = Logger.minimal(requestId);

  // ── Input validation ──
  if (audioBytes.byteLength < MIN_AUDIO_BYTES) {
    throw new BadRequestError(
      `Audio too small (${audioBytes.byteLength} bytes). Minimum: ${MIN_AUDIO_BYTES} bytes.`,
    );
  }

  if (audioBytes.byteLength > MAX_AUDIO_BYTES) {
    throw new BadRequestError(
      `Audio too large (${Math.round(audioBytes.byteLength / (1024 * 1024))}MB). Maximum: ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.`,
    );
  }

  logger.info('Submitting audio to Speechmatics', {
    sizeBytes: audioBytes.byteLength,
    mimeType,
  });

  // ── Step 1: Submit job ──
  const jobId = await submitJob(audioBytes, mimeType, apiKey, logger);

  // ── Step 2: Poll for completion ──
  const jobResult = await pollForCompletion(jobId, apiKey, logger);

  // ── Step 3: Fetch transcript ──
  const transcript = await fetchTranscript(jobId, apiKey, logger);

  // ── Step 4: Extract text and confidence ──
  const { text, averageConfidence } = extractTextAndConfidence(transcript);

  if (averageConfidence < LOW_CONFIDENCE_THRESHOLD) {
    logger.warn('Low transcription confidence — may indicate poor audio quality', {
      jobId,
      confidence: averageConfidence,
      transcriptPreview: text.slice(0, 100),
    });
  }

  const result: TranscriptionResult = {
    transcript: text,
    confidence: averageConfidence,
    jobId,
    durationSeconds: jobResult.job.duration ?? 0,
    model: 'speechmatics-enhanced-en-GB',
  };

  logger.info('Transcription complete', {
    jobId,
    durationSeconds: result.durationSeconds,
    confidence: result.confidence,
    transcriptLength: result.transcript.length,
  });

  return result;
}

// =============================================
// API CALLS
// =============================================

/**
 * Submit audio file to Speechmatics batch API.
 * Uses multipart/form-data with config JSON + audio file.
 */
async function submitJob(
  audioBytes: ArrayBuffer,
  mimeType: string,
  apiKey: string,
  logger: Logger,
): Promise<string> {
  const config = {
    type: 'transcription',
    transcription_config: {
      language: 'en',
      operating_point: 'enhanced',
      output_locale: 'en-GB',
      additional_vocab: buildCustomDictionary(),
      transcript_filtering_config: {
        remove_disfluencies: true,
      },
      punctuation_overrides: {
        sensitivity: 0.6,
      },
    },
  };

  // Build multipart form data
  const formData = new FormData();
  formData.append('config', JSON.stringify(config));

  // Determine file extension from MIME type
  const ext = getExtensionFromMime(mimeType);
  const audioBlob = new Blob([audioBytes], { type: mimeType });
  formData.append('data_file', audioBlob, `audio.${ext}`);

  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    logger.error('Speechmatics job submission failed', null, {
      status: response.status,
      body: errorBody.slice(0, 500),
    });

    if (response.status === 401) {
      throw new Error('Speechmatics authentication failed. Check SPEECHMATICS_API_KEY.');
    }

    if (response.status === 400) {
      throw new BadRequestError(`Speechmatics rejected audio: ${errorBody.slice(0, 300)}`);
    }

    throw new Error(`Speechmatics job submission failed: ${response.status} ${errorBody.slice(0, 300)}`);
  }

  const result = (await response.json()) as { id: string };

  logger.info('Speechmatics job submitted', { jobId: result.id });

  return result.id;
}

/**
 * Poll Speechmatics job status until done or timeout.
 * Uses exponential backoff between polls.
 */
async function pollForCompletion(
  jobId: string,
  apiKey: string,
  logger: Logger,
): Promise<JobStatusResponse> {
  const startTime = Date.now();
  let pollInterval = POLL_INTERVAL_INITIAL_MS;

  while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
    // Wait before polling
    await delay(pollInterval);

    const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      logger.warn('Speechmatics poll request failed', {
        jobId,
        status: response.status,
      });
      // Increase backoff and retry
      pollInterval = Math.min(pollInterval * 1.5, POLL_INTERVAL_MAX_MS);
      continue;
    }

    const result = (await response.json()) as JobStatusResponse;

    if (result.job.status === 'done') {
      logger.info('Speechmatics job completed', {
        jobId,
        duration: result.job.duration,
        elapsedMs: Date.now() - startTime,
      });
      return result;
    }

    if (result.job.status === 'rejected') {
      throw new Error(
        `Speechmatics job rejected: ${result.job.error ?? 'Unknown reason'}`,
      );
    }

    // Still running — increase backoff
    pollInterval = Math.min(pollInterval * 1.3, POLL_INTERVAL_MAX_MS);
  }

  throw new Error(
    `Speechmatics transcription timed out after ${MAX_POLL_DURATION_MS / 1000}s (job: ${jobId})`,
  );
}

/**
 * Fetch the completed transcript in JSON v2 format.
 */
async function fetchTranscript(
  jobId: string,
  apiKey: string,
  logger: Logger,
): Promise<TranscriptResponse> {
  const response = await fetch(
    `${API_BASE}/jobs/${jobId}/transcript?format=json-v2`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to fetch transcript: ${response.status} ${errorBody.slice(0, 300)}`);
  }

  return (await response.json()) as TranscriptResponse;
}

// =============================================
// HELPERS
// =============================================

/**
 * Extract plain text and average confidence from Speechmatics JSON v2 results.
 */
function extractTextAndConfidence(
  transcript: TranscriptResponse,
): { text: string; averageConfidence: number } {
  const results = transcript.results;

  if (!results || results.length === 0) {
    return { text: '', averageConfidence: 0 };
  }

  const parts: string[] = [];
  let totalConfidence = 0;
  let wordCount = 0;

  for (const result of results) {
    const alt = result.alternatives[0];
    if (!alt) continue;

    if (result.type === 'word') {
      // Add space before word (unless first word)
      if (parts.length > 0) {
        parts.push(' ');
      }
      parts.push(alt.content);
      totalConfidence += alt.confidence;
      wordCount++;
    } else if (result.type === 'punctuation') {
      // Punctuation attaches directly to previous word (no space)
      parts.push(alt.content);
    }
  }

  const text = parts.join('');
  const averageConfidence = wordCount > 0 ? totalConfidence / wordCount : 0;

  return {
    text: text.trim(),
    averageConfidence: Math.round(averageConfidence * 1000) / 1000,
  };
}

/** Map MIME type to file extension */
function getExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
  };
  return map[mime.split(';')[0]?.trim() ?? mime] ?? 'webm';
}

/** Promise-based delay */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
