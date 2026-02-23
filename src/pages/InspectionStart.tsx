/**
 * InspectVoice — Inspection Start Flow
 * Batch 11
 *
 * Route: /sites/:siteId/inspect/new
 *
 * Workflow:
 *   1. Pre-loads site info and asset register from IndexedDB cache
 *   2. Inspector selects inspection type (Routine Visual / Operational / Annual Main)
 *   3. Records weather and surface conditions
 *   4. Reviews and confirms asset register (can add new assets on-site)
 *   5. Creates draft inspection in IndexedDB
 *   6. Navigates to InspectionCapture page
 *
 * Features:
 *   - Offline-first: all data from IndexedDB, no network required
 *   - Inspection type selector with BS EN 1176-7 descriptions
 *   - Weather/surface condition quick-select buttons
 *   - Temperature input with UK range validation
 *   - Asset register preview with active/inactive counts
 *   - Empty register guard — cannot start without assets
 *   - Creates full Inspection entity with correct defaults
 *   - Dark theme (iv-* design tokens), mobile-first
 *   - Accessible: labels, aria, focus management
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Cloud,
  Thermometer,
  Layers,
  ClipboardList,
  CheckCircle2,
  Package,
  Plus,
  Info,
  Eye,
  Wrench,
  Search,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';

import { sitesCache, assetsCache, inspections } from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import {
  InspectionType,
  INSPECTION_TYPE_LABELS,
  INSPECTION_TYPE_DESCRIPTIONS,
  InspectionStatus,
  WeatherCondition,
  SurfaceCondition,
} from '@/types';
import type { Site, Asset, Inspection } from '@/types';
import { getAssetTypeConfig } from '@config/assetTypes';

// =============================================
// CONSTANTS
// =============================================

/** Inspection types available for selection (excludes post-repair and ad-hoc for now) */
const SELECTABLE_TYPES = [
  InspectionType.ROUTINE_VISUAL,
  InspectionType.OPERATIONAL,
  InspectionType.ANNUAL_MAIN,
] as const;

/** Weather condition options */
const WEATHER_OPTIONS: Array<{ value: WeatherCondition; label: string; icon: string }> = [
  { value: WeatherCondition.DRY, label: 'Dry', icon: '☀️' },
  { value: WeatherCondition.WET, label: 'Wet', icon: '🌧️' },
  { value: WeatherCondition.WINDY, label: 'Windy', icon: '💨' },
  { value: WeatherCondition.ICY, label: 'Icy', icon: '🧊' },
  { value: WeatherCondition.SNOW, label: 'Snow', icon: '❄️' },
];

/** Surface condition options */
const SURFACE_OPTIONS: Array<{ value: SurfaceCondition; label: string }> = [
  { value: SurfaceCondition.DRY, label: 'Dry' },
  { value: SurfaceCondition.WET, label: 'Wet' },
  { value: SurfaceCondition.ICY, label: 'Icy' },
  { value: SurfaceCondition.WATERLOGGED, label: 'Waterlogged' },
];

/** Estimated durations per type */
const ESTIMATED_DURATIONS: Record<string, string> = {
  [InspectionType.ROUTINE_VISUAL]: '~15 min',
  [InspectionType.OPERATIONAL]: '~1 hour',
  [InspectionType.ANNUAL_MAIN]: '~3 hours',
};

/** Inspection type icons */
function typeIcon(type: InspectionType): JSX.Element {
  switch (type) {
    case InspectionType.ROUTINE_VISUAL:
      return <Eye className="w-5 h-5" />;
    case InspectionType.OPERATIONAL:
      return <Wrench className="w-5 h-5" />;
    case InspectionType.ANNUAL_MAIN:
      return <Search className="w-5 h-5" />;
    default:
      return <ClipboardList className="w-5 h-5" />;
  }
}

// =============================================
// COMPONENT
// =============================================

