// =============================================
// FEATURE 10: TAMPER-EVIDENT EXPORTS — TYPE ADDITIONS
// Merge into workers/src/types.ts
// =============================================

// ── Add these 3 lines inside the Env interface ──
//   readonly MANIFEST_SIGNING_KEY: string;
//   readonly MANIFEST_SIGNING_KEY_ID: string;
//   readonly MANIFEST_SIGNING_KEYS_LEGACY: string;  // JSON: '{"k1":"hex_key"}'

// ── Add 'userName' to RequestContext interface ──
// (Already used by claimsPack.ts as ctx.userName — confirm it's present)

// ── Add these types at the bottom of types.ts ──

export type SealedExportType = 'pdf_report' | 'defect_export' | 'claims_pack';

export interface ManifestFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly content_type: string;
}

export interface ExportManifest {
  readonly version: 1;
  readonly bundle_id: string;
  readonly generated_at: string;
  readonly generated_by: {
    readonly user_id: string;
    readonly display_name: string;
  };
  readonly org_id: string;
  readonly export_type: SealedExportType;
  readonly source_id: string | null;
  readonly signature_algorithm: 'HMAC-SHA256';
  readonly signing_key_id: string;
  readonly verify_url: string;
  readonly prev_bundle_hash: string | null;
  readonly files: readonly ManifestFileEntry[];
}

export interface BundleFile {
  readonly path: string;
  readonly data: Uint8Array;
  readonly contentType: string;
}

export interface SealedBundle {
  readonly bundleId: string;
  readonly zipBytes: Uint8Array;
  readonly manifest: ExportManifest;
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly manifestSig: string;
  readonly totalBytes: number;
}

export interface SealedExportRow {
  readonly id: string;
  readonly bundle_id: string;
  readonly org_id: string;
  readonly export_type: SealedExportType;
  readonly source_id: string | null;
  readonly file_count: number;
  readonly total_bytes: number;
  readonly r2_key: string;
  readonly manifest_sha256: string;
  readonly manifest_sig: string;
  readonly signing_key_id: string;
  readonly prev_bundle_hash: string | null;
  readonly generated_by: string;
  readonly generated_at: string;
  readonly created_at: string;
}
