/**
 * InspectVoice — Voice Capture Service
 * Batch 12
 *
 * File: src/services/voiceCapture.ts
 *
 * Dual-mode voice capture:
 *   1. MediaRecorder — captures raw audio blob for Deepgram transcription (primary)
 *   2. Web Speech API — real-time browser-native speech-to-text (fallback / live preview)
 *
 * Both run simultaneously when available:
 *   - MediaRecorder captures the audio file → stored in IndexedDB → synced to R2 → Deepgram
 *   - Web Speech API provides instant on-screen transcript for inspector feedback
 *   - If Web Speech API unavailable, MediaRecorder still captures for async Deepgram processing
 *
 * Features:
 *   - Silence detection with configurable threshold and timeout
 *   - Audio compression (webm/opus preferred, mp4/aac fallback)
 *   - Recording duration limits (max 5 min per capture)
 *   - Amplitude monitoring for visual feedback (VU meter)
 *   - Graceful degradation: works with MediaRecorder only, Speech API only, or both
 *   - TypeScript strict, zero any, event-driven architecture
 *
 * Build Standard: Autaimate v3 — production-ready first time
 */

import { captureError } from '@utils/errorTracking';

// =============================================
// TYPES
// =============================================

/** Voice capture configuration */
export interface VoiceCaptureConfig {
  /** Language for speech recognition (default: 'en-GB') */
  language: string;
  /** Silence timeout in ms — auto-stop after this duration of silence (default: 3000) */
  silenceTimeoutMs: number;
  /** Silence amplitude threshold (0-1) — below this is "silence" (default: 0.01) */
  silenceThreshold: number;
  /** Maximum recording duration in ms (default: 300000 = 5 min) */
  maxDurationMs: number;
  /** Preferred MIME type for MediaRecorder (default: auto-detected) */
  preferredMimeType: string | null;
  /** Enable Web Speech API for live transcript (default: true) */
  enableLiveTranscript: boolean;
  /** Audio sample rate in Hz (default: 16000 for Deepgram compatibility) */
  sampleRate: number;
}

/** Default configuration */
export const DEFAULT_VOICE_CONFIG: VoiceCaptureConfig = {
  language: 'en-GB',
  silenceTimeoutMs: 3000,
  silenceThreshold: 0.01,
  maxDurationMs: 300_000,
  preferredMimeType: null,
  enableLiveTranscript: true,
  sampleRate: 16000,
};

/** Current state of the voice capture */
export enum VoiceCaptureState {
  IDLE = 'idle',
  REQUESTING_PERMISSION = 'requesting_permission',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  COMPLETED = 'completed',
  ERROR = 'error',
}

/** Reason recording stopped */
export enum StopReason {
  USER = 'user',
  SILENCE = 'silence',
  MAX_DURATION = 'max_duration',
  ERROR = 'error',
  PERMISSION_DENIED = 'permission_denied',
}

/** Result returned when recording completes */
export interface VoiceCaptureResult {
  /** Audio blob for storage and Deepgram processing */
  audioBlob: Blob;
  /** MIME type of the audio */
  mimeType: string;
  /** Duration in seconds */
  durationSeconds: number;
  /** Live transcript from Web Speech API (may be partial/empty) */
  liveTranscript: string;
  /** Why recording stopped */
  stopReason: StopReason;
  /** Timestamp when recording started */
  startedAt: string;
  /** Timestamp when recording ended */
  endedAt: string;
}

/** Events emitted during capture */
export interface VoiceCaptureEvents {
  /** State changed */
  onStateChange: (state: VoiceCaptureState) => void;
  /** Live transcript updated (from Web Speech API) */
  onTranscript: (transcript: string, isFinal: boolean) => void;
  /** Audio amplitude level for VU meter (0-1, ~60fps) */
  onAmplitude: (level: number) => void;
  /** Recording completed */
  onComplete: (result: VoiceCaptureResult) => void;
  /** Error occurred */
  onError: (error: VoiceCaptureError) => void;
  /** Duration tick (every second) */
  onDurationTick: (seconds: number) => void;
}

/** Structured error */
export class VoiceCaptureError extends Error {
  constructor(
    message: string,
    public readonly code: VoiceCaptureErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'VoiceCaptureError';
  }
}

