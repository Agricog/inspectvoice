/**
 * InspectVoice — Voice Capture Service
 * Rewrite: 2 Mar 2026
 *
 * File: src/services/voiceCapture.ts
 *
 * Dual-mode voice capture with proper lifecycle management:
 *
 *   CaptureMode.MANUAL (default for inspections):
 *     - Inspector taps Record, speaks, taps Stop
 *     - NO silence auto-stop — inspectors pause to think, move, check things
 *     - Max duration safety net (5 min) still applies
 *
 *   CaptureMode.AUTO (for future hands-free workflows):
 *     - Silence detection triggers auto-stop after configurable timeout
 *     - Suitable for quick dictation where hands-free stop is needed
 *
 * Architecture:
 *   - MediaRecorder captures audio blob → IndexedDB → R2 → Whisper/Speechmatics
 *   - Web Speech API provides live on-screen transcript (Chrome/Edge only)
 *   - Both run simultaneously when available
 *   - Each subsystem is isolated — failure in one doesn't kill the other
 *   - Recording state is the single source of truth (not transcription state)
 *
 * Key fixes from previous version:
 *   1. Silence detection no longer kills manual recordings
 *   2. Speech API restart has debounce + max retries + double-start guard
 *   3. Every operation validates MediaRecorder.state before acting
 *   4. Explicit state transitions prevent phantom recording states
 *   5. Subsystem errors are logged but don't cascade
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { captureError } from '@utils/errorTracking';

// =============================================
// TYPES & ENUMS
// =============================================

/** Recording mode determines stop behaviour */
export enum CaptureMode {
  /** Inspector controls stop manually. No silence auto-stop. Default for inspections. */
  MANUAL = 'manual',
  /** Silence detection triggers auto-stop. For hands-free dictation. */
  AUTO = 'auto',
}

/** Voice capture configuration */
export interface VoiceCaptureConfig {
  /** Capture mode (default: MANUAL) */
  mode: CaptureMode;
  /** Language for speech recognition (default: 'en-GB') */
  language: string;
  /** [AUTO mode only] Silence timeout in ms (default: 5000) */
  silenceTimeoutMs: number;
  /** [AUTO mode only] Silence amplitude threshold 0-1 (default: 0.02) */
  silenceThreshold: number;
  /** Maximum recording duration in ms (default: 300000 = 5 min) */
  maxDurationMs: number;
  /** Preferred MIME type for MediaRecorder (default: auto-detected) */
  preferredMimeType: string | null;
  /** Enable Web Speech API for live transcript (default: true) */
  enableLiveTranscript: boolean;
  /** Audio sample rate in Hz (default: 16000 for Whisper/Speechmatics) */
  sampleRate: number;
}

/** Default configuration — MANUAL mode, no silence auto-stop */
export const DEFAULT_VOICE_CONFIG: VoiceCaptureConfig = {
  mode: CaptureMode.MANUAL,
  language: 'en-GB',
  silenceTimeoutMs: 5_000,
  silenceThreshold: 0.02,
  maxDurationMs: 300_000,
  preferredMimeType: null,
  enableLiveTranscript: true,
  sampleRate: 16_000,
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
  /** Audio blob for storage and server-side transcription */
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

/** MIME types to try, in preference order */
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

  return 'audio/webm';
}

// =============================================
// WEB SPEECH API TYPES
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
  onstart: (() => void) | null;
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

// =============================================
// SPEECH API MANAGER
// =============================================

/**
 * Isolated Speech API lifecycle manager.
 * Handles the restart dance that Web Speech API requires
 * without leaking state into the main capture class.
 */
class SpeechApiManager {
  private recognition: SpeechRecognitionInstance | null = null;
  private isStarting: boolean = false;
  private isActive: boolean = false;
  private restartCount: number = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed: boolean = false;

  /** Max consecutive restarts before giving up (prevent infinite loop) */
  private static readonly MAX_RESTARTS = 15;
  /** Minimum ms between restart attempts (debounce) */
  private static readonly RESTART_DEBOUNCE_MS = 300;

  constructor(
    private readonly lang: string,
    private readonly onTranscriptUpdate: (finalText: string, interimText: string) => void,
    private readonly onSpeechError: (error: string) => void,
  ) {}

