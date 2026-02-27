/**
 * InspectVoice — Site Form Page
 * Create or edit a site with full validation and offline-first save.
 * Saves to API (Neon) when online, falls back to IndexedDB cache when offline.
 * Lat/lng are auto-populated from postcode via postcodes.io (free, no key).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Save,
  Loader2,
  MapPin,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useFormValidation } from '@hooks/useFormValidation';
import { sitesCache } from '@services/offlineStore';
import { secureFetch } from '@hooks/useFetch';
import { captureError } from '@utils/errorTracking';
import { SiteEvents, trackPageView } from '@utils/analytics';
import {
  createValidator,
  isValidUKPostcode,
  isValidEmail,
  isValidUKPhone,
  isValidLatitude,
  isValidLongitude,
  ValidationErrorCode,
} from '@utils/validation';
import {
  SiteType,
  SiteStatus,
  SITE_TYPE_LABELS,
} from '@/types';
import type { Site } from '@/types';

// =============================================
// FORM VALUES TYPE
// =============================================

type SiteFormValues = {
  name: string;
  site_code: string;
  address: string;
  postcode: string;
  latitude: string;
  longitude: string;
  site_type: SiteType;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  access_notes: string;
  parking_notes: string;
  install_date: string;
  inspection_frequency_routine_days: string;
  inspection_frequency_operational_days: string;
  inspection_frequency_annual_days: string;
  notes: string;
};

const EMPTY_FORM: SiteFormValues = {
  name: '',
  site_code: '',
  address: '',
  postcode: '',
  latitude: '',
  longitude: '',
  site_type: SiteType.PLAYGROUND,
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  access_notes: '',
  parking_notes: '',
  install_date: '',
  inspection_frequency_routine_days: '7',
  inspection_frequency_operational_days: '90',
  inspection_frequency_annual_days: '365',
  notes: '',
};

// =============================================
// POSTCODE LOOKUP
// =============================================

type PostcodeLookupStatus = 'idle' | 'looking' | 'found' | 'not-found' | 'error';

interface PostcodeLookupResult {
  latitude: number;
  longitude: number;
}

async function lookupPostcode(postcode: string): Promise<PostcodeLookupResult | null> {
  try {
    const cleaned = postcode.replace(/\s+/g, '').toUpperCase();
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleaned)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 200 && data.result) {
      return {
        latitude: data.result.latitude,
        longitude: data.result.longitude,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================
// VALIDATION
// =============================================

function validateSiteForm(values: SiteFormValues) {
  return createValidator()
    .required('name', values.name, 'Site name')
    .length('name', values.name, 1, 200, 'Site name')
    .required('address', values.address, 'Address')
    .length('address', values.address, 1, 500, 'Address')
    .check(
      'postcode',
      () => values.postcode && !isValidUKPostcode(values.postcode) ? 'Enter a valid UK postcode' : null,
      ValidationErrorCode.PATTERN,
    )
    .check(
      'latitude',
      () => {
        if (!values.latitude) return null;
        const num = Number(values.latitude);
        return isNaN(num) || !isValidLatitude(num) ? 'Latitude must be between -90 and 90' : null;
      },
      ValidationErrorCode.RANGE,
    )
    .check(
      'longitude',
      () => {
        if (!values.longitude) return null;
        const num = Number(values.longitude);
        return isNaN(num) || !isValidLongitude(num) ? 'Longitude must be between -180 and 180' : null;
      },
      ValidationErrorCode.RANGE,
    )
    .check(
      'contact_email',
      () => values.contact_email && !isValidEmail(values.contact_email) ? 'Enter a valid email address' : null,
      ValidationErrorCode.PATTERN,
    )
    .check(
      'contact_phone',
      () => values.contact_phone && !isValidUKPhone(values.contact_phone) ? 'Enter a valid UK phone number' : null,
      ValidationErrorCode.PATTERN,
    )
    .check(
      'inspection_frequency_routine_days',
      () => {
        const num = Number(values.inspection_frequency_routine_days);
        return isNaN(num) || num < 1 || num > 365 ? 'Routine frequency must be 1-365 days' : null;
      },
      ValidationErrorCode.RANGE,
    )
    .check(
      'inspection_frequency_operational_days',
      () => {
        const num = Number(values.inspection_frequency_operational_days);
        return isNaN(num) || num < 1 || num > 365 ? 'Operational frequency must be 1-365 days' : null;
      },
      ValidationErrorCode.RANGE,
    )
    .check(
      'inspection_frequency_annual_days',
      () => {
        const num = Number(values.inspection_frequency_annual_days);
        return isNaN(num) || num < 1 || num > 730 ? 'Annual frequency must be 1-730 days' : null;
      },
      ValidationErrorCode.RANGE,
    )
    .validate();
}

// =============================================
// BUILD API PAYLOAD (only fields the worker expects)
// =============================================

function buildApiPayload(values: SiteFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    site_code: values.site_code.trim() || null,
    address: values.address.trim(),
    postcode: values.postcode.trim().toUpperCase() || null,
    latitude: values.latitude ? Number(values.latitude) : 0,
    longitude: values.longitude ? Number(values.longitude) : 0,
    site_type: values.site_type,
    contact_name: values.contact_name.trim() || null,
    contact_phone: values.contact_phone.trim() || null,
    contact_email: values.contact_email.trim().toLowerCase() || null,
    access_notes: values.access_notes.trim() || null,
    parking_notes: values.parking_notes.trim() || null,
    install_date: values.install_date || null,
    inspection_frequency_routine_days: Number(values.inspection_frequency_routine_days),
    inspection_frequency_operational_days: Number(values.inspection_frequency_operational_days),
    inspection_frequency_annual_days: Number(values.inspection_frequency_annual_days),
    status: SiteStatus.ACTIVE,
    notes: values.notes.trim() || null,
    metadata: {},
  };
}

// Build a full Site object for local IndexedDB cache (used as fallback)
function buildLocalSiteData(values: SiteFormValues, siteId: string): Site {
  const now = new Date().toISOString();
  return {
    id: siteId,
    org_id: '',
    name: values.name.trim(),
    site_code: values.site_code.trim() || null,
    address: values.address.trim(),
    postcode: values.postcode.trim().toUpperCase() || null,
    latitude: values.latitude ? Number(values.latitude) : 0,
    longitude: values.longitude ? Number(values.longitude) : 0,
    site_type: values.site_type,
    contact_name: values.contact_name.trim() || null,
    contact_phone: values.contact_phone.trim() || null,
    contact_email: values.contact_email.trim().toLowerCase() || null,
    access_notes: values.access_notes.trim() || null,
    opening_hours: null,
    parking_notes: values.parking_notes.trim() || null,
    install_date: values.install_date || null,
    last_refurbishment_date: null,
    inspection_frequency_routine_days: Number(values.inspection_frequency_routine_days),
    inspection_frequency_operational_days: Number(values.inspection_frequency_operational_days),
    inspection_frequency_annual_days: Number(values.inspection_frequency_annual_days),
    total_asset_value_gbp: null,
    maintenance_contract_ref: null,
    status: SiteStatus.ACTIVE,
    closure_reason: null,
    notes: values.notes.trim() || null,
    metadata: {},
    created_by: null,
    created_at: now,
    updated_at: now,
  };
}

// =============================================
// COMPONENT
// =============================================

export function SiteForm(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id) && id !== 'new';

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [postcodeLookup, setPostcodeLookup] = useState<PostcodeLookupStatus>('idle');
  const lastLookedUp = useRef<string>('');

  useEffect(() => {
    trackPageView(isEditing ? `/sites/${id ?? ''}/edit` : '/sites/new');
  }, [isEditing, id]);

  const form = useFormValidation<SiteFormValues>({
    initialValues: EMPTY_FORM,
    validate: validateSiteForm,
    sanitise: true,
    onSubmit: async (values) => {
      try {
        const apiPayload = buildApiPayload(values);
        const localId = isEditing && id ? id : uuid();
        let savedSite: Site | null = null;

        // Try API save first
        try {
          if (isEditing && id) {
            const response = await secureFetch<{ success: boolean; data: Site }>(
              `/api/v1/sites/${id}`,
              { method: 'PUT', body: apiPayload },
            );
            savedSite = response.data;
          } else {
            const response = await secureFetch<{ success: boolean; data: Site }>(
              '/api/v1/sites',
              { method: 'POST', body: apiPayload },
            );
            savedSite = response.data;
          }
        } catch (apiErr) {
          // API failed — fall back to local-only save
          console.warn('[SiteForm] API save failed, saving locally:', apiErr);
        }

        // Cache locally — use server response if available, otherwise build local data
        const siteToCache = savedSite ?? buildLocalSiteData(values, localId);
        await sitesCache.put(siteToCache);

        if (!isEditing) {
          SiteEvents.created();
        }

        setSaveSuccess(true);

        setTimeout(() => {
          void navigate(`/sites/${siteToCache.id}`);
        }, 500);
      } catch (err) {
        captureError(err, {
          module: 'SiteForm',
          operation: isEditing ? 'updateSite' : 'createSite',
        });
        throw err;
      }
    },
  });

  // Auto-lookup coordinates when postcode changes
  const handlePostcodeBlur = useCallback(async (e: React.FocusEvent<HTMLInputElement>) => {
    form.handleBlur('postcode')();

    const postcode = e.target.value.trim();
    if (!postcode || !isValidUKPostcode(postcode)) return;

    // Don't re-lookup the same postcode
    const cleaned = postcode.replace(/\s+/g, '').toUpperCase();
    if (cleaned === lastLookedUp.current) return;

    setPostcodeLookup('looking');
    const result = await lookupPostcode(postcode);

    if (result) {
      lastLookedUp.current = cleaned;
      form.setValues({
        ...form.values,
        postcode: form.values.postcode,
        latitude: String(result.latitude),
        longitude: String(result.longitude),
      });
      setPostcodeLookup('found');
      setTimeout(() => setPostcodeLookup('idle'), 2000);
    } else {
      setPostcodeLookup('not-found');
      setTimeout(() => setPostcodeLookup('idle'), 3000);
    }
  }, [form.handleBlur, form.values, form.setValues]);

  // Load existing site for editing
  useEffect(() => {
    if (!isEditing || !id) return;

    async function loadSite(): Promise<void> {
      try {
        const cached = await sitesCache.get(id as string);
        if (!cached) {
          setLoadError('Site not found.');
          return;
        }

        const site = cached.data;
        const loadedPostcode = site.postcode ?? '';
        lastLookedUp.current = loadedPostcode.replace(/\s+/g, '').toUpperCase();

        form.setValues({
          name: site.name,
          site_code: site.site_code ?? '',
          address: site.address,
          postcode: loadedPostcode,
          latitude: site.latitude ? String(site.latitude) : '',
          longitude: site.longitude ? String(site.longitude) : '',
          site_type: site.site_type,
          contact_name: site.contact_name ?? '',
          contact_phone: site.contact_phone ?? '',
          contact_email: site.contact_email ?? '',
          access_notes: site.access_notes ?? '',
          parking_notes: site.parking_notes ?? '',
          install_date: site.install_date ?? '',
          inspection_frequency_routine_days: String(site.inspection_frequency_routine_days),
          inspection_frequency_operational_days: String(site.inspection_frequency_operational_days),
          inspection_frequency_annual_days: String(site.inspection_frequency_annual_days),
          notes: site.notes ?? '',
        });
      } catch (err) {
        setLoadError('Failed to load site data.');
        captureError(err, { module: 'SiteForm', operation: 'loadSite' });
      }
    }

    void loadSite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEditing]);

  if (loadError) {
    return (
      <div className="iv-panel p-8 text-center">
        <AlertCircle className="w-8 h-8 text-risk-high mx-auto mb-3" />
        <p className="text-sm font-medium text-risk-high">{loadError}</p>
        <button type="button" className="iv-btn-secondary mt-4" onClick={() => void navigate('/sites')}>
          Back to Sites
        </button>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{isEditing ? 'Edit Site' : 'Add Site'} — InspectVoice</title>
      </Helmet>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          className="iv-btn-icon"
          onClick={() => void navigate('/sites')}
          aria-label="Back to sites"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-iv-text">
            {isEditing ? 'Edit Site' : 'Add New Site'}
          </h1>
          <p className="text-sm text-iv-muted mt-0.5">
            {isEditing ? 'Update site details' : 'Register a new inspection site'}
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => void form.handleSubmit(e)}
        noValidate
        className="space-y-6 max-w-2xl"
      >
        {/* Site Details */}
        <div className="iv-panel p-5">
          <div className="text-sm font-semibold text-iv-text mb-4 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-iv-accent" />
            Site Details
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="iv-label">Site Name *</label>
              <input
                id="name"
                type="text"
                className={`iv-input ${form.hasError('name') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                value={form.values.name}
                onChange={form.handleChange('name')}
                onBlur={form.handleBlur('name')}
                placeholder="e.g. Park Road Playground"
                maxLength={200}
                autoComplete="off"
              />
              {form.fieldError('name') && (
                <p className="text-sm text-risk-high mt-1">{form.fieldError('name')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="site_type" className="iv-label">Site Type *</label>
                <select
                  id="site_type"
                  className="iv-select"
                  value={form.values.site_type}
                  onChange={form.handleChange('site_type')}
                >
                  {Object.values(SiteType).map((type) => (
                    <option key={type} value={type}>{SITE_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="site_code" className="iv-label">Site Code</label>
                <input
                  id="site_code"
                  type="text"
                  className="iv-input"
                  value={form.values.site_code}
                  onChange={form.handleChange('site_code')}
                  placeholder="Council internal code"
                  maxLength={50}
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <label htmlFor="address" className="iv-label">Address *</label>
              <textarea
                id="address"
                className={`iv-input min-h-[80px] resize-y ${form.hasError('address') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                value={form.values.address}
                onChange={form.handleChange('address')}
                onBlur={form.handleBlur('address')}
                placeholder="Full site address"
                maxLength={500}
              />
              {form.fieldError('address') && (
                <p className="text-sm text-risk-high mt-1">{form.fieldError('address')}</p>
              )}
            </div>

            <div>
              <label htmlFor="postcode" className="iv-label">Postcode</label>
              <div className="flex items-center gap-3">
                <input
                  id="postcode"
                  type="text"
                  className={`iv-input uppercase max-w-[200px] ${form.hasError('postcode') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                  value={form.values.postcode}
                  onChange={form.handleChange('postcode')}
                  onBlur={(e) => void handlePostcodeBlur(e)}
                  placeholder="SW1A 1AA"
                  maxLength={10}
                  autoComplete="postal-code"
                />
                {postcodeLookup === 'looking' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-iv-muted">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Looking up coordinates…
                  </span>
                )}
                {postcodeLookup === 'found' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Coordinates set
                  </span>
                )}
                {postcodeLookup === 'not-found' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-risk-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Postcode not found
                  </span>
                )}
                {postcodeLookup === 'error' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-risk-high">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Lookup failed — coordinates can be added manually
                  </span>
                )}
              </div>
              {form.fieldError('postcode') && (
                <p className="text-sm text-risk-high mt-1">{form.fieldError('postcode')}</p>
              )}
              {form.values.latitude && form.values.longitude && (
                <p className="text-2xs text-iv-muted-2 mt-1.5">
                  📍 {form.values.latitude}, {form.values.longitude}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="iv-panel p-5">
          <div className="text-sm font-semibold text-iv-text mb-4">Site Contact</div>

          <div className="space-y-4">
            <div>
              <label htmlFor="contact_name" className="iv-label">Contact Name</label>
              <input
                id="contact_name"
                type="text"
                className="iv-input"
                value={form.values.contact_name}
                onChange={form.handleChange('contact_name')}
                placeholder="Site manager or keyholder"
                maxLength={200}
                autoComplete="name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact_phone" className="iv-label">Phone</label>
                <input
                  id="contact_phone"
                  type="tel"
                  className={`iv-input ${form.hasError('contact_phone') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                  value={form.values.contact_phone}
                  onChange={form.handleChange('contact_phone')}
                  onBlur={form.handleBlur('contact_phone')}
                  placeholder="07xxx xxxxxx"
                  autoComplete="tel"
                />
                {form.fieldError('contact_phone') && (
                  <p className="text-sm text-risk-high mt-1">{form.fieldError('contact_phone')}</p>
                )}
              </div>

              <div>
                <label htmlFor="contact_email" className="iv-label">Email</label>
                <input
                  id="contact_email"
                  type="email"
                  className={`iv-input ${form.hasError('contact_email') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                  value={form.values.contact_email}
                  onChange={form.handleChange('contact_email')}
                  onBlur={form.handleBlur('contact_email')}
                  placeholder="contact@council.gov.uk"
                  autoComplete="email"
                />
                {form.fieldError('contact_email') && (
                  <p className="text-sm text-risk-high mt-1">{form.fieldError('contact_email')}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Access & Notes */}
        <div className="iv-panel p-5">
          <div className="text-sm font-semibold text-iv-text mb-4">Access & Notes</div>

          <div className="space-y-4">
            <div>
              <label htmlFor="access_notes" className="iv-label">Access Notes</label>
              <textarea
                id="access_notes"
                className="iv-input min-h-[60px] resize-y"
                value={form.values.access_notes}
                onChange={form.handleChange('access_notes')}
                placeholder="Gate codes, key locations, access restrictions..."
                maxLength={1000}
              />
            </div>

            <div>
              <label htmlFor="parking_notes" className="iv-label">Parking Notes</label>
              <input
                id="parking_notes"
                type="text"
                className="iv-input"
                value={form.values.parking_notes}
                onChange={form.handleChange('parking_notes')}
                placeholder="Nearest parking location"
                maxLength={500}
              />
            </div>

            <div>
              <label htmlFor="install_date" className="iv-label">Installation Date</label>
              <input
                id="install_date"
                type="date"
                className="iv-input"
                value={form.values.install_date}
                onChange={form.handleChange('install_date')}
              />
            </div>

            <div>
              <label htmlFor="notes" className="iv-label">Additional Notes</label>
              <textarea
                id="notes"
                className="iv-input min-h-[80px] resize-y"
                value={form.values.notes}
                onChange={form.handleChange('notes')}
                placeholder="Any other relevant information about this site..."
                maxLength={2000}
              />
            </div>
          </div>
        </div>

        {/* Inspection Frequency */}
        <div className="iv-panel p-5">
          <div className="text-sm font-semibold text-iv-text mb-4">
            Inspection Frequency (BS EN 1176-7)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="freq_routine" className="iv-label">Routine Visual (days)</label>
              <input
                id="freq_routine"
                type="number"
                inputMode="numeric"
                min="1"
                max="365"
                className={`iv-input ${form.hasError('inspection_frequency_routine_days') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                value={form.values.inspection_frequency_routine_days}
                onChange={form.handleChange('inspection_frequency_routine_days')}
                onBlur={form.handleBlur('inspection_frequency_routine_days')}
              />
              {form.fieldError('inspection_frequency_routine_days') && (
                <p className="text-sm text-risk-high mt-1">
                  {form.fieldError('inspection_frequency_routine_days')}
                </p>
              )}
              <p className="text-2xs text-iv-muted-2 mt-1">Default: 7 (weekly)</p>
            </div>

            <div>
              <label htmlFor="freq_operational" className="iv-label">Operational (days)</label>
              <input
                id="freq_operational"
                type="number"
                inputMode="numeric"
                min="1"
                max="365"
                className={`iv-input ${form.hasError('inspection_frequency_operational_days') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                value={form.values.inspection_frequency_operational_days}
                onChange={form.handleChange('inspection_frequency_operational_days')}
                onBlur={form.handleBlur('inspection_frequency_operational_days')}
              />
              {form.fieldError('inspection_frequency_operational_days') && (
                <p className="text-sm text-risk-high mt-1">
                  {form.fieldError('inspection_frequency_operational_days')}
                </p>
              )}
              <p className="text-2xs text-iv-muted-2 mt-1">Default: 90 (quarterly)</p>
            </div>

            <div>
              <label htmlFor="freq_annual" className="iv-label">Annual Main (days)</label>
              <input
                id="freq_annual"
                type="number"
                inputMode="numeric"
                min="1"
                max="730"
                className={`iv-input ${form.hasError('inspection_frequency_annual_days') ? 'border-risk-high focus:border-risk-high focus:ring-risk-high/30' : ''}`}
                value={form.values.inspection_frequency_annual_days}
                onChange={form.handleChange('inspection_frequency_annual_days')}
                onBlur={form.handleBlur('inspection_frequency_annual_days')}
              />
              {form.fieldError('inspection_frequency_annual_days') && (
                <p className="text-sm text-risk-high mt-1">
                  {form.fieldError('inspection_frequency_annual_days')}
                </p>
              )}
              <p className="text-2xs text-iv-muted-2 mt-1">Default: 365 (yearly)</p>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="iv-btn-primary"
            disabled={form.submitting}
          >
            {form.submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saveSuccess ? 'Saved' : isEditing ? 'Update Site' : 'Create Site'}
          </button>

          <button
            type="button"
            className="iv-btn-secondary"
            onClick={() => void navigate('/sites')}
            disabled={form.submitting}
          >
            Cancel
          </button>

          {form.submitted && form.errors.length > 0 && (
            <p className="text-sm text-risk-high flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              Please fix {form.errors.length} error{form.errors.length !== 1 ? 's' : ''} above
            </p>
          )}
        </div>
      </form>
    </>
  );
}
