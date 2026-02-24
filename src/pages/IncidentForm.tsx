/**
 * InspectVoice — Incident Form Page
 * Route: /incidents/new (create) or /incidents/:id (edit)
 *
 * Features:
 *   - Multi-section form: incident details, reporter, injury, response,
 *     witnesses, regulatory, claims, investigation
 *   - Site selector (fetched from API)
 *   - Optional asset + defect linking
 *   - Validation before submit
 *   - Loading / saving / error states
 *   - Dark theme (iv-* design tokens)
 *   - Mobile-first responsive
 *
 * API:
 *   POST /api/v1/incidents (create)
 *   PUT  /api/v1/incidents/:id (update)
 *   GET  /api/v1/incidents/:id (load for edit)
 *   GET  /api/v1/sites (site picker)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertTriangle,
  MapPin,
  Calendar,
  User,
  Shield,
  FileText,
  Stethoscope,
  Phone,
  Eye,
  Scale,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import { captureError } from '@utils/errorTracking';

// =============================================
// TYPES
// =============================================

interface SiteOption {
  id: string;
  name: string;
}

interface SitesResponse {
  success: boolean;
  data: SiteOption[];
}

interface IncidentResponse {
  success: boolean;
  data: Record<string, unknown>;
}

interface FormData {
  site_id: string;
  asset_id: string;
  defect_id: string;
  incident_date: string;
  incident_time: string;
  incident_type: string;
  severity: string;
  description: string;
  location_on_site: string;
  reported_by: string;
  reporter_contact: string;
  reporter_role: string;
  injured_party_name: string;
  injured_party_age: string;
  injured_party_contact: string;
  injury_description: string;
  body_part_affected: string;
  immediate_action: string;
  ambulance_called: boolean;
  first_aid_given: boolean;
  area_closed: boolean;
  equipment_isolated: boolean;
  witness_details: string;
  reported_to_riddor: boolean;
  riddor_reference: string;
  police_reference: string;
  hse_notified: boolean;
  status: string;
  claim_reference: string;
  claim_received_date: string;
  claimant_solicitor: string;
  insurer_notified: boolean;
  insurer_reference: string;
  internal_notes: string;
  investigation_findings: string;
  corrective_actions: string;
}

const INITIAL_FORM: FormData = {
  site_id: '',
  asset_id: '',
  defect_id: '',
  incident_date: new Date().toISOString().slice(0, 10),
  incident_time: '',
  incident_type: 'injury',
  severity: 'minor',
  description: '',
  location_on_site: '',
  reported_by: '',
  reporter_contact: '',
  reporter_role: '',
  injured_party_name: '',
  injured_party_age: '',
  injured_party_contact: '',
  injury_description: '',
  body_part_affected: '',
  immediate_action: '',
  ambulance_called: false,
  first_aid_given: false,
  area_closed: false,
  equipment_isolated: false,
  witness_details: '',
  reported_to_riddor: false,
  riddor_reference: '',
  police_reference: '',
  hse_notified: false,
  status: 'open',
  claim_reference: '',
  claim_received_date: '',
  claimant_solicitor: '',
  insurer_notified: false,
  insurer_reference: '',
  internal_notes: '',
  investigation_findings: '',
  corrective_actions: '',
};

// =============================================
// CONSTANTS
// =============================================

const INCIDENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'injury', label: 'Injury' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'near_miss', label: 'Near Miss' },
  { value: 'vandalism', label: 'Vandalism' },
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'other', label: 'Other' },
];

const SEVERITY_LEVELS: Array<{ value: string; label: string }> = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'serious', label: 'Serious' },
  { value: 'major', label: 'Major' },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'closed', label: 'Closed' },
  { value: 'claim_received', label: 'Claim Received' },
  { value: 'claim_settled', label: 'Claim Settled' },
];

// =============================================
// SUB-COMPONENTS
// =============================================

function FormSection({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-iv-surface-2/50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-iv-accent">{icon}</span>
          <h2 className="text-sm font-semibold text-iv-text">{title}</h2>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-iv-muted" /> : <ChevronRight className="w-4 h-4 text-iv-muted" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-iv-border pt-4">{children}</div>}
    </div>
  );
}

function FieldLabel({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="block text-xs text-iv-muted mb-1">
      {label}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer py-1">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-iv-border bg-iv-surface-2 text-iv-accent focus:ring-iv-accent"
      />
      <span className="text-sm text-iv-text">{label}</span>
    </label>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function IncidentForm(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Load sites for picker
  const { data: sitesData } = useFetch<SitesResponse>('/api/v1/sites?per_page=200');
  const sites = sitesData?.data ?? [];

  // Load existing incident for edit
  const { data: existingData, loading: editLoading } = useFetch<IncidentResponse>(
    isEdit ? `/api/v1/incidents/${id}` : '',
  );

  // Populate form when editing
  useEffect(() => {
    if (!isEdit || !existingData?.data) return;
    const d = existingData.data;

    setForm({
      site_id: (d['site_id'] as string) ?? '',
      asset_id: (d['asset_id'] as string) ?? '',
      defect_id: (d['defect_id'] as string) ?? '',
      incident_date: (d['incident_date'] as string)?.slice(0, 10) ?? '',
      incident_time: (d['incident_time'] as string) ?? '',
      incident_type: (d['incident_type'] as string) ?? 'injury',
      severity: (d['severity'] as string) ?? 'minor',
      description: (d['description'] as string) ?? '',
      location_on_site: (d['location_on_site'] as string) ?? '',
      reported_by: (d['reported_by'] as string) ?? '',
      reporter_contact: (d['reporter_contact'] as string) ?? '',
      reporter_role: (d['reporter_role'] as string) ?? '',
      injured_party_name: (d['injured_party_name'] as string) ?? '',
      injured_party_age: d['injured_party_age'] != null ? String(d['injured_party_age']) : '',
      injured_party_contact: (d['injured_party_contact'] as string) ?? '',
      injury_description: (d['injury_description'] as string) ?? '',
      body_part_affected: (d['body_part_affected'] as string) ?? '',
      immediate_action: (d['immediate_action'] as string) ?? '',
      ambulance_called: (d['ambulance_called'] as boolean) ?? false,
      first_aid_given: (d['first_aid_given'] as boolean) ?? false,
      area_closed: (d['area_closed'] as boolean) ?? false,
      equipment_isolated: (d['equipment_isolated'] as boolean) ?? false,
      witness_details: (d['witness_details'] as string) ?? '',
      reported_to_riddor: (d['reported_to_riddor'] as boolean) ?? false,
      riddor_reference: (d['riddor_reference'] as string) ?? '',
      police_reference: (d['police_reference'] as string) ?? '',
      hse_notified: (d['hse_notified'] as boolean) ?? false,
      status: (d['status'] as string) ?? 'open',
      claim_reference: (d['claim_reference'] as string) ?? '',
      claim_received_date: (d['claim_received_date'] as string)?.slice(0, 10) ?? '',
      claimant_solicitor: (d['claimant_solicitor'] as string) ?? '',
      insurer_notified: (d['insurer_notified'] as boolean) ?? false,
      insurer_reference: (d['insurer_reference'] as string) ?? '',
      internal_notes: (d['internal_notes'] as string) ?? '',
      investigation_findings: (d['investigation_findings'] as string) ?? '',
      corrective_actions: (d['corrective_actions'] as string) ?? '',
    });
  }, [isEdit, existingData]);

  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  function validate(): string[] {
    const errors: string[] = [];
    if (!form.site_id) errors.push('Site is required');
    if (!form.incident_date) errors.push('Incident date is required');
    if (!form.description.trim()) errors.push('Description is required');
    if (!form.reported_by.trim()) errors.push('Reporter name is required');
    return errors;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaveError(null);

    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);

    try {
      const body: Record<string, unknown> = {
        ...form,
        asset_id: form.asset_id || null,
        defect_id: form.defect_id || null,
        incident_time: form.incident_time || null,
        injured_party_age: form.injured_party_age ? parseInt(form.injured_party_age, 10) : null,
        claim_received_date: form.claim_received_date || null,
      };

      // Remove empty strings for optional fields
      for (const key of Object.keys(body)) {
        if (body[key] === '') body[key] = null;
      }

      // Restore required fields that shouldn't be null
      body['site_id'] = form.site_id;
      body['incident_date'] = form.incident_date;
      body['description'] = form.description;
      body['reported_by'] = form.reported_by;
      body['incident_type'] = form.incident_type;
      body['severity'] = form.severity;
      body['status'] = form.status;

      const url = isEdit ? `/api/v1/incidents/${id}` : '/api/v1/incidents';
      const method = isEdit ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(
          (err as Record<string, unknown>)?.['error']
            ? String((err as Record<string, Record<string, string>>)['error']['message'])
            : `Failed to ${isEdit ? 'update' : 'create'} incident`,
        );
      }

      const result = await response.json() as { data: { id: string } };
      navigate(`/incidents/${result.data.id}`);
    } catch (error) {
      captureError(error, { module: 'IncidentForm', operation: 'submit' });
      setSaveError(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full bg-iv-surface-2 border border-iv-border rounded-lg px-3 py-2 text-sm text-iv-text placeholder:text-iv-muted focus:outline-none focus:border-iv-accent';
  const textareaClass = `${inputClass} min-h-[80px] resize-y`;

  // Loading edit data
  if (isEdit && editLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet><title>Loading... | InspectVoice</title></Helmet>
        <Loader2 className="w-8 h-8 text-iv-muted animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{isEdit ? 'Edit Incident' : 'Report Incident'} — InspectVoice</title>
      </Helmet>

      <form onSubmit={(e) => void handleSubmit(e)} className="max-w-2xl mx-auto space-y-4">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/incidents" className="iv-btn-icon" aria-label="Back">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-semibold text-iv-text">
              {isEdit ? 'Edit Incident' : 'Report Incident'}
            </h1>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="iv-btn-primary flex items-center gap-1.5 text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Update' : 'Save'}
          </button>
        </div>

        {/* ── Validation Errors ── */}
        {validationErrors.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-sm font-medium text-red-400 mb-1">Please fix the following:</p>
            {validationErrors.map((err) => (
              <p key={err} className="text-xs text-red-400">• {err}</p>
            ))}
          </div>
        )}

        {/* ── Save Error ── */}
        {saveError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-sm text-red-400">{saveError}</p>
          </div>
        )}

        {/* ══ Section 1: Incident Details ══ */}
        <FormSection title="Incident Details" icon={<AlertTriangle className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="site_id" label="Site" required />
              <select id="site_id" value={form.site_id} onChange={(e) => updateField('site_id', e.target.value)} className={inputClass}>
                <option value="">Select site...</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="incident_date" label="Date" required />
              <input id="incident_date" type="date" value={form.incident_date} onChange={(e) => updateField('incident_date', e.target.value)} className={inputClass} />
            </div>

            <div>
              <FieldLabel htmlFor="incident_time" label="Time" />
              <input id="incident_time" type="time" value={form.incident_time} onChange={(e) => updateField('incident_time', e.target.value)} className={inputClass} />
            </div>

            <div>
              <FieldLabel htmlFor="incident_type" label="Type" />
              <select id="incident_type" value={form.incident_type} onChange={(e) => updateField('incident_type', e.target.value)} className={inputClass}>
                {INCIDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="severity" label="Severity" />
              <select id="severity" value={form.severity} onChange={(e) => updateField('severity', e.target.value)} className={inputClass}>
                {SEVERITY_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {isEdit && (
              <div>
                <FieldLabel htmlFor="status" label="Status" />
                <select id="status" value={form.status} onChange={(e) => updateField('status', e.target.value)} className={inputClass}>
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            )}

            <div className="sm:col-span-2">
              <FieldLabel htmlFor="description" label="Description" required />
              <textarea id="description" value={form.description} onChange={(e) => updateField('description', e.target.value)} className={textareaClass} placeholder="What happened..." />
            </div>

            <div className="sm:col-span-2">
              <FieldLabel htmlFor="location_on_site" label="Location on site" />
              <input id="location_on_site" value={form.location_on_site} onChange={(e) => updateField('location_on_site', e.target.value)} className={inputClass} placeholder="e.g. Near the swing set, south entrance" />
            </div>
          </div>
        </FormSection>

        {/* ══ Section 2: Reporter ══ */}
        <FormSection title="Reporter" icon={<User className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="reported_by" label="Name" required />
              <input id="reported_by" value={form.reported_by} onChange={(e) => updateField('reported_by', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel htmlFor="reporter_role" label="Role" />
              <input id="reporter_role" value={form.reporter_role} onChange={(e) => updateField('reporter_role', e.target.value)} className={inputClass} placeholder="e.g. Inspector, Site manager, Member of public" />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="reporter_contact" label="Contact" />
              <input id="reporter_contact" value={form.reporter_contact} onChange={(e) => updateField('reporter_contact', e.target.value)} className={inputClass} placeholder="Phone or email" />
            </div>
          </div>
        </FormSection>

        {/* ══ Section 3: Injury Details ══ */}
        <FormSection title="Injury Details" icon={<Stethoscope className="w-4 h-4" />} defaultOpen={form.incident_type === 'injury'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="injured_party_name" label="Injured person's name" />
              <input id="injured_party_name" value={form.injured_party_name} onChange={(e) => updateField('injured_party_name', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel htmlFor="injured_party_age" label="Age" />
              <input id="injured_party_age" type="number" min="0" max="150" value={form.injured_party_age} onChange={(e) => updateField('injured_party_age', e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="injured_party_contact" label="Contact" />
              <input id="injured_party_contact" value={form.injured_party_contact} onChange={(e) => updateField('injured_party_contact', e.target.value)} className={inputClass} placeholder="Phone or email" />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="injury_description" label="Injury description" />
              <textarea id="injury_description" value={form.injury_description} onChange={(e) => updateField('injury_description', e.target.value)} className={textareaClass} placeholder="Nature and extent of injury..." />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="body_part_affected" label="Body part affected" />
              <input id="body_part_affected" value={form.body_part_affected} onChange={(e) => updateField('body_part_affected', e.target.value)} className={inputClass} placeholder="e.g. Left wrist, head, knee" />
            </div>
          </div>
        </FormSection>

        {/* ══ Section 4: Immediate Response ══ */}
        <FormSection title="Immediate Response" icon={<Shield className="w-4 h-4" />}>
          <div className="space-y-3">
            <div>
              <FieldLabel htmlFor="immediate_action" label="Action taken" />
              <textarea id="immediate_action" value={form.immediate_action} onChange={(e) => updateField('immediate_action', e.target.value)} className={textareaClass} placeholder="What was done immediately..." />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CheckboxField id="ambulance_called" label="Ambulance called" checked={form.ambulance_called} onChange={(v) => updateField('ambulance_called', v)} />
              <CheckboxField id="first_aid_given" label="First aid given" checked={form.first_aid_given} onChange={(v) => updateField('first_aid_given', v)} />
              <CheckboxField id="area_closed" label="Area closed off" checked={form.area_closed} onChange={(v) => updateField('area_closed', v)} />
              <CheckboxField id="equipment_isolated" label="Equipment isolated" checked={form.equipment_isolated} onChange={(v) => updateField('equipment_isolated', v)} />
            </div>
          </div>
        </FormSection>

        {/* ══ Section 5: Witnesses ══ */}
        <FormSection title="Witnesses" icon={<Eye className="w-4 h-4" />} defaultOpen={false}>
          <FieldLabel htmlFor="witness_details" label="Witness names and contact details" />
          <textarea id="witness_details" value={form.witness_details} onChange={(e) => updateField('witness_details', e.target.value)} className={textareaClass} placeholder="Name, contact, brief statement..." />
        </FormSection>

        {/* ══ Section 6: Regulatory ══ */}
        <FormSection title="Regulatory Reporting" icon={<Scale className="w-4 h-4" />} defaultOpen={false}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <CheckboxField id="reported_to_riddor" label="Reported to RIDDOR" checked={form.reported_to_riddor} onChange={(v) => updateField('reported_to_riddor', v)} />
              <CheckboxField id="hse_notified" label="HSE notified" checked={form.hse_notified} onChange={(v) => updateField('hse_notified', v)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="riddor_reference" label="RIDDOR reference" />
                <input id="riddor_reference" value={form.riddor_reference} onChange={(e) => updateField('riddor_reference', e.target.value)} className={inputClass} />
              </div>
              <div>
                <FieldLabel htmlFor="police_reference" label="Police reference" />
                <input id="police_reference" value={form.police_reference} onChange={(e) => updateField('police_reference', e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
        </FormSection>

        {/* ══ Section 7: Claims ══ */}
        <FormSection title="Claims & Insurance" icon={<FileText className="w-4 h-4" />} defaultOpen={false}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="claim_reference" label="Claim reference" />
              <input id="claim_reference" value={form.claim_reference} onChange={(e) => updateField('claim_reference', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel htmlFor="claim_received_date" label="Claim received date" />
              <input id="claim_received_date" type="date" value={form.claim_received_date} onChange={(e) => updateField('claim_received_date', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel htmlFor="claimant_solicitor" label="Claimant's solicitor" />
              <input id="claimant_solicitor" value={form.claimant_solicitor} onChange={(e) => updateField('claimant_solicitor', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel htmlFor="insurer_reference" label="Insurer reference" />
              <input id="insurer_reference" value={form.insurer_reference} onChange={(e) => updateField('insurer_reference', e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <CheckboxField id="insurer_notified" label="Insurer notified" checked={form.insurer_notified} onChange={(v) => updateField('insurer_notified', v)} />
            </div>
          </div>
        </FormSection>

        {/* ══ Section 8: Investigation ══ */}
        <FormSection title="Investigation & Follow-up" icon={<Phone className="w-4 h-4" />} defaultOpen={false}>
          <div className="space-y-4">
            <div>
              <FieldLabel htmlFor="investigation_findings" label="Investigation findings" />
              <textarea id="investigation_findings" value={form.investigation_findings} onChange={(e) => updateField('investigation_findings', e.target.value)} className={textareaClass} placeholder="Root cause analysis, contributing factors..." />
            </div>
            <div>
              <FieldLabel htmlFor="corrective_actions" label="Corrective actions" />
              <textarea id="corrective_actions" value={form.corrective_actions} onChange={(e) => updateField('corrective_actions', e.target.value)} className={textareaClass} placeholder="Actions taken to prevent recurrence..." />
            </div>
            <div>
              <FieldLabel htmlFor="internal_notes" label="Internal notes" />
              <textarea id="internal_notes" value={form.internal_notes} onChange={(e) => updateField('internal_notes', e.target.value)} className={textareaClass} placeholder="Confidential notes (not included in claims pack)..." />
            </div>
          </div>
        </FormSection>

        {/* ── Bottom Save ── */}
        <div className="flex items-center justify-end gap-3 pt-2 pb-8">
          <Link to="/incidents" className="iv-btn-secondary text-sm">Cancel</Link>
          <button
            type="submit"
            disabled={saving}
            className="iv-btn-primary flex items-center gap-1.5 text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Update Incident' : 'Save Incident'}
          </button>
        </div>
      </form>
    </>
  );
}