  /** Start the Speech API session */
  start(): void {
    if (this.destroyed || this.isStarting || this.isActive) return;

    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>)['SpeechRecognition'] ??
      (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'];

    if (!SpeechRecognitionCtor || typeof SpeechRecognitionCtor !== 'function') {
      return;
    }

    try {
      this.recognition = new (SpeechRecognitionCtor as new () => SpeechRecognitionInstance)();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.lang;
      this.restartCount = 0;

      this.bindEvents();
      this.doStart();
    } catch (error) {
      console.warn('[VoiceCapture] Speech API init failed:', error);
    }
  }

  /** Stop the Speech API session permanently (until next start() call) */
  stop(): void {
    this.clearRestartTimer();

    if (this.recognition) {
      // Detach handlers FIRST to prevent onend from triggering restart
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.onstart = null;

      try {
        this.recognition.abort();
      } catch {
        // Already stopped
      }

      this.recognition = null;
    }

    this.isStarting = false;
    this.isActive = false;
    this.restartCount = 0;
  }

  /** Permanently destroy — no restart possible */
  destroy(): void {
    this.destroyed = true;
    this.stop();
  }

  /** Whether the Speech API is currently active */
  getIsActive(): boolean {
    return this.isActive;
  }

  // ── Internal ──

  private bindEvents(): void {
    if (!this.recognition) return;

    let finalTranscript = '';

    this.recognition.onstart = () => {
      this.isStarting = false;
      this.isActive = true;
      this.restartCount = 0; // Reset on successful start
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const alternative = result[0];
        if (!alternative) continue;

        if (result.isFinal) {
          finalTranscript += alternative.transcript + ' ';
        } else {
          interim += alternative.transcript;
        }
      }

      this.onTranscriptUpdate(finalTranscript, interim);
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isStarting = false;

      // Non-critical errors — Speech API fires these routinely
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // 'not-allowed' means the browser blocked it — don't retry
      if (event.error === 'not-allowed') {
        this.onSpeechError('Speech recognition permission denied');
        return;
      }

      console.warn('[VoiceCapture] Speech API error:', event.error);
    };

