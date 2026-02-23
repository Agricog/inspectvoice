/**
 * InspectVoice — Photo Capture Service
 * Batch 13
 *
 * File: src/services/photoCapture.ts
 *
 * Camera access, image compression, thumbnail generation, and GPS extraction
 * for defect/reference photos captured during inspections.
 *
 * Features:
 *   - Camera access via getUserMedia (rear camera preferred for mobile)
 *   - File input fallback for devices without camera API
 *   - JPEG compression with configurable quality (default 0.8)
 *   - Thumbnail generation (200px max dimension)
 *   - EXIF GPS extraction from uploaded photos
 *   - Canvas-based resizing (max 2048px longest edge)
 *   - Base64 output for IndexedDB storage
 *   - Dimension and file size reporting
 *   - TypeScript strict, zero any, pure service — no React dependency
 *
 * Build Standard: Autaimate v3 — production-ready first time
 */

import { captureError } from '@utils/errorTracking';

// =============================================
// TYPES
// =============================================

/** Photo capture configuration */
export interface PhotoCaptureConfig {
  /** Max dimension (longest edge) in pixels (default: 2048) */
  maxDimension: number;
  /** JPEG quality 0-1 (default: 0.8) */
  quality: number;
  /** Thumbnail max dimension in pixels (default: 200) */
  thumbnailMaxDimension: number;
  /** Thumbnail JPEG quality 0-1 (default: 0.6) */
  thumbnailQuality: number;
  /** Preferred camera facing mode (default: 'environment' for rear) */
  facingMode: 'environment' | 'user';
}

/** Default configuration */
export const DEFAULT_PHOTO_CONFIG: PhotoCaptureConfig = {
  maxDimension: 2048,
  quality: 0.8,
  thumbnailMaxDimension: 200,
  thumbnailQuality: 0.6,
  facingMode: 'environment',
};

/** Result from photo capture/processing */
export interface PhotoCaptureResult {
  /** Compressed photo as base64 JPEG (no data URI prefix) */
  base64Data: string;
  /** Thumbnail as base64 JPEG (no data URI prefix) */
  thumbnailBase64: string;
  /** MIME type (always image/jpeg after processing) */
  mimeType: string;
  /** File size of compressed image in bytes */
  fileSizeBytes: number;
  /** Image dimensions after resize */
  width: number;
  height: number;
  /** GPS coordinates extracted from EXIF (null if unavailable) */
  latitude: number | null;
  longitude: number | null;
  /** Capture timestamp */
  capturedAt: string;
}

/** Camera capabilities */
export interface CameraCapabilities {
  hasCamera: boolean;
  hasRearCamera: boolean;
  hasFrontCamera: boolean;
  supportsGetUserMedia: boolean;
}

/** Structured error */
export class PhotoCaptureError extends Error {
  constructor(
    message: string,
    public readonly code: PhotoCaptureErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'PhotoCaptureError';
  }
}

export enum PhotoCaptureErrorCode {
  PERMISSION_DENIED = 'permission_denied',
  NO_CAMERA = 'no_camera',
  CAMERA_IN_USE = 'camera_in_use',
  CAPTURE_FAILED = 'capture_failed',
  COMPRESSION_FAILED = 'compression_failed',
  INVALID_IMAGE = 'invalid_image',
  FILE_TOO_LARGE = 'file_too_large',
  BROWSER_UNSUPPORTED = 'browser_unsupported',
}

// =============================================
// CAPABILITY DETECTION
// =============================================

/** Check camera capabilities */
export async function checkCameraCapabilities(): Promise<CameraCapabilities> {
  const supportsGetUserMedia = !!(
    navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
  );

  if (!supportsGetUserMedia) {
    return {
      hasCamera: false,
      hasRearCamera: false,
      hasFrontCamera: false,
      supportsGetUserMedia: false,
    };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');

    const hasRear = videoDevices.some(
      (d) => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear'),
    );
    const hasFront = videoDevices.some(
      (d) => d.label.toLowerCase().includes('front') || d.label.toLowerCase().includes('face'),
    );

    return {
      hasCamera: videoDevices.length > 0,
      hasRearCamera: hasRear || videoDevices.length > 1,
      hasFrontCamera: hasFront || videoDevices.length > 0,
      supportsGetUserMedia: true,
    };
  } catch {
    return {
      hasCamera: false,
      hasRearCamera: false,
      hasFrontCamera: false,
      supportsGetUserMedia,
    };
  }
}

