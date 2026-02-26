/**
 * InspectVoice — Portal API Client
 * src/portal/api/portalApi.ts
 *
 * Typed fetch wrapper for client portal endpoints.
 * Uses the portal Clerk session token (different Clerk instance).
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

// =============================================
// TYPES
// =============================================

export interface PortalDashboard {
  workspace: { id: string; name: string; branding: Record<string, unknown> | null } | null;
  site_count: number;
  total_defects_open: number;
  critical_defects_open: number;
  recent_reports: PortalReportSummary[];
  pending_actions: number;
}

export interface PortalReportSummary {
  inspection_id: string;
  site_name: string;
  inspection_type: string;
  signed_at: string;
  overall_risk_rating: string | null;
  total_defects: number;
  pdf_url: string | null;
}

export interface PortalSite {
  id: string;
  name: string;
  site_code: string;
  address: string;
  postcode: string;
  site_type: string;
  status: string;
  access_level: string;
  asset_count: number;
  open_defects: number;
  last_inspection_date: string | null;
}

export interface PortalSiteDetail extends PortalSite {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours: string | null;
  access_notes: string | null;
  assets: PortalAsset[];
  recent_inspections: PortalInspectionSummary[];
}

export interface PortalAsset {
  id: string;
  asset_code: string;
  asset_type: string;
  asset_category: string;
  manufacturer_name: string | null;
  model: string | null;
  install_date: string | null;
  last_inspection_date: string | null;
  last_inspection_condition: string | null;
  condition_trend: string | null;
}

export interface PortalInspectionSummary {
  id: string;
  inspection_type: string;
  status: string;
  signed_at: string;
  overall_risk_rating: string | null;
  total_defects: number;
  pdf_url: string | null;
}

export interface PortalInspection {
  id: string;
  inspection_type: string;
  status: string;
  signed_at: string;
  signed_by: string;
  overall_risk_rating: string | null;
  total_defects: number;
  very_high_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  closure_recommended: boolean;
  closure_reason: string | null;
  immediate_action_required: boolean;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  site_name: string;
  site_id: string;
  items: PortalInspectionItem[];
  defects: PortalDefectSummary[];
}

export interface PortalInspectionItem {
  id: string;
  overall_condition: string;
  risk_rating: string;
  requires_action: boolean;
  action_timeframe: string | null;
  voice_transcript: string | null;
  inspector_notes: string | null;
  asset_code: string;
  asset_type: string;
}

export interface PortalDefectSummary {
  id: string;
  description: string;
  severity: string;
  status: string;
  bs_en_reference: string | null;
  defect_category: string | null;
  estimated_cost_gbp: number | null;
  due_date: string | null;
  asset_code: string | null;
}

export interface PortalDefect {
  id: string;
  description: string;
  severity: string;
  status: string;
  bs_en_reference: string | null;
  defect_category: string | null;
  source: string | null;
  estimated_cost_gbp: number | null;
  actual_cost_gbp: number | null;
  due_date: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  verified_at: string | null;
  created_at: string;
  site_name: string;
  asset_code: string | null;
  asset_type: string | null;
  client_updates: PortalDefectUpdate[];
  // List view extras
  site_id?: string;
  client_latest_status?: string | null;
  client_latest_verified?: boolean | null;
}

export interface PortalDefectUpdate {
  id: string;
  update_type: string;
  comment: string | null;
  attachments: unknown[];
  proposed_status: string | null;
  inspector_verified: boolean;
  inspector_verified_at: string | null;
  inspector_notes: string | null;
  created_at: string;
  client_user_name: string;
}

export interface PortalNotification {
  id: string;
  notification_type: string;
  site_id: string | null;
  title: string;
  body: string;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
}

export interface Paginated<T> {
  success: true;
  data: T[];
  pagination: { total: number; limit: number; offset: number };
  requestId: string;
}

// =============================================
// API CLIENT
// =============================================

type GetTokenFn = () => Promise<string | null>;

let _getToken: GetTokenFn | null = null;

/** Call once at app init to provide the Clerk getToken function */
export function setPortalAuth(getToken: GetTokenFn): void {
  _getToken = getToken;
}

async function portalFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!_getToken) throw new Error('Portal auth not initialised');

  const token = await _getToken();
  if (!token) throw new Error('No portal session token');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const msg = (body['error'] as Record<string, unknown>)?.['message'] ?? res.statusText;
    throw new Error(String(msg));
  }

  return res.json() as Promise<T>;
}

// =============================================
// DASHBOARD
// =============================================

export async function fetchDashboard(): Promise<PortalDashboard> {
  const res = await portalFetch<{ success: true; data: PortalDashboard }>('/api/v1/portal/dashboard');
  return res.data;
}

// =============================================
// SITES
// =============================================

export async function fetchSites(): Promise<PortalSite[]> {
  const res = await portalFetch<{ success: true; data: PortalSite[] }>('/api/v1/portal/sites');
  return res.data;
}

export async function fetchSite(id: string): Promise<PortalSiteDetail> {
  const res = await portalFetch<{ success: true; data: PortalSiteDetail }>(`/api/v1/portal/sites/${id}`);
  return res.data;
}

// =============================================
// INSPECTIONS
// =============================================

export async function fetchInspections(params?: {
  limit?: number;
  offset?: number;
  site_id?: string;
}): Promise<Paginated<PortalInspectionSummary & { site_name: string; signed_by: string }>> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.site_id) qs.set('site_id', params.site_id);
  const query = qs.toString();
  return portalFetch(`/api/v1/portal/inspections${query ? `?${query}` : ''}`);
}

export async function fetchInspection(id: string): Promise<PortalInspection> {
  const res = await portalFetch<{ success: true; data: PortalInspection }>(`/api/v1/portal/inspections/${id}`);
  return res.data;
}

// =============================================
// DEFECTS
// =============================================

export async function fetchDefects(params?: {
  limit?: number;
  offset?: number;
  severity?: string;
  status?: string;
  site_id?: string;
}): Promise<Paginated<PortalDefect>> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.severity) qs.set('severity', params.severity);
  if (params?.status) qs.set('status', params.status);
  if (params?.site_id) qs.set('site_id', params.site_id);
  const query = qs.toString();
  return portalFetch(`/api/v1/portal/defects${query ? `?${query}` : ''}`);
}

export async function fetchDefect(id: string): Promise<PortalDefect> {
  const res = await portalFetch<{ success: true; data: PortalDefect }>(`/api/v1/portal/defects/${id}`);
  return res.data;
}

export async function submitDefectUpdate(defectId: string, body: {
  update_type: 'acknowledged' | 'comment' | 'work_complete' | 'contractor_booked' | 'unable_to_action';
  comment?: string;
  attachments?: unknown[];
}): Promise<PortalDefectUpdate> {
  const res = await portalFetch<{ success: true; data: PortalDefectUpdate }>(
    `/api/v1/portal/defects/${defectId}/update`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return res.data;
}

// =============================================
// NOTIFICATIONS
// =============================================

export async function fetchNotifications(params?: {
  limit?: number;
  offset?: number;
  unread?: boolean;
}): Promise<Paginated<PortalNotification> & { unread_count: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.unread) qs.set('unread', 'true');
  const query = qs.toString();
  return portalFetch(`/api/v1/portal/notifications${query ? `?${query}` : ''}`);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  await portalFetch('/api/v1/portal/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await portalFetch('/api/v1/portal/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  });
}
