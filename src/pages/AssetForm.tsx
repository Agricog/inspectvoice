/**
 * InspectVoice — Asset Form (Create / Edit)
 * Batch 10, File 1
 *
 * Routes:
 *   /sites/:siteId/assets/new          → Create new asset
 *   /sites/:siteId/assets/:assetId/edit → Edit existing asset
 *
 * Features:
 *   - Category → Asset Type cascading selection
 *   - Auto-populates compliance standard from assetTypes config
 *   - Conditionally shows playground-specific fields (surface, fall height)
 *   - Full validation via createValidator
 *   - DOMPurify sanitisation via useFormValidation
 *   - Offline-first: saves to IndexedDB assetsCache
 *   - Dark theme (iv-* design tokens)
 *   - Mobile-first responsive
 *   - Accessible: labels, aria attributes, focus management
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertTriangle,
  Info,
  Package,
  Ruler,
  Wrench,
  Calendar,
  Hash,
  Factory,
  PoundSterling,
  Clock,
  FileText,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';

import { useFormValidation } from '@hooks/useFormValidation';
import { assetsCache } from '@services/offlineStore';
import {
  createValidator,
  isValidAssetCode,
  isValidFallHeight,
  isValidCostGBP,
  isInRange,
  ValidationErrorCode,
} from '@utils/validation';
import { captureError } from '@utils/errorTracking';
import {
  AssetCategory,
  ASSET_CATEGORY_LABELS,
  SurfaceType,
  SURFACE_TYPE_LABELS,
} from '@/types';
import {
  ASSET_TYPE_CONFIG,
  getAssetTypeConfig,
  getAssetTypesForCategory,
} from '@config/assetTypes';

import type { Asset } from '@/types';

// =============================================
// FORM VALUE TYPES
// =============================================

interface AssetFormValues {
  asset_code: string;
  asset_category: string;
  asset_type: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  install_date: string;
  purchase_cost_gbp: string;
  expected_lifespan_years: string;
  surface_type: string;
  fall_height_mm: string;
  impact_attenuation_required_mm: string;
  maintenance_notes: string;
  is_active: boolean;
}

const EMPTY_FORM: AssetFormValues = {
  asset_code: '',
  asset_category: '',
  asset_type: '',
  manufacturer: '',
  model: '',
  serial_number: '',
  install_date: '',
  purchase_cost_gbp: '',
  expected_lifespan_years: '',
  surface_type: '',
  fall_height_mm: '',
  impact_attenuation_required_mm: '',
  maintenance_notes: '',
  is_active: true,
};

// =============================================
// HELPERS
// =============================================

/** Categories available for selection */
const CATEGORIES = [
  AssetCategory.PLAYGROUND,
  AssetCategory.OUTDOOR_GYM,
  AssetCategory.FURNITURE,
  AssetCategory.SPORTS,
  AssetCategory.OTHER,
] as const;

/** Get filtered asset types for the selected category */
function getTypesForCategory(category: string): Array<{ key: string; name: string }> {
  if (!category) return [];

  const configs = getAssetTypesForCategory(category as AssetCategory);
  return configs.map((c) => ({ key: c.key, name: c.name }));
}

/** Whether the category shows playground-specific fields (surface, fall height) */
function showsPlaygroundFields(category: string): boolean {
  return category === AssetCategory.PLAYGROUND || category === AssetCategory.OUTDOOR_GYM;
}