// =============================================
// IMAGE PROCESSING
// =============================================

/**
 * Load an image from a File or Blob into an HTMLImageElement.
 * Revokes the object URL after loading to prevent memory leaks.
 */
function loadImage(source: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(source);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoCaptureError('Failed to load image', PhotoCaptureErrorCode.INVALID_IMAGE));
    };

    img.src = url;
  });
}

/**
 * Calculate new dimensions maintaining aspect ratio.
 * Returns original dimensions if already within maxDimension.
 */
function calculateResizedDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Resize and compress an image to JPEG using Canvas.
 * Returns base64 string without data URI prefix.
 */
function compressToBase64(
  img: HTMLImageElement,
  maxDimension: number,
  quality: number,
): { base64: string; width: number; height: number; sizeBytes: number } {
  const { width, height } = calculateResizedDimensions(
    img.naturalWidth,
    img.naturalHeight,
    maxDimension,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new PhotoCaptureError(
      'Canvas 2D context not available',
      PhotoCaptureErrorCode.COMPRESSION_FAILED,
    );
  }

  // White background (in case of transparent PNGs)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Draw image
  ctx.drawImage(img, 0, 0, width, height);

  // Export as JPEG base64
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.split(',')[1];

  if (!base64) {
    throw new PhotoCaptureError(
      'Failed to encode image as JPEG',
      PhotoCaptureErrorCode.COMPRESSION_FAILED,
    );
  }

  // Estimate byte size from base64 length
  const sizeBytes = Math.ceil(base64.length * 0.75);

  return { base64, width, height, sizeBytes };
}

// =============================================
// EXIF GPS EXTRACTION
// =============================================

/**
 * Extract GPS coordinates from EXIF data in a JPEG file.
 * Lightweight implementation — reads only the GPS IFD.
 * Returns null if no GPS data found or file is not JPEG with EXIF.
 */
export async function extractGPSFromExif(
  file: File | Blob,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // Check JPEG SOI marker
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) {
      return null;
    }

    // Find APP1 (EXIF) marker
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);

      if (marker === 0xFFE1) {
        const exifOffset = offset + 4;
        return parseExifGPS(view, exifOffset);
      }

      if ((marker & 0xFF00) !== 0xFF00) {
        break;
      }

      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }

    return null;
  } catch {
    return null;
  }
}

/** Parse EXIF GPS data from a DataView starting at the EXIF header */
function parseExifGPS(
  view: DataView,
  exifStart: number,
): { latitude: number; longitude: number } | null {
  try {
    // Check "Exif\0\0" header
    if (
      view.byteLength < exifStart + 6 ||
      view.getUint32(exifStart) !== 0x45786966 ||
      view.getUint16(exifStart + 4) !== 0x0000
    ) {
      return null;
    }

    const tiffStart = exifStart + 6;

    // Determine byte order
    const byteOrder = view.getUint16(tiffStart);
    const littleEndian = byteOrder === 0x4949;

    // Verify TIFF magic number
    if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002A) {
      return null;
    }

    // Get offset to first IFD
    const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
    const ifd0Start = tiffStart + ifd0Offset;

    // Search IFD0 for GPS IFD pointer (tag 0x8825)
    const ifd0Count = view.getUint16(ifd0Start, littleEndian);
    let gpsIfdOffset: number | null = null;

    for (let i = 0; i < ifd0Count; i++) {
      const entryOffset = ifd0Start + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;

      const tag = view.getUint16(entryOffset, littleEndian);
      if (tag === 0x8825) {
        gpsIfdOffset = view.getUint32(entryOffset + 8, littleEndian);
        break;
      }
    }

    if (gpsIfdOffset === null) return null;

    // Parse GPS IFD
    const gpsStart = tiffStart + gpsIfdOffset;
    if (gpsStart + 2 > view.byteLength) return null;

    const gpsCount = view.getUint16(gpsStart, littleEndian);

    let latRef: string | null = null;
    let lonRef: string | null = null;
    let latValues: number[] | null = null;
    let lonValues: number[] | null = null;

    for (let i = 0; i < gpsCount; i++) {
      const entryOffset = gpsStart + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;

      const tag = view.getUint16(entryOffset, littleEndian);
      const valueOffset = view.getUint32(entryOffset + 8, littleEndian);

      switch (tag) {
        case 0x0001:
          latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
          break;
        case 0x0002:
          latValues = readRationals(view, tiffStart + valueOffset, 3, littleEndian);
          break;
        case 0x0003:
          lonRef = String.fromCharCode(view.getUint8(entryOffset + 8));
          break;
        case 0x0004:
          lonValues = readRationals(view, tiffStart + valueOffset, 3, littleEndian);
          break;
      }
    }

    if (!latValues || !lonValues || !latRef || !lonRef) return null;
    if (latValues.length < 3 || lonValues.length < 3) return null;

    const lat = dmsToDecimal(latValues[0]!, latValues[1]!, latValues[2]!, latRef);
    const lon = dmsToDecimal(lonValues[0]!, lonValues[1]!, lonValues[2]!, lonRef);

    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}