export default function InspectionStart(): JSX.Element {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();

  // ---- Loading state ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- Data ----
  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);

  // ---- Form state ----
  const [selectedType, setSelectedType] = useState<InspectionType | null>(null);
  const [weather, setWeather] = useState<WeatherCondition | null>(null);
  const [surfaceCondition, setSurfaceCondition] = useState<SurfaceCondition | null>(null);
  const [temperature, setTemperature] = useState<string>('');
  const [assetsConfirmed, setAssetsConfirmed] = useState(false);

  // ---- Submit state ----
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ---- Load site + assets ----
  useEffect(() => {
    if (!siteId) return;

    let cancelled = false;

    async function loadData(): Promise<void> {
      try {
        const [cachedSite, cachedAssets] = await Promise.all([
          sitesCache.get(siteId!),
          assetsCache.getBySite(siteId!),
        ]);

        if (cancelled) return;

        if (!cachedSite) {
          setLoadError('Site not found in local storage. Navigate from the site page to cache it.');
          setLoading(false);
          return;
        }

        setSite(cachedSite.data);
        setAssets(cachedAssets.map((ca) => ca.data));
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        captureError(error, { module: 'InspectionStart', operation: 'loadData' });
        setLoadError('Failed to load site data. Please try again.');
        setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // ---- Derived ----
  const activeAssets = assets.filter((a) => a.is_active);
  const inactiveCount = assets.length - activeAssets.length;
  const canStart = selectedType !== null && weather !== null && assetsConfirmed && activeAssets.length > 0;

  // ---- Validate temperature ----
  const temperatureValid =
    temperature === '' ||
    (!isNaN(parseFloat(temperature)) &&
      parseFloat(temperature) >= -30 &&
      parseFloat(temperature) <= 50);

  // ---- Create inspection ----
  const handleStart = useCallback(async () => {
    if (!canStart || !siteId || !site || !selectedType) return;

    setCreating(true);
    setCreateError(null);

    try {
      const now = new Date().toISOString();
      const inspectionId = uuid();

      const inspectionData: Inspection = {
        id: inspectionId,
        org_id: site.org_id,
        site_id: siteId,
        inspector_id: '', // Set by backend from Clerk session on sync
        inspection_type: selectedType,
        inspection_date: now.split('T')[0] ?? now,
        started_at: now,
        completed_at: null,
        duration_minutes: null,
        weather_conditions: weather,
        temperature_c: temperature !== '' ? parseFloat(temperature) : null,
        surface_conditions: surfaceCondition,
        status: InspectionStatus.DRAFT,
        overall_risk_rating: null,
        very_high_risk_count: 0,
        high_risk_count: 0,
        medium_risk_count: 0,
        low_risk_count: 0,
        total_defects: 0,
        closure_recommended: false,
        closure_reason: null,
        immediate_action_required: false,
        signed_by: null,
        signed_at: null,
        signature_ip_address: null,
        pdf_url: null,
        pdf_generated_at: null,
        inspector_summary: null,
        notes: null,
        metadata: {
          active_asset_count: activeAssets.length,
          started_from: 'inspection_start_flow',
        },
        created_at: now,
        updated_at: now,
      };

      await inspections.create(inspectionData);

      // Navigate to capture page
      navigate(`/sites/${siteId}/inspections/${inspectionId}/capture`, { replace: true });
    } catch (error) {
      captureError(error, { module: 'InspectionStart', operation: 'createInspection' });
      setCreateError('Failed to create inspection. Please try again.');
      setCreating(false);
    }
  }, [canStart, siteId, site, selectedType, weather, temperature, surfaceCondition, activeAssets.length, navigate]);

  // ---- Loading ----
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet>
          <title>Starting Inspection... | InspectVoice</title>
        </Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 iv-muted animate-spin" />
          <p className="iv-muted text-sm">Loading site data...</p>
        </div>
      </div>
    );
  }

  // ---- Error ----
  if (loadError || !site || !siteId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Helmet>
          <title>Error | InspectVoice</title>
        </Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">Cannot Start Inspection</h2>
          <p className="iv-muted text-sm mb-4">{loadError ?? 'Site data is missing.'}</p>
          <Link
            to={siteId ? `/sites/${siteId}` : '/sites'}
            className="iv-btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {siteId ? 'Back to Site' : 'All Sites'}
          </Link>
        </div>
      </div>
    );
  }

  // ---- Main ----
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>New Inspection — {site.name} | InspectVoice</title>
        <meta name="description" content={`Start a new BS EN 1176 inspection at ${site.name}.`} />
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
          <h1 className="text-xl font-bold iv-text">New Inspection</h1>
          <p className="text-sm iv-muted">{site.name}</p>
        </div>
      </div>

      {/* Error banner */}
      {createError && (
        <div
          className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2"
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{createError}</p>
        </div>
      )}

      {/* ── Step 1: Inspection Type ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-1 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-[#22C55E]" />
          Inspection Type
          <span className="text-red-400 text-sm">*</span>
        </h2>
        <p className="text-xs iv-muted mb-4">Select the inspection cadence per BS EN 1176-7:2020</p>

        <div className="space-y-3">
          {SELECTABLE_TYPES.map((type) => {
            const isSelected = selectedType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(type)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-[#22C55E] bg-[#22C55E]/10'
                    : 'border-[#2A2F3A] bg-[#151920] hover:border-[#3A3F4A]'
                }`}
                aria-pressed={isSelected}
              >
                <div className="flex items-start gap-3">
                  <span className={isSelected ? 'text-[#22C55E]' : 'iv-muted'}>
                    {typeIcon(type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`font-medium ${isSelected ? 'text-[#22C55E]' : 'iv-text'}`}>
                        {INSPECTION_TYPE_LABELS[type]}
                      </p>
                      <span className="text-xs iv-muted ml-2 flex-shrink-0">
                        {ESTIMATED_DURATIONS[type]}
                      </span>
                    </div>
                    <p className="text-xs iv-muted mt-1">
                      {INSPECTION_TYPE_DESCRIPTIONS[type]}
                    </p>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Step 2: Conditions ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-1 flex items-center gap-2">
          <Cloud className="w-4 h-4 text-[#22C55E]" />
          Conditions
          <span className="text-red-400 text-sm">*</span>
        </h2>
        <p className="text-xs iv-muted mb-4">Record current weather and surface conditions</p>

        {/* Weather */}
        <div className="mb-4">
          <label className="iv-label mb-2 block">Weather</label>
          <div className="flex flex-wrap gap-2">
            {WEATHER_OPTIONS.map((opt) => {
              const isSelected = weather === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWeather(opt.value)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-all ${
                    isSelected
                      ? 'border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E]'
                      : 'border-[#2A2F3A] bg-[#151920] iv-text hover:border-[#3A3F4A]'
                  }`}
                  aria-pressed={isSelected}
                >
                  <span>{opt.icon}</span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Surface */}
        <div className="mb-4">
          <label className="iv-label mb-2 block">Surface Condition</label>
          <div className="flex flex-wrap gap-2">
            {SURFACE_OPTIONS.map((opt) => {
              const isSelected = surfaceCondition === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSurfaceCondition(opt.value)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                    isSelected
                      ? 'border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E]'
                      : 'border-[#2A2F3A] bg-[#151920] iv-text hover:border-[#3A3F4A]'
                  }`}
                  aria-pressed={isSelected}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Temperature */}
        <div>
          <label htmlFor="inspection-temp" className="iv-label flex items-center gap-1.5 mb-1">
            <Thermometer className="w-3.5 h-3.5 iv-muted" />
            Temperature (°C)
          </label>
          <input
            id="inspection-temp"
            type="number"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder="e.g. 12"
            min="-30"
            max="50"
            step="1"
            inputMode="numeric"
            className={`iv-input w-32 ${!temperatureValid ? 'border-red-500' : ''}`}
            aria-invalid={!temperatureValid}
            aria-describedby="temp-hint"
            autoComplete="off"
          />
          {!temperatureValid ? (
            <p className="mt-1 text-xs text-red-400" role="alert">
              Temperature must be between -30°C and 50°C
            </p>
          ) : (
            <p id="temp-hint" className="mt-1 text-xs iv-muted">
              Optional. UK typical range: -10°C to 35°C
            </p>
          )}
        </div>
      </div>

      {/* ── Step 3: Asset Register ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-1 flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#22C55E]" />
          Asset Register
          <span className="text-red-400 text-sm">*</span>
        </h2>
        <p className="text-xs iv-muted mb-4">
          Confirm the equipment to be inspected. {activeAssets.length} active asset{activeAssets.length !== 1 ? 's' : ''} on register.
        </p>

        {/* Empty register warning */}
        {activeAssets.length === 0 && (
          <div className="p-4 rounded-lg bg-[#EAB308]/10 border border-[#EAB308]/30 mb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-[#EAB308] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#EAB308]">No Active Assets</p>
                <p className="text-xs iv-muted mt-1">
                  You need at least one active asset in the register before starting an inspection.
                </p>
                <Link
                  to={`/sites/${siteId}/assets/new`}
                  className="inline-flex items-center gap-1.5 mt-2 text-xs text-[#22C55E] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add an asset
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Asset list preview */}
        {activeAssets.length > 0 && (
          <>
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {activeAssets.map((asset) => {
                const config = getAssetTypeConfig(asset.asset_type);
                return (
                  <div
                    key={asset.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[#1C2029] border border-[#2A2F3A]"
                  >
                    <Package className="w-4 h-4 iv-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm iv-text font-medium truncate">{asset.asset_code}</p>
                      <p className="text-xs iv-muted truncate">
                        {config?.name ?? asset.asset_type}
                      </p>
                    </div>
                    {asset.last_inspection_condition && (
                      <span className={`text-xs font-medium ${
                        asset.last_inspection_condition === 'good' ? 'text-[#22C55E]' :
                        asset.last_inspection_condition === 'fair' ? 'text-[#EAB308]' :
                        asset.last_inspection_condition === 'poor' ? 'text-[#F97316]' :
                        'text-[#EF4444]'
                      }`}>
                        {asset.last_inspection_condition}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {inactiveCount > 0 && (
              <p className="text-xs iv-muted mb-3">
                {inactiveCount} inactive asset{inactiveCount !== 1 ? 's' : ''} excluded from inspection
              </p>
            )}

            {/* Add asset link */}
            <Link
              to={`/sites/${siteId}/assets/new`}
              className="inline-flex items-center gap-1.5 text-xs text-[#22C55E] hover:underline mb-4"
            >
              <Plus className="w-3.5 h-3.5" />
              Add new asset to register
            </Link>

            {/* Confirm checkbox */}
            <div className="border-t border-[#2A2F3A] pt-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assetsConfirmed}
                  onChange={(e) => setAssetsConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#2A2F3A] bg-[#151920] text-[#22C55E] focus:ring-[#22C55E] focus:ring-offset-0"
                />
                <div>
                  <p className="text-sm iv-text">
                    I confirm the asset register is correct for this inspection
                  </p>
                  <p className="text-xs iv-muted mt-0.5">
                    {activeAssets.length} asset{activeAssets.length !== 1 ? 's' : ''} will be inspected
                  </p>
                </div>
              </label>
            </div>
          </>
        )}
      </div>

      {/* ── Summary ── */}
      {selectedType && weather && (
        <div className="iv-panel p-4 mb-4 border-l-4 border-l-[#22C55E]">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="iv-text font-medium">
                {INSPECTION_TYPE_LABELS[selectedType]} inspection at {site.name}
              </p>
              <p className="iv-muted text-xs mt-1">
                {WEATHER_OPTIONS.find((w) => w.value === weather)?.icon}{' '}
                {WEATHER_OPTIONS.find((w) => w.value === weather)?.label}
                {surfaceCondition && ` · Surface: ${SURFACE_OPTIONS.find((s) => s.value === surfaceCondition)?.label}`}
                {temperature && ` · ${temperature}°C`}
                {' · '}{activeAssets.length} asset{activeAssets.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Start Button ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart || creating || !temperatureValid}
          className="iv-btn-primary flex items-center gap-2 flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <ArrowRight className="w-4 h-4" />
              Start Inspection
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

      {/* Readiness hints */}
      {!canStart && !creating && (
        <div className="mt-3 space-y-1">
          {!selectedType && (
            <p className="text-xs text-[#EAB308] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Select an inspection type
            </p>
          )}
          {!weather && (
            <p className="text-xs text-[#EAB308] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Select weather conditions
            </p>
          )}
          {activeAssets.length === 0 && (
            <p className="text-xs text-[#EAB308] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Add at least one asset to the register
            </p>
          )}
          {activeAssets.length > 0 && !assetsConfirmed && (
            <p className="text-xs text-[#EAB308] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Confirm the asset register
            </p>
          )}
        </div>
      )}
    </div>
  );
}
