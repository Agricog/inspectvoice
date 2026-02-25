/**
 * Feature 10: Sealed Export Client Service
 * src/services/sealedExport.ts
 *
 * API calls to sealed export endpoints + browser download handling.
 * Uses secureFetch (same auth pattern as DefectExportButton).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { secureFetch } from '@hooks/useFetch';

// =============================================
// TYPES
// =============================================

export interface SealedExportListItem {
  readonly bundle_id: string;
  readonly export_type: 'pdf_report' | 'defect_export' | 'claims_pack';
  readonly source_id: string | null;
  readonly file_count: number;
  readonly total_bytes: number;
  readonly generated_at: string;
  readonly generated_by: string;
  readonly manifest_sha256: string;
  readonly signing_key_id: string;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly bundle_id?: string;
  readonly export_type?: string;
  readonly generated_at?: string;
  readonly file_count?: number;
  readonly signature_algorithm?: string;
  readonly signing_key_id?: string;
  readonly manifest_sha256?: string;
  readonly reason?: string;
}

// =============================================
// CREATE SEALED EXPORTS
// =============================================

export interface SealedExportFilters {
  status?: string;
  severity?: string;
  siteId?: string;
}

/** Create sealed defect Excel bundle → triggers browser download */
export async function createSealedDefectExport(filters?: SealedExportFilters): Promise<string> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.severity) params.set('severity', filters.severity);
  if (filters?.siteId) params.set('site_id', filters.siteId);

  const queryStr = params.toString();
  const url = `/api/v1/sealed-exports/defects${queryStr ? `?${queryStr}` : ''}`;

  const raw = await secureFetch(url, { method: 'POST' });
  const response = raw as Response;

  if (!response.ok) {
    const body = await response.json().catch(() => null) as Record<string, string> | null;
    throw new Error(body?.error ?? `Sealed export failed (${response.status})`);
  }

  const bundleId = response.headers.get('X-Bundle-Id') ?? '';
  await downloadResponseAsZip(response);
  return bundleId;
}

/** Create sealed PDF inspection report → triggers browser download */
export async function createSealedPdfExport(inspectionId: string): Promise<string> {
  const raw = await secureFetch(`/api/v1/sealed-exports/inspections/${inspectionId}/pdf`, { method: 'POST' });
  const response = raw as Response;

  if (!response.ok) {
    const body = await response.json().catch(() => null) as Record<string, string> | null;
    throw new Error(body?.error ?? `Sealed PDF export failed (${response.status})`);
  }

  const bundleId = response.headers.get('X-Bundle-Id') ?? '';
  await downloadResponseAsZip(response);
  return bundleId;
}

/** Create sealed claims pack → triggers browser download */
export async function createSealedClaimsPack(incidentId: string): Promise<string> {
  const raw = await secureFetch(`/api/v1/sealed-exports/incidents/${incidentId}/claims-pack`, { method: 'POST' });
  const response = raw as Response;

  if (!response.ok) {
    const body = await response.json().catch(() => null) as Record<string, string> | null;
    throw new Error(body?.error ?? `Sealed claims pack failed (${response.status})`);
  }

  const bundleId = response.headers.get('X-Bundle-Id') ?? '';
  await downloadResponseAsZip(response);
  return bundleId;
}

// =============================================
// DOWNLOAD + LIST
// =============================================

export async function downloadSealedExport(bundleId: string): Promise<void> {
  const raw = await secureFetch(`/api/v1/sealed-exports/${bundleId}/download`);
  const response = raw as Response;
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  await downloadResponseAsZip(response);
}

export async function listSealedExports(params?: {
  exportType?: string;
  limit?: number;
  offset?: number;
}): Promise<SealedExportListItem[]> {
  const searchParams = new URLSearchParams();
  if (params?.exportType) searchParams.set('export_type', params.exportType);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const raw = await secureFetch(`/api/v1/sealed-exports?${searchParams.toString()}`);
  const response = raw as Response;
  if (!response.ok) throw new Error(`List failed (${response.status})`);

  const result = await response.json() as { success: boolean; data: SealedExportListItem[] };
  return result.data;
}

// =============================================
// PUBLIC VERIFICATION (no auth)
// =============================================

export async function verifyBundle(bundleId: string): Promise<VerifyResult> {
  const response = await fetch(`/api/v1/verify/${bundleId}`);
  return response.json() as Promise<VerifyResult>;
}

export function getVerifyUrl(bundleId: string): string {
  return `${window.location.origin}/api/v1/verify/${bundleId}`;
}

// =============================================
// HELPERS
// =============================================

async function downloadResponseAsZip(response: Response): Promise<void> {
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? 'InspectVoice_Bundle.zip';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatExportType(type: string): string {
  const map: Record<string, string> = {
    pdf_report: 'PDF Report',
    defect_export: 'Defect Export',
    claims_pack: 'Claims Pack',
  };
  return map[type] ?? type;
}