export enum VoiceCaptureErrorCode {
  PERMISSION_DENIED = 'permission_denied',
  NO_MICROPHONE = 'no_microphone',
  MEDIARECORDER_UNSUPPORTED = 'mediarecorder_unsupported',
  RECORDING_FAILED = 'recording_failed',
  ALREADY_RECORDING = 'already_recording',
  NOT_RECORDING = 'not_recording',
  BROWSER_UNSUPPORTED = 'browser_unsupported',
}

/** Browser capability check result */
export interface BrowserCapabilities {
  mediaRecorder: boolean;
  webSpeechApi: boolean;
  getUserMedia: boolean;
  supportedMimeTypes: string[];
}

// =============================================
// CAPABILITY DETECTION
// =============================================

/** MIME types to try, in preference order (Deepgram supports all) */
const MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=aac',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

/** Check what the browser supports */
export function checkBrowserCapabilities(): BrowserCapabilities {
  const hasGetUserMedia = !!(
    navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
  );

  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

  const hasWebSpeech =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const supportedMimeTypes: string[] = [];
  if (hasMediaRecorder) {
    for (const mime of MIME_PREFERENCE) {
      if (MediaRecorder.isTypeSupported(mime)) {
        supportedMimeTypes.push(mime);
      }
    }
  }

  return {
    mediaRecorder: hasMediaRecorder && hasGetUserMedia,
    webSpeechApi: hasWebSpeech,
    getUserMedia: hasGetUserMedia,
    supportedMimeTypes,
  };
}

/** Get the best supported MIME type */
function selectMimeType(preferred: string | null): string {
  if (preferred && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(preferred)) {
    return preferred;
  }

  for (const mime of MIME_PREFERENCE) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  return 'audio/webm'; // Fallback — may not work but let MediaRecorder decide
}

// =============================================
// WEB SPEECH API WRAPPER
// =============================================

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item: (index: number) => SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult | undefined;
}

interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  item: (index: number) => SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative | undefined;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

/** Create a SpeechRecognition instance if available */
function createSpeechRecognition(lang: string): SpeechRecognitionInstance | null {
  const SpeechRecognitionCtor =
    (window as Record<string, unknown>)['SpeechRecognition'] ??
    (window as Record<string, unknown>)['webkitSpeechRecognition'];

  if (!SpeechRecognitionCtor || typeof SpeechRecognitionCtor !== 'function') {
    return null;
  }

  const recognition = new (SpeechRecognitionCtor as new () => SpeechRecognitionInstance)();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = lang;

  return recognition;
}

// =============================================
// VOICE CAPTURE CLASS
// =============================================

export class VoiceCapture {
  private config: VoiceCaptureConfig;
  private events: Partial<VoiceCaptureEvents>;
  private state: VoiceCaptureState = VoiceCaptureState.IDLE;

  // MediaRecorder
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private mimeType: string = 'audio/webm';

  // Web Speech API
  private speechRecognition: SpeechRecognitionInstance | null = null;
  private finalTranscript: string = '';
  private interimTranscript: string = '';

  // Audio analysis (for silence detection + VU meter)
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private amplitudeData: Uint8Array | null = null;
  private amplitudeFrameId: number | null = null;