    this.recognition.onend = () => {
      this.isActive = false;
      this.isStarting = false;

      // Auto-restart if not destroyed and under retry limit
      if (!this.destroyed && this.restartCount < SpeechApiManager.MAX_RESTARTS) {
        this.scheduleRestart();
      }
    };
  }

  private doStart(): void {
    if (this.destroyed || this.isStarting || this.isActive || !this.recognition) return;

    this.isStarting = true;

    try {
      this.recognition.start();
    } catch (error) {
      this.isStarting = false;

      // 'already started' — Speech API sometimes fires this on rapid restart
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already started')) {
        this.isActive = true;
        return;
      }

      console.warn('[VoiceCapture] Speech API start failed:', error);
    }
  }

  private scheduleRestart(): void {
    this.clearRestartTimer();

    this.restartTimer = setTimeout(() => {
      this.restartCount++;
      this.doStart();
    }, SpeechApiManager.RESTART_DEBOUNCE_MS);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
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

  // Web Speech API (isolated manager)
  private speechManager: SpeechApiManager | null = null;
  private finalTranscript: string = '';
  private interimTranscript: string = '';

  // Audio analysis (VU meter + optional silence detection)
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private amplitudeData: Uint8Array<ArrayBuffer> | null = null;
  private amplitudeFrameId: number | null = null;

  // Silence detection (AUTO mode only)
  private silenceStartTime: number | null = null;
  private silenceCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Timing
  private recordingStartTime: number = 0;
  private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private durationInterval: ReturnType<typeof setInterval> | null = null;

  // Guards
  private isStopping: boolean = false;

  constructor(
    config: Partial<VoiceCaptureConfig> = {},
    events: Partial<VoiceCaptureEvents> = {},
  ) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
    this.events = events;
  }

  // ---- PUBLIC GETTERS ----

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

  /** Current capture mode */
  getMode(): CaptureMode {
    return this.config.mode;
  }

  // ---- STATE MANAGEMENT ----

  private setState(newState: VoiceCaptureState): void {
    const previous = this.state;
    this.state = newState;

    // Only emit if actually changed (prevents duplicate renders)
    if (previous !== newState) {
      this.events.onStateChange?.(newState);
    }
  }

  private emitError(message: string, code: VoiceCaptureErrorCode, original?: unknown): void {
    const error = new VoiceCaptureError(message, code, original);
    this.setState(VoiceCaptureState.ERROR);
    this.events.onError?.(error);
    captureError(error, { module: 'voiceCapture', operation: 'recording' });
  }

  // ---- START RECORDING ----

  async start(): Promise<void> {
    // Guard: already recording
    if (this.state === VoiceCaptureState.RECORDING || this.state === VoiceCaptureState.REQUESTING_PERMISSION) {
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

    // Verify MediaRecorder actually started
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      this.emitError('MediaRecorder failed to enter recording state', VoiceCaptureErrorCode.RECORDING_FAILED);
      this.cleanupStream();
      return;
    }

    // Start audio analysis (VU meter — always runs)
    this.startAudioAnalysis();

    // Start Web Speech API for live transcript (if enabled and available)
    if (this.config.enableLiveTranscript) {
      this.startSpeechRecognition();
    }

    // Start timers
    this.recordingStartTime = Date.now();
    this.isStopping = false;
    this.startDurationTimer();
    this.startMaxDurationTimer();

    // Silence detection: AUTO mode only
    if (this.config.mode === CaptureMode.AUTO) {
      this.startSilenceDetection();
    }

    this.setState(VoiceCaptureState.RECORDING);
  }

  // ---- STOP RECORDING ----

  async stop(reason: StopReason = StopReason.USER): Promise<VoiceCaptureResult | null> {
    // Guard: not in a stoppable state
    if (this.state !== VoiceCaptureState.RECORDING && this.state !== VoiceCaptureState.PAUSED) {
      return null;
    }

    // Guard: already stopping (prevents double-stop from timer + user tap)
    if (this.isStopping) {
      return null;
    }
    this.isStopping = true;

    this.setState(VoiceCaptureState.STOPPING);

    // Stop all subsystems (order matters)
    this.stopTimers();
    this.stopSilenceDetection();
    this.stopAmplitudeMonitor();
    this.stopSpeechRecognition();

    // Stop MediaRecorder and collect final blob
    const audioBlob = await this.stopMediaRecorder();

    // Clean up hardware resources
    this.cleanupStream();
    this.cleanupAudioContext();

    const endedAt = new Date().toISOString();
    const durationSeconds = Math.max(1, Math.round((Date.now() - this.recordingStartTime) / 1000));

    if (!audioBlob || audioBlob.size === 0) {
      this.emitError('No audio data captured', VoiceCaptureErrorCode.RECORDING_FAILED);
      return null;
    }

    this.setState(VoiceCaptureState.COMPLETED);

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

    // Validate MediaRecorder is actually recording before pausing
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

    // Validate MediaRecorder is actually paused before resuming
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }

    this.startAmplitudeMonitor();

    if (this.config.mode === CaptureMode.AUTO) {
      this.startSilenceDetection();
    }

    if (this.config.enableLiveTranscript) {
      this.startSpeechRecognition();
    }

    this.setState(VoiceCaptureState.RECORDING);
  }

  // ---- CANCEL ----

  cancel(): void {
    this.isStopping = true;
    this.stopTimers();
    this.stopSilenceDetection();
    this.stopAmplitudeMonitor();
    this.stopSpeechRecognition();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Already stopped
      }
    }

    this.cleanupStream();
    this.cleanupAudioContext();
    this.reset();
    this.setState(VoiceCaptureState.IDLE);
  }

  // ---- DESTROY ----

  destroy(): void {
    this.cancel();
    this.events = {};
  }

  // =============================================
  // MEDIARECORDER
  // =============================================

  private startMediaRecorder(): void {
    if (!this.audioStream) return;

    const options: MediaRecorderOptions = { mimeType: this.mimeType };

    this.mediaRecorder = new MediaRecorder(this.audioStream, options);
    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onerror = () => {
      // Only emit error if we're not already stopping
      if (!this.isStopping) {
        this.emitError('MediaRecorder error', VoiceCaptureErrorCode.RECORDING_FAILED);
      }
    };

    // Request data every 1 second for progressive capture
    this.mediaRecorder.start(1000);
  }

  private stopMediaRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        // Already stopped — return whatever chunks we have
        resolve(
          this.audioChunks.length > 0
            ? new Blob(this.audioChunks, { type: this.mimeType })
            : null,
        );
        return;
      }

      // Set up handler BEFORE calling stop
      this.mediaRecorder.onstop = () => {
        const blob = this.audioChunks.length > 0
          ? new Blob(this.audioChunks, { type: this.mimeType })
          : null;
        resolve(blob);
      };

      try {
        this.mediaRecorder.stop();
      } catch {
        // stop() can throw if state is unexpected
        resolve(
          this.audioChunks.length > 0
            ? new Blob(this.audioChunks, { type: this.mimeType })
            : null,
        );
      }
    });
  }

  // =============================================
  // WEB SPEECH API (via SpeechApiManager)
  // =============================================

  private startSpeechRecognition(): void {
    // Clean up any existing manager first
    this.stopSpeechRecognition();

    try {
      this.speechManager = new SpeechApiManager(
        this.config.language,
        // onTranscriptUpdate
        (finalText: string, interimText: string) => {
          this.finalTranscript = finalText;
          this.interimTranscript = interimText;

          const combined = (finalText + interimText).trim();
          const isFinal = interimText === '';
          this.events.onTranscript?.(combined, isFinal);
        },
        // onSpeechError (non-fatal — MediaRecorder still captures audio)
        (error: string) => {
          console.warn('[VoiceCapture] Speech API:', error);
        },
      );

      this.speechManager.start();
    } catch (error) {
      // Non-critical — MediaRecorder still captures audio for server-side transcription
      console.warn('[VoiceCapture] Speech recognition not available:', error);
    }
  }

  private stopSpeechRecognition(): void {
    if (this.speechManager) {
      this.speechManager.destroy();
      this.speechManager = null;
    }
  }

  // =============================================
  // AUDIO ANALYSIS (VU Meter)
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
      // Non-critical — recording works without VU meter
      console.warn('[VoiceCapture] Audio analysis setup failed:', error);
    }
  }

  private startAmplitudeMonitor(): void {
    if (!this.analyserNode || !this.amplitudeData) return;

    const monitor = (): void => {
      // Stop monitoring if not recording
      if (this.state !== VoiceCaptureState.RECORDING) return;

      this.analyserNode!.getByteTimeDomainData(this.amplitudeData!);

      // Calculate RMS amplitude (0-1)
      let sum = 0;
      for (let i = 0; i < this.amplitudeData!.length; i++) {
        const val = (this.amplitudeData![i]! - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / this.amplitudeData!.length);

      // Scale up for visual feedback (raw RMS is typically 0-0.3)
      this.events.onAmplitude?.(Math.min(rms * 3, 1));

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
  // SILENCE DETECTION (AUTO mode only)
  // =============================================

  private startSilenceDetection(): void {
    // Safety: only in AUTO mode
    if (this.config.mode !== CaptureMode.AUTO) return;

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
        if (this.silenceStartTime === null) {
          this.silenceStartTime = Date.now();
        } else {
          const silenceDuration = Date.now() - this.silenceStartTime;
          if (silenceDuration >= this.config.silenceTimeoutMs) {
            void this.stop(StopReason.SILENCE);
          }
        }
      } else {
        this.silenceStartTime = null;
      }
    }, 200);
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
      void this.audioContext.close().catch(() => {});
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
    this.isStopping = false;
  }
}

// =============================================
// FACTORY FUNCTION
// =============================================

/**
 * Create a new VoiceCapture instance.
 *
 * Usage (inspection capture — manual mode):
 *   const capture = createVoiceCapture(
 *     { mode: CaptureMode.MANUAL },
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
 *   // ... inspector speaks, pauses, moves, thinks ...
 *   const result = await capture.stop();
 *   // result.audioBlob → IndexedDB → R2 → Whisper/Speechmatics
 *   // result.liveTranscript → instant on-screen feedback
 */
export function createVoiceCapture(
  config: Partial<VoiceCaptureConfig> = {},
  events: Partial<VoiceCaptureEvents> = {},
): VoiceCapture {
  return new VoiceCapture(config, events);
}

// =============================================
// UTILITIES
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
