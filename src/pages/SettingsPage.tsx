/**
 * InspectVoice — Settings Page
 * User profile, inspector credentials, organisation settings, and preferences.
 *
 * Route: /settings
 * Replaces placeholder in App.tsx
 *
 * Features:
 * - Profile section: name, email, phone
 * - Inspector credentials: RPII number, RoSPA number, other qualifications
 * - Organisation settings: name, branding (admin/manager only)
 * - Inspection preferences: default type, approval workflow, auto-export
 * - AI normalisation settings: style preset, custom guide, examples (admin/manager only)
 * - Sign out
 * - Save per-section with loading/success/error feedback
 * - Role-based visibility (org settings only for manager/admin)
 * - Responsive layout
 *
 * API:
 *   GET  /api/v1/users/me           → current user profile
 *   PUT  /api/v1/users/me           → update profile + credentials
 *   GET  /api/v1/org/settings       → current organisation
 *   PUT  /api/v1/org/settings       → update org settings (admin/manager)
 */

import { useState, useCallback, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Settings,
  User,
  Shield,
  Award,
  Building2,
  ClipboardCheck,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Plus,
  X,
  RefreshCw,
  Trash2,
  LogOut,
  CreditCard,
} from 'lucide-react';
import { useClerk } from '@clerk/clerk-react';
import { useFetch } from '@hooks/useFetch';
import { clearAllData } from '@services/offlineStore';
import type { User as UserEntity, Organisation } from '@/types/entities';
import {
  InspectionType,
  UserRole,
  INSPECTION_TYPE_LABELS,
} from '@/types/enums';
import { NormalisationSettings } from '@components/NormalisationSettings';

// =============================================
// TYPES
// =============================================

interface UserProfileResponse {
  data: UserEntity;
}

interface OrgResponse {
  data: Organisation;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

interface BillingStatus {
  status: string;
  subscription_status: string;
  subscription_plan: string | null;
  subscription_current_period_end: string | null;
  trial_ends_at: string | null;
  trial_days_remaining: number | null;
  trial_expired: boolean;
  has_subscription: boolean;
  needs_upgrade: boolean;
  has_payment_method: boolean;
}

interface SectionState {
  status: SaveStatus;
  message: string;
}

// =============================================
// CONSTANTS
// =============================================

const INITIAL_SECTION_STATE: SectionState = { status: 'idle', message: '' };

// =============================================
// HELPER COMPONENTS
// =============================================

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-9 h-9 rounded-lg bg-iv-accent/15 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <h2 className="text-sm font-semibold text-iv-text">{title}</h2>
        <p className="text-2xs text-iv-muted mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function SaveButton({
  sectionState,
  onClick,
  disabled,
}: {
  sectionState: SectionState;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 pt-4 border-t border-iv-border mt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || sectionState.status === 'saving'}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-accent text-white rounded-lg text-sm font-medium hover:bg-iv-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {sectionState.status === 'saving' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {sectionState.status === 'saving' ? 'Saving…' : 'Save Changes'}
      </button>

      {sectionState.status === 'success' && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
          <CheckCircle className="w-3.5 h-3.5" />
          {sectionState.message || 'Saved'}
        </span>
      )}

      {sectionState.status === 'error' && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          {sectionState.message || 'Failed to save'}
        </span>
      )}
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-iv-muted mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-2xs text-iv-muted-2 mt-1">{hint}</p>}
    </div>
  );
}

// =============================================
// PROFILE SECTION
// =============================================