  // Silence detection
  private silenceStartTime: number | null = null;
  private silenceCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Timing
  private recordingStartTime: number = 0;
  private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private durationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: Partial<VoiceCaptureConfig> = {},
    events: Partial<VoiceCaptureEvents> = {},
  ) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.events = events;
  }

  /** Current state */
  getState(): VoiceCaptureState {
    return this.state;
  }

  /** Whether currently recording */
  isRecording(): boolean {
    return this.state === VoiceCaptureState.RECORDING;
  }

  /** Current live transcript */
  getTranscript(): string {
    return (this.finalTranscript + ' ' + this.interimTranscript).trim();
  }

  /** Current recording duration in seconds */
  getDuration(): number {
    if (this.recordingStartTime === 0) return 0;
    return Math.round((Date.now() - this.recordingStartTime) / 1000);
  }

  // ---- STATE MANAGEMENT ----

  private setState(newState: VoiceCaptureState): void {
    this.state = newState;
    this.events.onStateChange?.(newState);
  }

  private emitError(message: string, code: VoiceCaptureErrorCode, original?: unknown): void {
    const error = new VoiceCaptureError(message, code, original);
    this.setState(VoiceCaptureState.ERROR);
    this.events.onError?.(error);
    captureError(error, { module: 'voiceCapture', operation: 'recording' });
  }

  // ---- START RECORDING ----

  async start(): Promise<void> {
    if (this.state === VoiceCaptureState.RECORDING) {
      this.emitError('Already recording', VoiceCaptureErrorCode.ALREADY_RECORDING);
      return;
    }

    this.reset();
    this.setState(VoiceCaptureState.REQUESTING_PERMISSION);

    // Check capabilities
    const caps = checkBrowserCapabilities();
    if (!caps.getUserMedia) {
      this.emitError(
        'Microphone access is not supported in this browser',
        VoiceCaptureErrorCode.BROWSER_UNSUPPORTED,
      );
      return;
    }

    // Request microphone permission
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: this.config.sampleRate },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      const err = error instanceof DOMException ? error : new Error(String(error));

      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.emitError('Microphone permission denied', VoiceCaptureErrorCode.PERMISSION_DENIED, error);
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        this.emitError('No microphone found', VoiceCaptureErrorCode.NO_MICROPHONE, error);
      } else {
        this.emitError('Failed to access microphone', VoiceCaptureErrorCode.RECORDING_FAILED, error);
      }
      return;
    }

    // Start MediaRecorder
    this.mimeType = selectMimeType(this.config.preferredMimeType);
    try {
      this.startMediaRecorder();
    } catch (error) {
      this.emitError('Failed to start audio recording', VoiceCaptureErrorCode.RECORDING_FAILED, error);
      this.cleanupStream();
      return;
    }

    // Start audio analysis (silence detection + VU meter)
    this.startAudioAnalysis();

    // Start Web Speech API (if enabled and available)
    if (this.config.enableLiveTranscript) {
      this.startSpeechRecognition();
    }

    // Start timers
    this.recordingStartTime = Date.now();
    this.startDurationTimer();
    this.startMaxDurationTimer();
    this.startSilenceDetection();

    this.setState(VoiceCaptureState.RECORDING);
  }

  // ---- STOP RECORDING ----

  async stop(reason: StopReason = StopReason.USER): Promise<VoiceCaptureResult | null> {
    if (this.state !== VoiceCaptureState.RECORDING && this.state !== VoiceCaptureState.PAUSED) {
      return null;
    }

    this.setState(VoiceCaptureState.STOPPING);

    // Stop all subsystems
    this.stopTimers();
    this.stopSilenceDetection();
    this.stopAmplitudeMonitor();
    this.stopSpeechRecognition();

    // Stop MediaRecorder and collect final blob
    const audioBlob = await this.stopMediaRecorder();

    // Clean up audio stream
    this.cleanupStream();
    this.cleanupAudioContext();

    const endedAt = new Date().toISOString();
    const durationSeconds = Math.round((Date.now() - this.recordingStartTime) / 1000);

    this.setState(VoiceCaptureState.COMPLETED);

    if (!audioBlob || audioBlob.size === 0) {
      this.emitError('No audio data captured', VoiceCaptureErrorCode.RECORDING_FAILED);
      return null;
    }

    const result: VoiceCaptureResult = {
      audioBlob,
      mimeType: this.mimeType,
      durationSeconds,
      liveTranscript: this.finalTranscript.trim(),
      stopReason: reason,
      startedAt: new Date(this.recordingStartTime).toISOString(),
      endedAt,
    };

    this.events.onComplete?.(result);
    return result;
  }

  // ---- PAUSE / RESUME ----

  pause(): void {
    if (this.state !== VoiceCaptureState.RECORDING) return;

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }

    this.stopSilenceDetection();
    this.stopAmplitudeMonitor();
    this.stopSpeechRecognition();

    this.setState(VoiceCaptureState.PAUSED);
  }

  resume(): void {
    if (this.state !== VoiceCaptureState.PAUSED) return;

    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }

    this.startAmplitudeMonitor();
    this.startSilenceDetection();

    if (this.config.enableLiveTranscript) {
      this.startSpeechRecognition();
    }

    this.setState(VoiceCaptureState.RECORDING);
  }

  // ---- CANCEL ----

  cancel(): void {
    this.stopTimers();
    this.stopSilenceDetection();
    this.stopAmplitudeMonitor();
    this.stopSpeechRecognition();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.cleanupStream();
    this.cleanupAudioContext();
    this.reset();
    this.setState(VoiceCaptureState.IDLE);
  }

  // ---- DESTROY (cleanup all resources) ----

  destroy(): void {
    this.cancel();
    this.events = {};
  }

  // =============================================
  // MEDIARECORDER
  // =============================================

  private startMediaRecorder(): void {
    if (!this.audioStream) return;

    const options: MediaRecorderOptions = {
      mimeType: this.mimeType,
    };

    this.mediaRecorder = new MediaRecorder(this.audioStream, options);
    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onerror = () => {
      this.emitError('MediaRecorder error', VoiceCaptureErrorCode.RECORDING_FAILED);
    };

    // Request data every 1 second for progressive capture
    this.mediaRecorder.start(1000);
  }

  private stopMediaRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(this.audioChunks.length > 0 ? new Blob(this.audioChunks, { type: this.mimeType }) : null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: this.mimeType });
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  // =============================================
  // WEB SPEECH API
  // =============================================

  private startSpeechRecognition(): void {
    try {
      this.speechRecognition = createSpeechRecognition(this.config.language);
      if (!this.speechRecognition) return;

      this.speechRecognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;

          const alternative = result[0];
          if (!alternative) continue;

          if (result.isFinal) {
            this.finalTranscript += alternative.transcript + ' ';
            this.events.onTranscript?.(this.finalTranscript.trim(), true);
          } else {
            interim += alternative.transcript;
          }
        }

        this.interimTranscript = interim;
        if (interim) {
          this.events.onTranscript?.((this.finalTranscript + interim).trim(), false);
        }
      };

      this.speechRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // 'no-speech' and 'aborted' are non-critical — don't surface to user
        if (event.error === 'no-speech' || event.error === 'aborted') return;

        console.warn('[VoiceCapture] Speech recognition error:', event.error);
      };

      this.speechRecognition.onend = () => {
        // Auto-restart if still recording (Speech API has a tendency to stop)
        if (this.state === VoiceCaptureState.RECORDING && this.speechRecognition) {
          try {
            this.speechRecognition.start();
          } catch {
            // Already started or other issue — ignore
          }
        }
      };

      this.speechRecognition.start();
    } catch (error) {
      // Non-critical — MediaRecorder still captures audio for async Deepgram
      console.warn('[VoiceCapture] Speech recognition not available:', error);
    }
  }

  private stopSpeechRecognition(): void {
    if (this.speechRecognition) {
      try {
        this.speechRecognition.onend = null;
        this.speechRecognition.onresult = null;
        this.speechRecognition.onerror = null;
        this.speechRecognition.abort();
      } catch {
        // Ignore — may already be stopped
      }
      this.speechRecognition = null;
    }
  }

  // =============================================
  // AUDIO ANALYSIS (Silence Detection + VU Meter)
  // =============================================

  private startAudioAnalysis(): void {
    if (!this.audioStream) return;

    try {
      this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });
      const source = this.audioContext.createMediaStreamSource(this.audioStream);

      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.3;

      source.connect(this.analyserNode);

      this.amplitudeData = new Uint8Array(this.analyserNode.frequencyBinCount);

      this.startAmplitudeMonitor();
    } catch (error) {
      // Non-critical — recording still works without VU meter / silence detection
      console.warn('[VoiceCapture] Audio analysis setup failed:', error);
    }
  }

  private startAmplitudeMonitor(): void {
    if (!this.analyserNode || !this.amplitudeData) return;

    const monitor = (): void => {
      if (this.state !== VoiceCaptureState.RECORDING) return;

      this.analyserNode!.getByteTimeDomainData(this.amplitudeData!);

      // Calculate RMS amplitude (0-1)
      let sum = 0;
      for (let i = 0; i < this.amplitudeData!.length; i++) {
        const val = (this.amplitudeData![i]! - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / this.amplitudeData!.length);

      this.events.onAmplitude?.(Math.min(rms * 3, 1)); // Scale up for visual feedback

      this.amplitudeFrameId = requestAnimationFrame(monitor);
    };

    this.amplitudeFrameId = requestAnimationFrame(monitor);
  }

  private stopAmplitudeMonitor(): void {
    if (this.amplitudeFrameId !== null) {
      cancelAnimationFrame(this.amplitudeFrameId);
      this.amplitudeFrameId = null;
    }
  }

  // =============================================
  // SILENCE DETECTION
  // =============================================

  private startSilenceDetection(): void {
    this.silenceStartTime = null;

    this.silenceCheckInterval = setInterval(() => {
      if (this.state !== VoiceCaptureState.RECORDING) return;
      if (!this.analyserNode || !this.amplitudeData) return;

      this.analyserNode.getByteTimeDomainData(this.amplitudeData);

      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < this.amplitudeData.length; i++) {
        const val = (this.amplitudeData[i]! - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / this.amplitudeData.length);

      if (rms < this.config.silenceThreshold) {
        // Below threshold — track silence duration
        if (this.silenceStartTime === null) {
          this.silenceStartTime = Date.now();
        } else {
          const silenceDuration = Date.now() - this.silenceStartTime;
          if (silenceDuration >= this.config.silenceTimeoutMs) {
            // Auto-stop due to silence
            void this.stop(StopReason.SILENCE);
          }
        }
      } else {
        // Sound detected — reset silence timer
        this.silenceStartTime = null;
      }
    }, 200); // Check every 200ms
  }

  private stopSilenceDetection(): void {
    if (this.silenceCheckInterval !== null) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
    this.silenceStartTime = null;
  }

  // =============================================
  // TIMERS
  // =============================================

  private startDurationTimer(): void {
    this.durationInterval = setInterval(() => {
      const seconds = this.getDuration();
      this.events.onDurationTick?.(seconds);
    }, 1000);
  }

  private startMaxDurationTimer(): void {
    this.maxDurationTimeout = setTimeout(() => {
      if (this.state === VoiceCaptureState.RECORDING) {
        void this.stop(StopReason.MAX_DURATION);
      }
    }, this.config.maxDurationMs);
  }

  private stopTimers(): void {
    if (this.durationInterval !== null) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
    if (this.maxDurationTimeout !== null) {
      clearTimeout(this.maxDurationTimeout);
      this.maxDurationTimeout = null;
    }
  }

  // =============================================
  // CLEANUP
  // =============================================

  private cleanupStream(): void {
    if (this.audioStream) {
      for (const track of this.audioStream.getTracks()) {
        track.stop();
      }
      this.audioStream = null;
    }
  }

  private cleanupAudioContext(): void {
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {
        // Ignore — context may already be closed
      });
      this.audioContext = null;
      this.analyserNode = null;
      this.amplitudeData = null;
    }
  }

  private reset(): void {
    this.audioChunks = [];
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.recordingStartTime = 0;
    this.mediaRecorder = null;
  }
}

