/**
 * InspectVoice — Whisper Transcription Service (Default Tier)
 * Cloudflare Workers AI Whisper for fast, free transcription.
 *
 * This is Tier 1 in the transcription pipeline:
 *   Tier 1: Whisper (default) — fast, free, good accuracy
 *   Tier 2: Speechmatics (escalation) — enhanced accuracy, custom dictionary, paid
 *
 * Escalation triggers (checked by audioProcessor.ts):
 *   - Inspector taps "High accuracy" override
 *   - Audio is long/critical (annual inspection summary)
 *   - Post-processor detects likely standards vocabulary but garbled output
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Logger } from '../shared/logger';
import { BadRequestError } from '../shared/errors';

// =============================================
// CONFIGURATION
// =============================================

/** Whisper model on Cloudflare Workers AI */
const WHISPER_MODEL = '@cf/openai/whisper';

/** Minimum audio size in bytes */
const MIN_AUDIO_BYTES = 1_000;

/** Maximum audio size for Whisper (25MB — Cloudflare limit) */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// =============================================
// TYPES
// =============================================

export interface WhisperTranscriptionResult {
  /** Full transcript text */
  readonly transcript: string;
  /** Audio duration in seconds (from word timestamps if available) */
  readonly durationSeconds: number;
  /** Word count */
  readonly wordCount: number;
  /** Whisper doesn't return confidence — always 1.0 as placeholder */
  readonly confidence: number;
  /** Model identifier */
  readonly model: string;
  /** Processing time in ms */
  readonly processingMs: number;
}

/** Cloudflare Workers AI Whisper response shape */
interface WhisperResponse {
  text?: string;
  word_count?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  vtt?: string;
}

/** Cloudflare Workers AI binding */
interface AiBinding {
  run: (model: string, input: Record<string, unknown>) => Promise<WhisperResponse>;
}

// =============================================
// VOCABULARY PATTERNS
// =============================================

/**
 * Patterns that indicate the transcript likely contains playground/standards terminology.
 * Used by the post-processor to decide whether to escalate to Speechmatics.
 *
 * These are checked against the Whisper output — if the raw text contains
 * fragments that SHOULD be standards refs but are garbled, escalation triggers.
 */
const STANDARDS_VOCABULARY_PATTERNS: readonly RegExp[] = [
  // BS EN references (exact or garbled)
  /\b(?:bs|b\.s\.?)\s*(?:en|e\.n\.?)\s*\d/i,
  /\b(?:eleven|1{1,2})\s*(?:seventy[\s-]?six|76|seventy[\s-]?seven|77)\b/i,
  /\b(?:sixteen|16)\s*(?:six[\s-]?thirty|630)\b/i,
  // Clause references
  /\bclause\s+\d/i,
  /\bsection\s+\d/i,
  /\b§\s*\d/,
  // Technical terms that Whisper might garble
  /\brospa\b/i,
  /\brpii\b/i,
  /\bentrapment\b/i,
  /\bprotrusion\b/i,
  /\bdelamination\b/i,
  /\battenuation\b/i,
  /\bwetpour\b/i,
  /\bcritical\s+fall\s+height\b/i,
  // Manufacturer names (commonly misheard)
  /\b(?:kompan|wicksteed|playdale|sutcliffe|hags|proludic|lappset)\b/i,
];

/**
 * Garbled output indicators — suggest Whisper struggled with the audio.
 * More than N of these in a short transcript = escalate.
 */
const GARBLED_INDICATORS: readonly RegExp[] = [
  // Repeated words (Whisper hallucination)
  /\b(\w+)\s+\1\s+\1\b/i,
  // Nonsense number sequences where standards refs should be
  /\b(?:one\s+one\s+seven|eleven\s+seven)\b/i,
  // Truncated sentences (Whisper sometimes cuts off)
  /\.\.\.\s*$/,
];

// =============================================
// TRANSCRIPTION
// =============================================

/**
 * Transcribe audio using Cloudflare Workers AI Whisper.
 *
 * @param audioBytes — raw audio bytes (from R2)
 * @param ai — Cloudflare Workers AI binding (env.AI)
 * @param requestId — for logging
 * @returns WhisperTranscriptionResult
 */
export async function transcribeWithWhisper(
  audioBytes: ArrayBuffer,
  ai: AiBinding,
  requestId: string,
): Promise<WhisperTranscriptionResult> {
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

  logger.info('Transcribing with Whisper', { sizeBytes: audioBytes.byteLength });

  const startTime = Date.now();

  // ── Call Whisper ──
  const audioArray = [...new Uint8Array(audioBytes)];

  const result: WhisperResponse = await ai.run(WHISPER_MODEL, {
    audio: audioArray,
    source_lang: 'en',
  });

  const processingMs = Date.now() - startTime;
  const transcript = (result.text ?? '').trim();

  if (!transcript) {
    logger.warn('Whisper returned empty transcript', {
      processingMs,
      sizeBytes: audioBytes.byteLength,
    });
    throw new BadRequestError('No speech detected in audio. Please try again and speak clearly.');
  }

  // Calculate duration from word timestamps if available
  let durationSeconds = 0;
  if (result.words && result.words.length > 0) {
    const lastWord = result.words[result.words.length - 1];
    if (lastWord) {
      durationSeconds = Math.ceil(lastWord.end);
    }
  }

  const wordCount = result.word_count ?? transcript.split(/\s+/).length;

  const whisperResult: WhisperTranscriptionResult = {
    transcript,
    durationSeconds,
    wordCount,
    confidence: 1.0, // Whisper doesn't return confidence
    model: 'cloudflare-whisper',
    processingMs,
  };

  logger.info('Whisper transcription complete', {
    wordCount,
    durationSeconds,
    processingMs,
    transcriptLength: transcript.length,
  });

  return whisperResult;
}

// =============================================
// ESCALATION DETECTION
// =============================================

/**
 * Analyse a Whisper transcript to determine if Speechmatics escalation is needed.
 *
 * Returns true if:
 *   1. Transcript contains likely standards vocabulary (BS EN, clause refs, etc.)
 *   2. Transcript shows signs of garbled output (repeated words, hallucination)
 *   3. Audio duration exceeds threshold (long recordings = more important)
 *
 * @param transcript — Whisper output text
 * @param audioDurationSeconds — length of the audio
 * @param inspectionType — type of inspection (annual_main gets priority)
 * @returns Whether to escalate to Speechmatics
 */
export function shouldEscalateToSpeechmatics(
  transcript: string,
  audioDurationSeconds: number,
  inspectionType: string,
): { escalate: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Rule 1: Annual inspection summaries are always high-accuracy
  if (inspectionType === 'annual_main' && audioDurationSeconds > 60) {
    reasons.push('annual_inspection_long_recording');
  }

  // Rule 2: Transcript contains standards vocabulary
  const hasStandardsVocab = STANDARDS_VOCABULARY_PATTERNS.some((pattern) => pattern.test(transcript));
  if (hasStandardsVocab) {
    reasons.push('standards_vocabulary_detected');
  }

  // Rule 3: Transcript shows garbled indicators
  let garbledCount = 0;
  for (const pattern of GARBLED_INDICATORS) {
    if (pattern.test(transcript)) {
      garbledCount++;
    }
  }
  if (garbledCount > 0) {
    reasons.push(`garbled_output_${garbledCount}_indicators`);
  }

  // Rule 4: Very long recordings (>3 min) with standards vocab
  if (audioDurationSeconds > 180 && hasStandardsVocab) {
    reasons.push('long_recording_with_standards');
  }

  // Escalate if any reasons found
  return {
    escalate: reasons.length > 0,
    reasons,
  };
}