/** Read N rational values (each is two uint32: numerator/denominator) */
function readRationals(
  view: DataView,
  offset: number,
  count: number,
  littleEndian: boolean,
): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const pos = offset + i * 8;
    if (pos + 8 > view.byteLength) break;
    const num = view.getUint32(pos, littleEndian);
    const den = view.getUint32(pos + 4, littleEndian);
    values.push(den === 0 ? 0 : num / den);
  }
  return values;
}

/** Convert degrees/minutes/seconds to decimal */
function dmsToDecimal(degrees: number, minutes: number, seconds: number, ref: string): number {
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return Math.round(decimal * 1_000_000) / 1_000_000;
}

// =============================================
// PHOTO CAPTURE FROM CAMERA STREAM
// =============================================

/**
 * Capture a single photo frame from a video stream.
 * Used when the component manages its own <video> element for live preview.
 *
 * Usage:
 *   const stream = await getCameraStream();
 *   // ... display stream in <video> element ...
 *   const result = await captureFrameFromStream(stream, videoElement);
 */
export async function captureFrameFromStream(
  _stream: MediaStream,
  videoElement: HTMLVideoElement,
  config: Partial<PhotoCaptureConfig> = {},
): Promise<PhotoCaptureResult> {
  const cfg = { ...DEFAULT_PHOTO_CONFIG, ...config };

  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new PhotoCaptureError(
      'Canvas 2D context not available',
      PhotoCaptureErrorCode.CAPTURE_FAILED,
    );
  }

  ctx.drawImage(videoElement, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new PhotoCaptureError('Failed to capture frame', PhotoCaptureErrorCode.CAPTURE_FAILED));
      },
      'image/jpeg',
      cfg.quality,
    );
  });

  return processImageBlob(blob, cfg);
}

// =============================================
// PHOTO CAPTURE FROM FILE INPUT
// =============================================

/**
 * Process a photo selected via file input or drag-and-drop.
 *
 * Usage:
 *   <input type="file" accept="image/*" capture="environment"
 *     onChange={(e) => {
 *       const file = e.target.files?.[0];
 *       if (file) {
 *         const result = await processPhotoFile(file);
 *       }
 *     }}
 *   />
 */
export async function processPhotoFile(
  file: File,
  config: Partial<PhotoCaptureConfig> = {},
): Promise<PhotoCaptureResult> {
  const cfg = { ...DEFAULT_PHOTO_CONFIG, ...config };

  if (!file.type.startsWith('image/')) {
    throw new PhotoCaptureError(
      'Selected file is not an image',
      PhotoCaptureErrorCode.INVALID_IMAGE,
    );
  }

  if (file.size > 50 * 1024 * 1024) {
    throw new PhotoCaptureError(
      'Image file exceeds 50MB maximum',
      PhotoCaptureErrorCode.FILE_TOO_LARGE,
    );
  }

  return processImageBlob(file, cfg);
}

// =============================================
// CORE IMAGE PROCESSING PIPELINE
// =============================================

/**
 * Process any image blob: load → extract GPS → resize → compress → thumbnail.
 */