/** Generate a suggested asset code: TYPE-001 format */
function suggestAssetCode(assetType: string, existingCodes: string[]): string {
  const config = getAssetTypeConfig(assetType);
  if (!config) return '';

  const prefix = config.name
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .substring(0, 4);

  // Find highest existing number for this prefix
  let maxNum = 0;
  for (const code of existingCodes) {
    const match = code.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    if (match?.[1]) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

/** Convert form values to Asset entity for storage */
function formToAsset(
  values: AssetFormValues,
  siteId: string,
  existingAsset: Asset | null,
): Asset {
  const now = new Date().toISOString();
  const config = getAssetTypeConfig(values.asset_type);

  return {
    id: existingAsset?.id ?? uuid(),
    site_id: siteId,
    asset_code: values.asset_code.trim(),
    asset_type: values.asset_type,
    asset_category: values.asset_category as AssetCategory,
    manufacturer: values.manufacturer.trim() || null,
    model: values.model.trim() || null,
    serial_number: values.serial_number.trim() || null,
    install_date: values.install_date || null,
    purchase_cost_gbp: values.purchase_cost_gbp ? parseFloat(values.purchase_cost_gbp) : null,
    compliance_standard: config?.complianceStandard ?? null,
    expected_lifespan_years: values.expected_lifespan_years
      ? parseInt(values.expected_lifespan_years, 10)
      : null,
    surface_type: (values.surface_type as SurfaceType) || null,
    fall_height_mm: values.fall_height_mm ? parseInt(values.fall_height_mm, 10) : null,
    impact_attenuation_required_mm: values.impact_attenuation_required_mm
      ? parseInt(values.impact_attenuation_required_mm, 10)
      : null,
    last_maintenance_date: existingAsset?.last_maintenance_date ?? null,
    next_maintenance_due: existingAsset?.next_maintenance_due ?? null,
    maintenance_notes: values.maintenance_notes.trim() || null,
    reference_photo_id: existingAsset?.reference_photo_id ?? null,
    last_inspection_date: existingAsset?.last_inspection_date ?? null,
    last_inspection_condition: existingAsset?.last_inspection_condition ?? null,
    condition_trend: existingAsset?.condition_trend ?? null,
    is_active: values.is_active,
    decommissioned_date: existingAsset?.decommissioned_date ?? null,
    decommission_reason: existingAsset?.decommission_reason ?? null,
    metadata: existingAsset?.metadata ?? {},
    created_at: existingAsset?.created_at ?? now,
    updated_at: now,
  };
}

/** Convert existing Asset to form values for editing */
function assetToForm(asset: Asset): AssetFormValues {
  return {
    asset_code: asset.asset_code,
    asset_category: asset.asset_category,
    asset_type: asset.asset_type,
    manufacturer: asset.manufacturer ?? '',
    model: asset.model ?? '',
    serial_number: asset.serial_number ?? '',
    install_date: asset.install_date ?? '',
    purchase_cost_gbp: asset.purchase_cost_gbp !== null ? String(asset.purchase_cost_gbp) : '',
    expected_lifespan_years:
      asset.expected_lifespan_years !== null ? String(asset.expected_lifespan_years) : '',
    surface_type: asset.surface_type ?? '',
    fall_height_mm: asset.fall_height_mm !== null ? String(asset.fall_height_mm) : '',
    impact_attenuation_required_mm:
      asset.impact_attenuation_required_mm !== null
        ? String(asset.impact_attenuation_required_mm)
        : '',
    maintenance_notes: asset.maintenance_notes ?? '',
    is_active: asset.is_active,
  };
}

// =============================================
// VALIDATION
// =============================================

function validateAssetForm(values: AssetFormValues): ReturnType<typeof createValidator>['validate'] {
  const v = createValidator()
    .required('asset_code', values.asset_code, 'Asset code')
    .required('asset_category', values.asset_category, 'Category')
    .required('asset_type', values.asset_type, 'Asset type');

  // Asset code format
  v.check(
    'asset_code',
    () =>
      values.asset_code && !isValidAssetCode(values.asset_code)
        ? 'Asset code must be alphanumeric (hyphens/spaces allowed), 1-50 characters'
        : null,
    ValidationErrorCode.PATTERN,
  );

  // Asset type must exist in config
  v.check(
    'asset_type',
    () => {
      if (!values.asset_type) return null;
      return !ASSET_TYPE_CONFIG[values.asset_type]
        ? 'Selected asset type is not recognised'
        : null;
    },
    ValidationErrorCode.INVALID_FORMAT,
  );

  // Install date must not be in the future
  v.check(
    'install_date',
    () => {
      if (!values.install_date) return null;
      const installDate = new Date(values.install_date);
      if (isNaN(installDate.getTime())) return 'Invalid date format';
      if (installDate > new Date()) return 'Install date cannot be in the future';
      return null;
    },
    ValidationErrorCode.RANGE,
  );

  // Purchase cost
  v.check(
    'purchase_cost_gbp',
    () => {
      if (!values.purchase_cost_gbp) return null;
      const cost = parseFloat(values.purchase_cost_gbp);
      if (isNaN(cost)) return 'Purchase cost must be a number';
      if (!isValidCostGBP(cost)) return 'Purchase cost must be between £0 and £1,000,000';
      return null;
    },
    ValidationErrorCode.RANGE,
  );

  // Expected lifespan
  v.check(
    'expected_lifespan_years',
    () => {
      if (!values.expected_lifespan_years) return null;
      const years = parseInt(values.expected_lifespan_years, 10);
      if (isNaN(years)) return 'Lifespan must be a whole number';
      if (!isInRange(years, 1, 100)) return 'Lifespan must be between 1 and 100 years';
      return null;
    },
    ValidationErrorCode.RANGE,
  );

  // Fall height (only relevant for playground/gym)
  v.check(
    'fall_height_mm',
    () => {
      if (!values.fall_height_mm) return null;
      const height = parseInt(values.fall_height_mm, 10);
      if (isNaN(height)) return 'Fall height must be a whole number';
      if (!isValidFallHeight(height)) return 'Fall height must be between 0 and 10,000mm';
      return null;
    },
    ValidationErrorCode.RANGE,
  );

  // Impact attenuation
  v.check(
    'impact_attenuation_required_mm',
    () => {
      if (!values.impact_attenuation_required_mm) return null;
      const depth = parseInt(values.impact_attenuation_required_mm, 10);
      if (isNaN(depth)) return 'Impact attenuation must be a whole number';
      if (!isInRange(depth, 0, 5000)) return 'Impact attenuation must be between 0 and 5,000mm';
      return null;
    },
    ValidationErrorCode.RANGE,
  );

  // Maintenance notes length
  v.length('maintenance_notes', values.maintenance_notes, 0, 2000, 'Maintenance notes');

  return v.validate();
}

// =============================================
// COMPONENT
// =============================================

export default function AssetForm(): JSX.Element {
  const { siteId, assetId } = useParams<{ siteId: string; assetId: string }>();
  const navigate = useNavigate();

  const isEditMode = Boolean(assetId);
  const pageTitle = isEditMode ? 'Edit Asset' : 'Add Asset';

  // ---- State ----
  const [loading, setLoading] = useState(isEditMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [existingAsset, setExistingAsset] = useState<Asset | null>(null);
  const [existingCodes, setExistingCodes] = useState<string[]>([]);
  const [complianceStandard, setComplianceStandard] = useState<string | null>(null);

  const formTopRef = useRef<HTMLDivElement>(null);

  // ---- Load existing asset for edit mode ----
  useEffect(() => {
    if (!isEditMode || !assetId || !siteId) return;

    let cancelled = false;

    async function loadAsset(): Promise<void> {
      try {
        const cached = await assetsCache.get(assetId!);
        if (cancelled) return;

        if (!cached) {
          setLoadError('Asset not found in local storage. It may not have been cached yet.');
          setLoading(false);
          return;
        }

        // Verify asset belongs to this site
        if (cached.site_id !== siteId) {
          setLoadError('Asset does not belong to this site.');
          setLoading(false);
          return;
        }

        setExistingAsset(cached.data);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        captureError(error, { module: 'AssetForm', operation: 'loadAsset', assetId });
        setLoadError('Failed to load asset data. Please try again.');
        setLoading(false);
      }
    }

    void loadAsset();

    return () => {
      cancelled = true;
    };
  }, [isEditMode, assetId, siteId]);

  // ---- Load existing asset codes for suggestion ----
  useEffect(() => {
    if (!siteId) return;

    let cancelled = false;

    async function loadCodes(): Promise<void> {
      try {
        const assets = await assetsCache.getBySite(siteId!);
        if (cancelled) return;
        setExistingCodes(assets.map((a) => a.data.asset_code));
      } catch (error) {
        captureError(error, { module: 'AssetForm', operation: 'loadCodes', siteId });
      }
    }

    void loadCodes();

    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // ---- Form ----
  const form = useFormValidation<AssetFormValues>({
    initialValues: existingAsset ? assetToForm(existingAsset) : EMPTY_FORM,
    validate: validateAssetForm,
    sanitise: true,
    validateOnBlur: true,
    onSubmit: async (values) => {
      if (!siteId) return;

      setSaveError(null);

      try {
        const asset = formToAsset(values, siteId, existingAsset);
        await assetsCache.put(asset);
        navigate(`/sites/${siteId}`, { replace: true });
      } catch (error) {
        captureError(error, {
          module: 'AssetForm',
          operation: 'saveAsset',
          siteId,
          assetId: existingAsset?.id,
        });
        setSaveError('Failed to save asset. Please try again.');
        formTopRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    },
  });

  // ---- Re-initialise form when existing asset loads ----
  useEffect(() => {
    if (existingAsset) {
      form.setValues(assetToForm(existingAsset));
      const config = getAssetTypeConfig(existingAsset.asset_type);
      setComplianceStandard(config?.complianceStandard ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingAsset]);

  // ---- Category change handler ----
  const handleCategoryChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const category = e.target.value;
      form.setValue('asset_category', category);
      // Reset type when category changes
      form.setValue('asset_type', '');
      setComplianceStandard(null);

      // Clear playground fields if switching away
      if (!showsPlaygroundFields(category)) {
        form.setValue('surface_type', '');
        form.setValue('fall_height_mm', '');
        form.setValue('impact_attenuation_required_mm', '');
      }
    },
    [form],
  );

  // ---- Type change handler ----
  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const assetType = e.target.value;
      form.setValue('asset_type', assetType);

      const config = getAssetTypeConfig(assetType);
      setComplianceStandard(config?.complianceStandard ?? null);

      // Auto-suggest code if empty
      if (!form.values.asset_code && assetType) {
        const suggested = suggestAssetCode(assetType, existingCodes);
        if (suggested) {
          form.setValue('asset_code', suggested);
        }
      }
    },
    [form, existingCodes],
  );

  // ---- Toggle active ----
  const handleToggleActive = useCallback(() => {
    form.setValue('is_active', !form.values.is_active);
  }, [form]);

  // ---- Available types for selected category ----
  const availableTypes = getTypesForCategory(form.values.asset_category);
  const showPlayground = showsPlaygroundFields(form.values.asset_category);

  // ---- Render helpers ----

  /** Standard text input field */
  function renderField(config: {
    field: keyof AssetFormValues;
    label: string;
    type?: string;
    placeholder?: string;
    icon?: React.ReactNode;
    hint?: string;
    required?: boolean;
    min?: string;
    max?: string;
    step?: string;
    inputMode?: 'numeric' | 'decimal' | 'text';
  }): JSX.Element {
    const {
      field,
      label,
      type = 'text',
      placeholder,
      icon,
      hint,
      required = false,
      min,
      max,
      step,
      inputMode,
    } = config;
    const error = form.fieldError(field);
    const fieldId = `asset-${String(field)}`;

    return (
      <div>
        <label htmlFor={fieldId} className="iv-label flex items-center gap-1.5">
          {icon}
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <input
          id={fieldId}
          type={type}
          value={String(form.values[field] ?? '')}
          onChange={form.handleChange(field)}
          onBlur={form.handleBlur(field)}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          inputMode={inputMode}
          className={`iv-input w-full ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          autoComplete="off"
        />
        {hint && !error && (
          <p id={`${fieldId}-hint`} className="mt-1 text-xs iv-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${fieldId}-error`} className="mt-1 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  /** Standard select field */
  function renderSelect(config: {
    field: keyof AssetFormValues;
    label: string;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
    icon?: React.ReactNode;
    required?: boolean;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    disabled?: boolean;
  }): JSX.Element {
    const {
      field,
      label,
      options,
      placeholder = 'Select...',
      icon,
      required = false,
      onChange,
      disabled = false,
    } = config;
    const error = form.fieldError(field);
    const fieldId = `asset-${String(field)}`;

    return (
      <div>
        <label htmlFor={fieldId} className="iv-label flex items-center gap-1.5">
          {icon}
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <select
          id={fieldId}
          value={String(form.values[field] ?? '')}
          onChange={onChange ?? form.handleChange(field)}
          onBlur={form.handleBlur(field)}
          className={`iv-select w-full ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          disabled={disabled}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${fieldId}-error`} className="mt-1 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet>
          <title>Loading Asset... | InspectVoice</title>
        </Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 iv-muted animate-spin" />
          <p className="iv-muted text-sm">Loading asset data...</p>
        </div>
      </div>
    );
  }

  // ---- Load error state ----
  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Helmet>
          <title>Error | InspectVoice</title>
        </Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">Failed to Load Asset</h2>
          <p className="iv-muted text-sm mb-4">{loadError}</p>
          <Link
            to={`/sites/${siteId ?? ''}`}
            className="iv-btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Site
          </Link>
        </div>
      </div>
    );
  }

  // ---- No siteId guard ----
  if (!siteId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Helmet>
          <title>Error | InspectVoice</title>
        </Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">Missing Site</h2>
          <p className="iv-muted text-sm mb-4">No site ID found. Please navigate from a site page.</p>
          <Link to="/sites" className="iv-btn-secondary inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            All Sites
          </Link>
        </div>
      </div>
    );
  }

  // ---- Main form ----
  return (
    <div className="max-w-2xl mx-auto px-4 py-6" ref={formTopRef}>
      <Helmet>
        <title>{pageTitle} | InspectVoice</title>
        <meta name="description" content={`${pageTitle} in the site asset register.`} />
      </Helmet>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/sites/${siteId}`}
          className="iv-btn-icon"
          aria-label="Back to site"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold iv-text">{pageTitle}</h1>
          <p className="text-sm iv-muted">
            {isEditMode ? 'Update asset details in the register' : 'Add equipment to the site asset register'}
          </p>
        </div>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div
          className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2"
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{saveError}</p>
        </div>
      )}

      <form onSubmit={form.handleSubmit} noValidate>
        {/* ── Section 1: Identification ── */}
        <div className="iv-panel p-5 mb-4">
          <h2 className="text-base font-semibold iv-text mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-[#22C55E]" />
            Identification
          </h2>

          <div className="space-y-4">
            {/* Category */}
            {renderSelect({
              field: 'asset_category',
              label: 'Category',
              required: true,
              icon: <Package className="w-3.5 h-3.5 iv-muted" />,
              placeholder: 'Select category...',
              onChange: handleCategoryChange,
              options: CATEGORIES.map((cat) => ({
                value: cat,
                label: ASSET_CATEGORY_LABELS[cat],
              })),
            })}

            {/* Asset Type */}
            {renderSelect({
              field: 'asset_type',
              label: 'Asset Type',
              required: true,
              icon: <Wrench className="w-3.5 h-3.5 iv-muted" />,
              placeholder: form.values.asset_category
                ? 'Select type...'
                : 'Select a category first',
              onChange: handleTypeChange,
              disabled: !form.values.asset_category,
              options: availableTypes.map((t) => ({
                value: t.key,
                label: t.name,
              })),
            })}

            {/* Asset Code */}
            {renderField({
              field: 'asset_code',
              label: 'Asset Code',
              required: true,
              icon: <Hash className="w-3.5 h-3.5 iv-muted" />,
              placeholder: 'e.g. SWING-001',
              hint: 'Unique identifier for this asset. Auto-suggested when you select a type.',
            })}

            {/* Compliance Standard (read-only info) */}
            {complianceStandard && (
              <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/20">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-[#22C55E] mb-0.5">
                      Compliance Standard
                    </p>
                    <p className="text-xs iv-text">{complianceStandard}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Section 2: Manufacturer Details ── */}
        <div className="iv-panel p-5 mb-4">
          <h2 className="text-base font-semibold iv-text mb-4 flex items-center gap-2">
            <Factory className="w-4 h-4 text-[#22C55E]" />
            Manufacturer Details
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {renderField({
                field: 'manufacturer',
                label: 'Manufacturer',
                icon: <Factory className="w-3.5 h-3.5 iv-muted" />,
                placeholder: 'e.g. Wicksteed, Kompan',
              })}

              {renderField({
                field: 'model',
                label: 'Model',
                placeholder: 'e.g. Galaxy Series',
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {renderField({
                field: 'serial_number',
                label: 'Serial Number',
                icon: <Hash className="w-3.5 h-3.5 iv-muted" />,
                placeholder: 'Manufacturer serial number',
              })}

              {renderField({
                field: 'install_date',
                label: 'Install Date',
                type: 'date',
                icon: <Calendar className="w-3.5 h-3.5 iv-muted" />,
                max: new Date().toISOString().split('T')[0],
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {renderField({
                field: 'purchase_cost_gbp',
                label: 'Purchase Cost (£)',
                type: 'number',
                icon: <PoundSterling className="w-3.5 h-3.5 iv-muted" />,
                placeholder: '0.00',
                min: '0',
                max: '1000000',
                step: '0.01',
                inputMode: 'decimal',
              })}

              {renderField({
                field: 'expected_lifespan_years',
                label: 'Expected Lifespan (years)',
                type: 'number',
                icon: <Clock className="w-3.5 h-3.5 iv-muted" />,
                placeholder: 'e.g. 15',
                min: '1',
                max: '100',
                step: '1',
                inputMode: 'numeric',
              })}
            </div>
          </div>
        </div>

        {/* ── Section 3: Playground / Safety Fields (conditional) ── */}
        {showPlayground && (
          <div className="iv-panel p-5 mb-4">
            <h2 className="text-base font-semibold iv-text mb-4 flex items-center gap-2">
              <Ruler className="w-4 h-4 text-[#22C55E]" />
              Safety Measurements
            </h2>

            <div className="space-y-4">
              {renderSelect({
                field: 'surface_type',
                label: 'Impact Surface Type',
                icon: <Ruler className="w-3.5 h-3.5 iv-muted" />,
                placeholder: 'Select surface...',
                options: Object.values(SurfaceType).map((st) => ({
                  value: st,
                  label: SURFACE_TYPE_LABELS[st],
                })),
              })}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {renderField({
                  field: 'fall_height_mm',
                  label: 'Critical Fall Height (mm)',
                  type: 'number',
                  icon: <Ruler className="w-3.5 h-3.5 iv-muted" />,
                  placeholder: 'e.g. 2400',
                  hint: 'Maximum free fall height per BS EN 1176-1. 0-10,000mm.',
                  min: '0',
                  max: '10000',
                  step: '1',
                  inputMode: 'numeric',
                })}

                {renderField({
                  field: 'impact_attenuation_required_mm',
                  label: 'Required Surfacing Depth (mm)',
                  type: 'number',
                  placeholder: 'e.g. 200',
                  hint: 'Minimum impact-absorbing surface depth per BS EN 1177.',
                  min: '0',
                  max: '5000',
                  step: '1',
                  inputMode: 'numeric',
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Section 4: Maintenance Notes ── */}
        <div className="iv-panel p-5 mb-4">
          <h2 className="text-base font-semibold iv-text mb-4 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#22C55E]" />
            Notes
          </h2>

          <div>
            <label htmlFor="asset-maintenance_notes" className="iv-label flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 iv-muted" />
              Maintenance Notes
            </label>
            <textarea
              id="asset-maintenance_notes"
              value={form.values.maintenance_notes}
              onChange={form.handleChange('maintenance_notes')}
              onBlur={form.handleBlur('maintenance_notes')}
              placeholder="Any known issues, previous repairs, special maintenance requirements..."
              rows={4}
              maxLength={2000}
              className={`iv-input w-full resize-y ${form.fieldError('maintenance_notes') ? 'border-red-500 focus:ring-red-500' : ''}`}
              aria-invalid={Boolean(form.fieldError('maintenance_notes'))}
              aria-describedby={
                form.fieldError('maintenance_notes')
                  ? 'maintenance-notes-error'
                  : 'maintenance-notes-hint'
              }
            />
            <div className="flex justify-between mt-1">
              {form.fieldError('maintenance_notes') ? (
                <p id="maintenance-notes-error" className="text-xs text-red-400" role="alert">
                  {form.fieldError('maintenance_notes')}
                </p>
              ) : (
                <p id="maintenance-notes-hint" className="text-xs iv-muted">
                  Optional. Record any relevant maintenance history.
                </p>
              )}
              <p className="text-xs iv-muted">
                {form.values.maintenance_notes.length}/2000
              </p>
            </div>
          </div>
        </div>

        {/* ── Section 5: Status ── */}
        <div className="iv-panel p-5 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold iv-text flex items-center gap-2">
                {form.values.is_active ? (
                  <ToggleRight className="w-4 h-4 text-[#22C55E]" />
                ) : (
                  <ToggleLeft className="w-4 h-4 iv-muted" />
                )}
                Asset Status
              </h2>
              <p className="text-xs iv-muted mt-0.5">
                {form.values.is_active
                  ? 'Asset is active and will appear in inspections'
                  : 'Asset is inactive and excluded from inspections'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleActive}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0C0F14] ${
                form.values.is_active
                  ? 'bg-[#22C55E] focus:ring-[#22C55E]'
                  : 'bg-[#2A2F3A] focus:ring-[#2A2F3A]'
              }`}
              role="switch"
              aria-checked={form.values.is_active}
              aria-label="Asset active status"
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  form.values.is_active ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={form.submitting}
            className="iv-btn-primary flex items-center gap-2 flex-1 justify-center"
          >
            {form.submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isEditMode ? 'Update Asset' : 'Add Asset'}
              </>
            )}
          </button>

          <Link
            to={`/sites/${siteId}`}
            className="iv-btn-secondary flex items-center gap-2 justify-center"
          >
            Cancel
          </Link>
        </div>

        {/* Unsaved changes warning */}
        {form.dirty && !form.submitting && (
          <p className="text-xs iv-muted text-center mt-3">
            You have unsaved changes
          </p>
        )}
      </form>
    </div>
  );
}
