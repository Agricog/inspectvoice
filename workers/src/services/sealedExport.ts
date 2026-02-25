/**
 * Feature 10: Tamper-Evident Export Bundles — Core Sealing Service
 * workers/src/services/sealedExport.ts
 *
 * Pipeline: hash files → build manifest → canonical JSON → HMAC sign → zip → R2 → DB
 * All crypto via Web Crypto API (crypto.subtle), zip via fflate.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { zipSync } from 'fflate';
import type {
  Env,
  RequestContext,
  ExportManifest,
  ManifestFileEntry,
  BundleFile,
  SealedBundle,
  SealedExportRow,
  SealedExportType,
} from '../types';
import { createDb } from './db';

// =============================================
// CONFIGURATION
// =============================================

const VERIFY_BASE_URL = 'https://app.inspectvoice.co.uk';

// =============================================
// CRYPTO PRIMITIVES
// =============================================

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(new Uint8Array(hash));
}

export async function hmacSign(data: Uint8Array, keyHex: string): Promise<string> {
  const key = await importHmacKey(keyHex);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return bufferToBase64(new Uint8Array(sig));
}

export async function hmacVerify(data: Uint8Array, signatureBase64: string, keyHex: string): Promise<boolean> {
  const key = await importHmacKey(keyHex);
  const sigBytes = base64ToBuffer(signatureBase64);
  return crypto.subtle.verify('HMAC', key, sigBytes, data);
}

async function importHmacKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    hexToBuffer(keyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// =============================================
// CANONICAL JSON
// =============================================

/**
 * Deterministic JSON serialisation (spec §5.1a):
 *  1. UTF-8, no BOM
 *  2. No whitespace (default JSON.stringify)
 *  3. Keys sorted lexicographically (recursive)
 *  4. Arrays preserved as-is
 *  5. Default number formatting
 *  6. Optional fields explicitly null
 *  7. Single implementation — never stringify manifests directly
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

// =============================================
// MANIFEST BUILDER
// =============================================

interface BuildManifestParams {
  readonly bundleId: string;
  readonly orgId: string;
  readonly exportType: SealedExportType;
  readonly sourceId: string | null;
  readonly generatedBy: { readonly userId: string; readonly displayName: string };
  readonly signingKeyId: string;
  readonly prevBundleHash: string | null;
  readonly files: readonly ManifestFileEntry[];
}

function buildManifest(params: BuildManifestParams): ExportManifest {
  return {
    version: 1,
    bundle_id: params.bundleId,
    generated_at: new Date().toISOString(),
    generated_by: {
      user_id: params.generatedBy.userId,
      display_name: params.generatedBy.displayName,
    },
    org_id: params.orgId,
    export_type: params.exportType,
    source_id: params.sourceId,
    signature_algorithm: 'HMAC-SHA256',
    signing_key_id: params.signingKeyId,
    verify_url: `${VERIFY_BASE_URL}/api/v1/verify/${params.bundleId}`,
    prev_bundle_hash: params.prevBundleHash,
    files: params.files,
  };
}

// =============================================
// BUNDLE CREATION
// =============================================

interface CreateBundleParams {
  readonly bundleId: string;
  readonly orgId: string;
  readonly exportType: SealedExportType;
  readonly sourceId: string | null;
  readonly generatedBy: { readonly userId: string; readonly displayName: string };
  readonly signingKeyId: string;
  readonly signingKey: string;
  readonly prevBundleHash: string | null;
  readonly files: readonly BundleFile[];
}

export async function createSealedBundle(params: CreateBundleParams): Promise<SealedBundle> {
  // 1. Hash each file
  const manifestFiles: ManifestFileEntry[] = await Promise.all(
    params.files.map(async (file) => ({
      path: file.path,
      sha256: await sha256Hex(file.data),
      bytes: file.data.byteLength,
      content_type: file.contentType,
    })),
  );

  // 2. Build manifest
  const manifest = buildManifest({
    bundleId: params.bundleId,
    orgId: params.orgId,
    exportType: params.exportType,
    sourceId: params.sourceId,
    generatedBy: params.generatedBy,
    signingKeyId: params.signingKeyId,
    prevBundleHash: params.prevBundleHash,
    files: manifestFiles,
  });

  // 3. Canonical JSON
  const manifestJson = canonicalJson(manifest);
  const manifestBytes = new TextEncoder().encode(manifestJson);

  // 4. Sign
  const manifestSig = await hmacSign(manifestBytes, params.signingKey);

  // 5. Hash manifest for DB
  const manifestSha256 = await sha256Hex(manifestBytes);

  // 6. Build zip
  const zipFiles: Record<string, Uint8Array> = {};
  for (const file of params.files) {
    zipFiles[file.path] = file.data;
  }
  zipFiles['manifest.json'] = manifestBytes;
  zipFiles['manifest.sig'] = new TextEncoder().encode(manifestSig);

  const zipBytes = zipSync(zipFiles, { level: 6 });
  const zipArray = new Uint8Array(zipBytes);

  return {
    bundleId: params.bundleId,
    zipBytes: zipArray,
    manifest,
    manifestJson,
    manifestSha256,
    manifestSig,
    totalBytes: zipArray.byteLength,
  };
}

// =============================================
// FULL PIPELINE: SEAL → R2 → DB
// =============================================

interface SealAndStoreParams {
  readonly ctx: RequestContext;
  readonly exportType: SealedExportType;
  readonly sourceId: string | null;
  readonly displayName: string;
  readonly files: readonly BundleFile[];
}

export async function sealAndStore(params: SealAndStoreParams): Promise<SealedExportRow> {
  const { ctx, exportType, sourceId, displayName, files } = params;
  const db = createDb(ctx);

  // 1. Hash chain — get previous bundle's manifest SHA-256
  const prevRows = await db.rawQuery<{ manifest_sha256: string }>(
    `SELECT manifest_sha256 FROM sealed_exports
     WHERE org_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [ctx.orgId],
  );
  const prevBundleHash = prevRows[0]?.manifest_sha256 ?? null;

  // 2. Generate bundle ID
  const bundleId = crypto.randomUUID();

  // 3. Create sealed bundle
  const bundle = await createSealedBundle({
    bundleId,
    orgId: ctx.orgId,
    exportType,
    sourceId,
    generatedBy: { userId: ctx.userId, displayName },
    signingKeyId: ctx.env.MANIFEST_SIGNING_KEY_ID,
    signingKey: ctx.env.MANIFEST_SIGNING_KEY,
    prevBundleHash,
    files,
  });

  // 4. Upload to R2 (same bucket, different prefix)
  const r2Key = `sealed-exports/${ctx.orgId}/${bundleId}.zip`;
  await ctx.env.INSPECTVOICE_BUCKET.put(r2Key, bundle.zipBytes, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: {
      bundle_id: bundleId,
      export_type: exportType,
      org_id: ctx.orgId,
    },
  });

  // 5. Insert DB record
  const rows = await db.rawQuery<SealedExportRow>(
    `INSERT INTO sealed_exports (
       bundle_id, org_id, export_type, source_id,
       file_count, total_bytes, r2_key,
       manifest_sha256, manifest_sig, signing_key_id,
       prev_bundle_hash, generated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      bundleId, ctx.orgId, exportType, sourceId,
      files.length, bundle.totalBytes, r2Key,
      bundle.manifestSha256, bundle.manifestSig, ctx.env.MANIFEST_SIGNING_KEY_ID,
      prevBundleHash, ctx.userId,
    ],
  );

  return rows[0]!;
}

// =============================================
// KEY ROTATION HELPER
// =============================================

export function getSigningKey(
  keyId: string,
  env: Env,
): string | null {
  if (keyId === env.MANIFEST_SIGNING_KEY_ID) return env.MANIFEST_SIGNING_KEY;
  try {
    const legacy = JSON.parse(env.MANIFEST_SIGNING_KEYS_LEGACY) as Record<string, string>;
    return legacy[keyId] ?? null;
  } catch {
    return null;
  }
}

// =============================================
// BUFFER UTILITIES
// =============================================

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