async function processImageBlob(
  source: File | Blob,
  config: PhotoCaptureConfig,
): Promise<PhotoCaptureResult> {
  const capturedAt = new Date().toISOString();

  // Extract GPS from EXIF before processing (processing strips EXIF)
  let latitude: number | null = null;
  let longitude: number | null = null;

  try {
    const gps = await extractGPSFromExif(source);
    if (gps) {
      latitude = gps.latitude;
      longitude = gps.longitude;
    }
  } catch (error) {
    captureError(error, { module: 'photoCapture', operation: 'extractGPS' });
  }

  // If no EXIF GPS, try browser Geolocation API
  if (latitude === null && longitude === null) {
    try {
      const position = await getCurrentPosition();
      if (position) {
        latitude = Math.round(position.coords.latitude * 1_000_000) / 1_000_000;
        longitude = Math.round(position.coords.longitude * 1_000_000) / 1_000_000;
      }
    } catch {
      // Non-critical
    }
  }

  // Load image
  let img: HTMLImageElement;
  try {
    img = await loadImage(source);
  } catch (error) {
    throw new PhotoCaptureError(
      'Failed to load image for processing',
      PhotoCaptureErrorCode.INVALID_IMAGE,
      error,
    );
  }

  // Compress main image
  let mainResult: { base64: string; width: number; height: number; sizeBytes: number };
  try {
    mainResult = compressToBase64(img, config.maxDimension, config.quality);
  } catch (error) {
    throw new PhotoCaptureError(
      'Failed to compress image',
      PhotoCaptureErrorCode.COMPRESSION_FAILED,
      error,
    );
  }

  // Generate thumbnail
  let thumbnailBase64: string;
  try {
    const thumbResult = compressToBase64(
      img,
      config.thumbnailMaxDimension,
      config.thumbnailQuality,
    );
    thumbnailBase64 = thumbResult.base64;
  } catch {
    thumbnailBase64 = '';
  }

  return {
    base64Data: mainResult.base64,
    thumbnailBase64,
    mimeType: 'image/jpeg',
    fileSizeBytes: mainResult.sizeBytes,
    width: mainResult.width,
    height: mainResult.height,
    latitude,
    longitude,
    capturedAt,
  };
}

// =============================================
// CAMERA STREAM MANAGEMENT
// =============================================

/**
 * Get a camera MediaStream for live preview.
 * Prefers rear camera on mobile devices.
 * Caller is responsible for stopping the stream when done.
 */
export async function getCameraStream(
  config: Partial<PhotoCaptureConfig> = {},
): Promise<MediaStream> {
  const cfg = { ...DEFAULT_PHOTO_CONFIG, ...config };

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new PhotoCaptureError(
      'Camera access not supported in this browser',
      PhotoCaptureErrorCode.BROWSER_UNSUPPORTED,
    );
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cfg.facingMode },
        width: { ideal: cfg.maxDimension },
        height: { ideal: cfg.maxDimension },
      },
      audio: false,
    });

    return stream;
  } catch (error) {
    const err = error instanceof DOMException ? error : new Error(String(error));

    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new PhotoCaptureError(
        'Camera permission denied',
        PhotoCaptureErrorCode.PERMISSION_DENIED,
        error,
      );
    }

    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw new PhotoCaptureError(
        'No camera found on this device',
        PhotoCaptureErrorCode.NO_CAMERA,
        error,
      );
    }

    if (err instanceof DOMException && err.name === 'NotReadableError') {
      throw new PhotoCaptureError(
        'Camera is already in use by another app',
        PhotoCaptureErrorCode.CAMERA_IN_USE,
        error,
      );
    }

    throw new PhotoCaptureError(
      'Failed to access camera',
      PhotoCaptureErrorCode.CAPTURE_FAILED,
      error,
    );
  }
}

/** Release all tracks on a camera stream */
export function releaseCameraStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

// =============================================
// GEOLOCATION HELPER
// =============================================

/** Get current position with a 5-second timeout. Returns null on failure. */
function getCurrentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 30000,
      },
    );
  });
}

// =============================================
// UTILITY
// =============================================

/** Format byte count for display */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

/** Estimate base64 byte size */
export function estimateBase64Size(base64: string): number {
  return Math.ceil(base64.length * 0.75);
}