function ProfileSection({
  user,
  onSave,
}: {
  user: UserEntity;
  onSave: (data: Partial<UserEntity>) => Promise<void>;
}): JSX.Element {
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [sectionState, setSectionState] = useState<SectionState>(INITIAL_SECTION_STATE);

  useEffect(() => {
    setFirstName(user.first_name ?? '');
    setLastName(user.last_name ?? '');
    setPhone(user.phone ?? '');
  }, [user]);

  const handleSave = useCallback(async () => {
    setSectionState({ status: 'saving', message: '' });
    try {
      await onSave({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
      });
      setSectionState({ status: 'success', message: 'Profile updated' });
      setTimeout(() => setSectionState(INITIAL_SECTION_STATE), 3000);
    } catch {
      setSectionState({ status: 'error', message: 'Failed to update profile' });
    }
  }, [firstName, lastName, phone, onSave]);

  return (
    <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <SectionHeader
        icon={<User className="w-4 h-4 text-iv-accent" />}
        title="Profile"
        description="Your personal details. Email is managed by your authentication provider."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="First Name" htmlFor="profile-first-name">
          <input
            id="profile-first-name"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            placeholder="Enter first name"
          />
        </FormField>

        <FormField label="Last Name" htmlFor="profile-last-name">
          <input
            id="profile-last-name"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            placeholder="Enter last name"
          />
        </FormField>

        <FormField label="Email" htmlFor="profile-email" hint="Managed by your authentication provider">
          <input
            id="profile-email"
            type="email"
            value={user.email}
            disabled
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-muted cursor-not-allowed opacity-60"
          />
        </FormField>

        <FormField label="Phone" htmlFor="profile-phone">
          <input
            id="profile-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            placeholder="+44 7xxx xxxxxx"
          />
        </FormField>

        <div className="sm:col-span-2">
          <FormField label="Role" htmlFor="profile-role">
            <input
              id="profile-role"
              type="text"
              value={user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              disabled
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-muted cursor-not-allowed opacity-60"
            />
          </FormField>
        </div>
      </div>

      <SaveButton sectionState={sectionState} onClick={handleSave} />
    </section>
  );
}

// =============================================
// CREDENTIALS SECTION
// =============================================

function CredentialsSection({
  user,
  onSave,
}: {
  user: UserEntity;
  onSave: (data: Partial<UserEntity>) => Promise<void>;
}): JSX.Element {
  const [rpiiNumber, setRpiiNumber] = useState(user.rpii_certification_number ?? '');
  const [rospaNumber, setRospaNumber] = useState(user.rospa_certification_number ?? '');
  const [qualifications, setQualifications] = useState<string[]>(user.other_qualifications ?? []);
  const [newQualification, setNewQualification] = useState('');
  const [sectionState, setSectionState] = useState<SectionState>(INITIAL_SECTION_STATE);

  useEffect(() => {
    setRpiiNumber(user.rpii_certification_number ?? '');
    setRospaNumber(user.rospa_certification_number ?? '');
    setQualifications(user.other_qualifications ?? []);
  }, [user]);

  const handleAddQualification = useCallback(() => {
    const trimmed = newQualification.trim();
    if (trimmed && !qualifications.includes(trimmed)) {
      setQualifications((prev) => [...prev, trimmed]);
      setNewQualification('');
    }
  }, [newQualification, qualifications]);

  const handleRemoveQualification = useCallback((index: number) => {
    setQualifications((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddQualification();
      }
    },
    [handleAddQualification],
  );

  const handleSave = useCallback(async () => {
    setSectionState({ status: 'saving', message: '' });
    try {
      await onSave({
        rpii_certification_number: rpiiNumber.trim() || null,
        rospa_certification_number: rospaNumber.trim() || null,
        other_qualifications: qualifications,
      });
      setSectionState({ status: 'success', message: 'Credentials updated' });
      setTimeout(() => setSectionState(INITIAL_SECTION_STATE), 3000);
    } catch {
      setSectionState({ status: 'error', message: 'Failed to update credentials' });
    }
  }, [rpiiNumber, rospaNumber, qualifications, onSave]);

  return (
    <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <SectionHeader
        icon={<Award className="w-4 h-4 text-iv-accent" />}
        title="Inspector Credentials"
        description="Your professional certifications. These appear on inspection reports."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          label="RPII Certification Number"
          htmlFor="cred-rpii"
          hint="Register of Play Inspectors International"
        >
          <input
            id="cred-rpii"
            type="text"
            value={rpiiNumber}
            onChange={(e) => setRpiiNumber(e.target.value)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            placeholder="e.g. RPII-12345"
          />
        </FormField>

        <FormField
          label="RoSPA Certification Number"
          htmlFor="cred-rospa"
          hint="Royal Society for the Prevention of Accidents"
        >
          <input
            id="cred-rospa"
            type="text"
            value={rospaNumber}
            onChange={(e) => setRospaNumber(e.target.value)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            placeholder="e.g. RoSPA-67890"
          />
        </FormField>

        <div className="sm:col-span-2">
          <FormField
            label="Other Qualifications"
            htmlFor="cred-other"
            hint="Press Enter or click + to add. These appear on PDF reports."
          >
            <div className="flex items-center gap-2">
              <input
                id="cred-other"
                type="text"
                value={newQualification}
                onChange={(e) => setNewQualification(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
                placeholder="e.g. NEBOSH, IOSH, City & Guilds"
              />
              <button
                type="button"
                onClick={handleAddQualification}
                disabled={!newQualification.trim()}
                className="iv-btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Add qualification"
                title="Add"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </FormField>

          {qualifications.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {qualifications.map((qual, index) => (
                <span
                  key={`${qual}-${index}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-iv-accent/10 text-iv-accent rounded-full text-xs font-medium"
                >
                  {qual}
                  <button
                    type="button"
                    onClick={() => handleRemoveQualification(index)}
                    className="hover:text-red-400 transition-colors"
                    aria-label={`Remove ${qual}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <SaveButton sectionState={sectionState} onClick={handleSave} />
    </section>
  );
}

// =============================================
// ORGANISATION SECTION (Admin/Manager only)
// =============================================

function OrganisationSection({
  org,
  onSave,
}: {
  org: Organisation;
  onSave: (data: Partial<Organisation>) => Promise<void>;
}): JSX.Element {
  const orgRecord = org as unknown as Record<string, unknown>;
  const [orgName, setOrgName] = useState((orgRecord['company_name'] as string | null) ?? org.name ?? '');
  const [primaryColor, setPrimaryColor] = useState((orgRecord['brand_colour'] as string | null) ?? org.primary_color ?? '#22C55E');
 const orgMeta = (org as unknown as Record<string, unknown>).metadata as Record<string, unknown> | null | undefined;
  const [logoBase64, setLogoBase64] = useState<string | null>(
    orgMeta?.logo_base64 as string | null ?? null,
  );
  const [logoPreview, setLogoPreview] = useState<string | null>(logoBase64);
  const [sectionState, setSectionState] = useState<SectionState>(INITIAL_SECTION_STATE);

  useEffect(() => {
    const meta2 = (org as unknown as Record<string, unknown>);
    setOrgName((meta2['company_name'] as string | null) ?? org.name ?? '');
    setPrimaryColor((meta2['brand_colour'] as string | null) ?? org.primary_color ?? '#22C55E');
    const meta = (org as unknown as Record<string, unknown>).metadata as Record<string, unknown> | null | undefined;
    const savedLogo = meta?.logo_base64 as string | null ?? null;
    setLogoBase64(savedLogo);
    setLogoPreview(savedLogo);
  }, [org]);

  const handleLogoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setSectionState({ status: 'error', message: 'Logo must be PNG or JPEG' });
      return;
    }
    if (file.size > 200_000) {
      setSectionState({ status: 'error', message: 'Logo must be under 200KB' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setLogoBase64(base64);
      setLogoPreview(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveLogo = useCallback(() => {
    setLogoBase64(null);
    setLogoPreview(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSectionState({ status: 'saving', message: '' });
    try {
      const existingMeta = (org as unknown as Record<string, unknown>).metadata as Record<string, unknown> | null ?? {};
      await onSave({
        company_name: orgName.trim(),
        brand_colour: primaryColor.trim(),
        metadata: { ...existingMeta, logo_base64: logoBase64 },
      } as Partial<Organisation>);
      setSectionState({ status: 'success', message: 'Organisation updated' });
      setTimeout(() => setSectionState(INITIAL_SECTION_STATE), 3000);
    } catch {
      setSectionState({ status: 'error', message: 'Failed to update organisation' });
    }
  }, [orgName, primaryColor, logoBase64, org, onSave]);

  const tierLabel = (org.tier ?? 'free').charAt(0).toUpperCase() + (org.tier ?? 'free').slice(1);
  const statusLabel = (org.subscription_status ?? 'trialing').charAt(0).toUpperCase() + (org.subscription_status ?? 'trialing').slice(1);

  return (
    <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <SectionHeader
        icon={<Building2 className="w-4 h-4 text-iv-accent" />}
        title="Organisation"
        description="Organisation name and branding for PDF reports. Admin and Manager only."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Organisation Name" htmlFor="org-name">
          <input
            id="org-name"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            placeholder="Your organisation name"
          />
        </FormField>

        <FormField label="Brand Colour" htmlFor="org-color" hint="Used on PDF report headers">
          <div className="flex items-center gap-2">
            <input
              id="org-color"
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-iv-border cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="flex-1 px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text font-mono focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
              placeholder="#3B82F6"
              maxLength={7}
            />
          </div>
        </FormField>

        <FormField label="Subscription Tier" htmlFor="org-tier">
          <input
            id="org-tier"
            type="text"
            value={tierLabel}
            disabled
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-muted cursor-not-allowed opacity-60"
          />
        </FormField>

        <FormField label="Subscription Status" htmlFor="org-sub-status">
          <input
            id="org-sub-status"
            type="text"
            value={statusLabel}
            disabled
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-muted cursor-not-allowed opacity-60"
          />
        </FormField>

        <div className="sm:col-span-2">
          <FormField label="Company Logo" htmlFor="org-logo" hint="PNG or JPEG, max 200KB. Appears on PDF report cover page.">
            <div className="flex items-center gap-4">
              {logoPreview ? (
                <div className="relative w-16 h-16 rounded-lg border border-iv-border bg-white flex items-center justify-center overflow-hidden">
                  <img src={logoPreview} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                    aria-label="Remove logo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg border-2 border-dashed border-iv-border flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-iv-muted-2" />
                </div>
              )}
              <label
                htmlFor="org-logo"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text hover:bg-iv-surface cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                {logoPreview ? 'Change Logo' : 'Upload Logo'}
              </label>
              <input
                id="org-logo"
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleLogoChange}
                className="hidden"
              />
            </div>
          </FormField>
        </div>
      </div>

      <SaveButton sectionState={sectionState} onClick={handleSave} disabled={!orgName.trim()} />
    </section>
  );
}

// =============================================
// INSPECTION PREFERENCES (Admin/Manager only)
// =============================================

function InspectionPreferences({
  org,
  onSave,
}: {
  org: Organisation;
  onSave: (data: Partial<Organisation>) => Promise<void>;
}): JSX.Element {
  const [defaultType, setDefaultType] = useState<InspectionType>(org.settings?.default_inspection_type ?? InspectionType.ROUTINE_VISUAL);
  const [requireApproval, setRequireApproval] = useState(org.settings?.require_manager_approval ?? false);
  const [autoExport, setAutoExport] = useState(org.settings?.auto_export_on_sign ?? false);
  const [sectionState, setSectionState] = useState<SectionState>(INITIAL_SECTION_STATE);

  useEffect(() => {
    setDefaultType(org.settings?.default_inspection_type ?? InspectionType.ROUTINE_VISUAL);
    setRequireApproval(org.settings?.require_manager_approval ?? false);
    setAutoExport(org.settings?.auto_export_on_sign ?? false);
  }, [org]);

  const handleSave = useCallback(async () => {
    setSectionState({ status: 'saving', message: '' });
    try {
      await onSave({
        settings: {
          default_inspection_type: defaultType,
          require_manager_approval: requireApproval,
          auto_export_on_sign: autoExport,
        },
      });
      setSectionState({ status: 'success', message: 'Preferences updated' });
      setTimeout(() => setSectionState(INITIAL_SECTION_STATE), 3000);
    } catch {
      setSectionState({ status: 'error', message: 'Failed to update preferences' });
    }
  }, [defaultType, requireApproval, autoExport, onSave]);

  return (
    <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <SectionHeader
        icon={<ClipboardCheck className="w-4 h-4 text-iv-accent" />}
        title="Inspection Preferences"
        description="Default settings for new inspections across your organisation."
      />

      <div className="space-y-4">
        <FormField label="Default Inspection Type" htmlFor="pref-default-type">
          <select
            id="pref-default-type"
            value={defaultType}
            onChange={(e) => setDefaultType(e.target.value as InspectionType)}
            className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
          >
            {Object.values(InspectionType).map((type) => (
              <option key={type} value={type}>
                {INSPECTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </FormField>

        <div className="flex items-center justify-between p-3 bg-iv-surface-2 rounded-lg">
          <div>
            <p className="text-sm text-iv-text">Require Manager Approval</p>
            <p className="text-2xs text-iv-muted mt-0.5">
              Inspections must be approved by a manager before they can be signed and exported.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={requireApproval}
            onClick={() => setRequireApproval((prev) => !prev)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${
              requireApproval ? 'bg-iv-accent' : 'bg-iv-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                requireApproval ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between p-3 bg-iv-surface-2 rounded-lg">
          <div>
            <p className="text-sm text-iv-text">Auto-Export on Sign</p>
            <p className="text-2xs text-iv-muted mt-0.5">
              Automatically generate and store the PDF report when an inspection is signed.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoExport}
            onClick={() => setAutoExport((prev) => !prev)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${
              autoExport ? 'bg-iv-accent' : 'bg-iv-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoExport ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <SaveButton sectionState={sectionState} onClick={handleSave} />
    </section>
  );
}

// =============================================
// RESET DEMO DATA SECTION (Admin only)
// =============================================
function ResetDemoDataSection(): JSX.Element {
  const [confirmText, setConfirmText] = useState('');
  const [sectionState, setSectionState] = useState<SectionState>(INITIAL_SECTION_STATE);
  const [showConfirm, setShowConfirm] = useState(false);

  const canReset = confirmText.trim().toUpperCase() === 'RESET';

  const handleReset = useCallback(async () => {
    if (!canReset) return;
    setSectionState({ status: 'saving', message: '' });
    try {
      const { secureFetch } = await import('@hooks/useFetch');
      await secureFetch('/api/v1/admin/reset-demo-data', { method: 'DELETE' });

      // Clear all IndexedDB stores
      const dbNames = ['inspectvoice-offline'];
      for (const dbName of dbNames) {
        try {
          const dbReq = indexedDB.open(dbName);
          await new Promise<void>((resolve) => {
            dbReq.onsuccess = () => {
              const db = dbReq.result;
              const storeNames = Array.from(db.objectStoreNames);
              if (storeNames.length > 0) {
                const tx = db.transaction(storeNames, 'readwrite');
                for (const store of storeNames) {
                  tx.objectStore(store).clear();
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
              } else {
                resolve();
              }
            };
            dbReq.onerror = () => resolve();
          });
        } catch {
          // Continue — server data is already wiped
        }
      }

      setSectionState({ status: 'success', message: 'All data cleared' });
      setConfirmText('');
      setShowConfirm(false);
      // Reload after brief delay so UI reflects empty state
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setSectionState({ status: 'error', message: 'Failed to reset data' });
    }
  }, [canReset]);

  return (
    <section className="bg-iv-surface border border-red-500/20 rounded-xl p-4">
      <SectionHeader
        icon={<Trash2 className="w-4 h-4 text-red-400" />}
        title="Reset Demo Data"
        description="Permanently delete all sites, assets, inspections, defects, and library entries. Used for demo preparation."
      />
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Reset All Data
        </button>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-sm text-red-400 font-medium mb-1">This action cannot be undone</p>
            <p className="text-xs text-iv-muted">
              This will permanently delete all sites, assets, inspections, defects, library entries,
              and performance metrics for your organisation. Your profile, credentials, and
              organisation settings will be preserved.
            </p>
          </div>
          <FormField label="Type RESET to confirm" htmlFor="reset-confirm">
            <input
              id="reset-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
              className="w-full sm:w-48 px-3 py-2 bg-iv-surface-2 border border-red-500/30 rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/40 transition-colors font-mono"
              autoComplete="off"
            />
          </FormField>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={!canReset || sectionState.status === 'saving'}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sectionState.status === 'saving' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {sectionState.status === 'saving' ? 'Resetting…' : 'Confirm Reset'}
            </button>
            <button
              type="button"
              onClick={() => { setShowConfirm(false); setConfirmText(''); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface transition-colors"
            >
              Cancel
            </button>
            {sectionState.status === 'success' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <CheckCircle className="w-3.5 h-3.5" />
                {sectionState.message}
              </span>
            )}
            {sectionState.status === 'error' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                {sectionState.message}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// =============================================
// MAIN SETTINGS COMPONENT
// =============================================

export function SettingsPage(): JSX.Element {
  const { signOut } = useClerk();

  const { data: userData, loading: userLoading, error: userError, refetch: refetchUser } =
    useFetch<UserProfileResponse>('/api/v1/users/me');

  const { data: orgData, loading: orgLoading, error: orgError, refetch: refetchOrg } =
    useFetch<OrgResponse>('/api/v1/org/settings');

  const user = userData?.data ?? null;
  const org = orgData?.data ?? null;
  const isManagerOrAdmin = user?.role === UserRole.MANAGER || user?.role === UserRole.ADMIN;
  const loading = userLoading || orgLoading;
  const hasError = userError || orgError;

  const handleSaveProfile = useCallback(async (data: Partial<UserEntity>) => {
    const { secureFetch } = await import('@hooks/useFetch');
    await secureFetch('/api/v1/users/me', { method: 'PUT', body: data });
    await refetchUser();
  }, [refetchUser]);

  const handleSaveOrg = useCallback(async (data: Partial<Organisation>) => {
    const { secureFetch } = await import('@hooks/useFetch');
    await secureFetch('/api/v1/org/settings', { method: 'PUT', body: data });
    await refetchOrg();
  }, [refetchOrg]);

  const handleRefresh = useCallback(() => {
    void refetchUser();
    void refetchOrg();
  }, [refetchUser, refetchOrg]);

  const handleSignOut = useCallback(async () => {
    try {
      await clearAllData();
    } catch {
      // Non-blocking — sign out regardless
    }
    await signOut({ redirectUrl: '/sign-in' });
  }, [signOut]);

  return (
    <>
      <Helmet>
        <title>Settings — InspectVoice</title>
        <meta name="description" content="Manage your profile, inspector credentials, and organisation settings." />
      </Helmet>

      <div className="space-y-6 max-w-3xl">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-iv-accent/15 flex items-center justify-center">
              <Settings className="w-5 h-5 text-iv-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Settings</h1>
              <p className="text-xs text-iv-muted mt-0.5">Profile, credentials, and organisation preferences</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="iv-btn-icon"
            aria-label="Refresh settings"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Loading state */}
        {loading && !user && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading settings…</p>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load settings</p>
            <p className="text-xs text-iv-muted mb-4">
              {userError?.message ?? orgError?.message ?? 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-surface border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* Settings sections */}
        {user && (
          <>
            <ProfileSection user={user} onSave={handleSaveProfile} />
            <CredentialsSection user={user} onSave={handleSaveProfile} />

            {isManagerOrAdmin && org && (
              <>
                <OrganisationSection org={org} onSave={handleSaveOrg} />
                <InspectionPreferences org={org} onSave={handleSaveOrg} />
                <NormalisationSettings org={org} onSave={handleSaveOrg} />
              </>
            )}

            {!isManagerOrAdmin && (
              <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
                <div className="flex items-center gap-2 text-iv-muted">
                  <Shield className="w-4 h-4" />
                  <p className="text-sm">
                    Organisation and inspection preferences are managed by your administrator.
                  </p>
                </div>
              </div>
            )}

            {/* Billing */}
            {isManagerOrAdmin && <BillingSection />}

            {/* Reset Demo Data (Admin only) */}
            {user.role === UserRole.ADMIN && <ResetDemoDataSection />}

            {/* Sign Out */}
            <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <LogOut className="w-4 h-4 text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-iv-text">Sign Out</p>
                    <p className="text-2xs text-iv-muted mt-0.5">End your current session and return to the sign-in page</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

// =============================================
// BILLING SECTION (Admin/Manager only)
// =============================================

function BillingSection(): JSX.Element {
  const { data: billingData, loading: billingLoading } =
    useFetch<{ data: BillingStatus }>('/api/v1/billing/status');

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const billing = billingData?.data ?? null;

  const handleCheckout = useCallback(async () => {
    setCheckoutLoading(true);
    setBillingError(null);
    try {
      const { secureFetch } = await import('@hooks/useFetch');
      const response = await secureFetch<{ data: { checkout_url: string } }>(
        '/api/v1/billing/checkout',
        { method: 'POST' },
      );
      if (response?.data?.checkout_url) {
        window.location.href = response.data.checkout_url;
      }
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setCheckoutLoading(false);
    }
  }, []);

  const handlePortal = useCallback(async () => {
    setPortalLoading(true);
    setBillingError(null);
    try {
      const { secureFetch } = await import('@hooks/useFetch');
      const response = await secureFetch<{ data: { portal_url: string } }>(
        '/api/v1/billing/portal',
        { method: 'POST' },
      );
      if (response?.data?.portal_url) {
        window.location.href = response.data.portal_url;
      }
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  }, []);

  if (billingLoading || !billing) {
    return (
      <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
        <SectionHeader
          icon={<CreditCard className="w-4 h-4 text-iv-accent" />}
          title="Billing"
          description="Subscription and payment management."
        />
        <div className="flex items-center gap-2 text-iv-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading billing status…</span>
        </div>
      </section>
    );
  }

  const isActive = billing.status === 'active';
  const isTrialing = billing.status === 'trialing';
  const isExpired = billing.status === 'expired';

  return (
    <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <SectionHeader
        icon={<CreditCard className="w-4 h-4 text-iv-accent" />}
        title="Billing"
        description="Subscription and payment management."
      />

      {/* Status banner */}
      {isTrialing && (
        <div className="p-3 rounded-lg bg-iv-accent/10 border border-iv-accent/20 mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-iv-accent flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-iv-accent">Free Trial Active</p>
              <p className="text-2xs text-iv-muted mt-0.5">
                {billing.trial_days_remaining !== null && billing.trial_days_remaining > 0
                  ? `${billing.trial_days_remaining} days remaining — full access to all features`
                  : 'Trial ending soon — subscribe to continue'}
              </p>
            </div>
          </div>
        </div>
      )}

      {isActive && (
        <div className="p-3 rounded-lg bg-iv-accent/10 border border-iv-accent/20 mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-iv-accent flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-iv-accent">Active Subscription</p>
              <p className="text-2xs text-iv-muted mt-0.5">
                InspectVoice Team — £99/month
                {billing.subscription_current_period_end && (
                  <> · Renews {new Date(billing.subscription_current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {isExpired && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Trial Expired</p>
              <p className="text-2xs text-iv-muted mt-0.5">
                Subscribe to continue using InspectVoice
              </p>
            </div>
          </div>
        </div>
      )}

      {billingError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
          <p className="text-xs text-red-400">{billingError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {!isActive && (
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-accent text-white rounded-lg text-sm font-medium hover:bg-iv-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {checkoutLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4" />
            )}
            {checkoutLoading ? 'Redirecting…' : 'Subscribe — £99/month'}
          </button>
        )}

        {billing.has_payment_method && (
          <button
            type="button"
            onClick={() => void handlePortal()}
            disabled={portalLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {portalLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Settings className="w-4 h-4" />
            )}
            {portalLoading ? 'Opening…' : 'Manage Billing'}
          </button>
        )}
      </div>
    </section>
  );
}
export default SettingsPage;