// =============================================
// FACTORY FUNCTION
// =============================================

/**
 * Create a new VoiceCapture instance.
 *
 * Usage:
 *   const capture = createVoiceCapture(
 *     { silenceTimeoutMs: 5000 },
 *     {
 *       onStateChange: (state) => setRecordingState(state),
 *       onTranscript: (text, isFinal) => setTranscript(text),
 *       onAmplitude: (level) => setVuLevel(level),
 *       onComplete: (result) => handleRecordingComplete(result),
 *       onError: (error) => handleError(error),
 *       onDurationTick: (seconds) => setDuration(seconds),
 *     },
 *   );
 *
 *   await capture.start();
 *   // ... user speaks ...
 *   const result = await capture.stop();
 *   // result.audioBlob → IndexedDB → R2 → Deepgram
 *   // result.liveTranscript → instant on-screen feedback
 */
export function createVoiceCapture(
  config: Partial<VoiceCaptureConfig> = {},
  events: Partial<VoiceCaptureEvents> = {},
): VoiceCapture {
  return new VoiceCapture(config, events);
}

// =============================================
// UTILITY: FORMAT DURATION
// =============================================

/** Format seconds as MM:SS for display */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Format blob size for display */
export function formatBlobSize(blob: Blob): string {
  const kb = blob.size / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}
