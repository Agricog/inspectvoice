/**
 * InspectVoice — Make Safe Modal
 * One-tap escalation for high-risk defects found on-site.
 *
 * Flow:
 *   1. Inspector taps "Make Safe" on a defect card/row
 *   2. Modal opens with action type selector, details, photo capture, recommendation
 *   3. On submit: POST /api/v1/defects/:id/make-safe
 *   4. Defect is flagged as made_safe in the DB (via trigger)
 *   5. Toast confirms success
 *
 * Includes:
 *   - MakeSafeButton: trigger button for cards/rows
 *   - MakeSafeModal: full-screen modal with form
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ShieldAlert,
  X,
  Camera,
  Loader2,
  CheckCircle,
  MapPin,
  AlertTriangle,
  Ban,
  ChevronDown,
} from 'lucide-react';
import { secureFetch } from '@hooks/useFetch';

// =============================================
// TYPES
// =============================================

interface MakeSafeButtonProps {
  defectId: string;
  severity: string;
  description: string;
  siteName: string;
  assetCode: string;
  alreadyMadeSafe?: boolean;
  onSuccess?: () => void;
}

type MakeSafeActionType =
  | 'barrier_tape'
  | 'signage_placed'
  | 'asset_closed'
  | 'area_cordoned'
  | 'asset_removed'
  | 'temporary_repair'
  | 'verbal_warning_given'
  | 'other';

interface MakeSafeFormData {
  action_taken: MakeSafeActionType | '';
  action_details: string;
  recommendation: string;
  asset_closed: boolean;
  photo: File | null;
  photoPreview: string | null;
}

type SubmitStatus = 'idle' | 'uploading_photo' | 'submitting' | 'success' | 'error';

// =============================================
// CONSTANTS
// =============================================

const ACTION_OPTIONS: { value: MakeSafeActionType; label: string; icon: string }[] = [
  { value: 'barrier_tape', label: 'Barrier tape applied', icon: '🚧' },
  { value: 'signage_placed', label: 'Warning signage placed', icon: '⚠️' },
  { value: 'asset_closed', label: 'Asset closed / taken out of use', icon: '🚫' },
  { value: 'area_cordoned', label: 'Area cordoned off', icon: '🔒' },
  { value: 'asset_removed', label: 'Asset removed', icon: '🗑️' },
  { value: 'temporary_repair', label: 'Temporary repair made', icon: '🔧' },
  { value: 'verbal_warning_given', label: 'Verbal warning given to site contact', icon: '📢' },
  { value: 'other', label: 'Other action taken', icon: '📝' },
];

const INITIAL_FORM: MakeSafeFormData = {
  action_taken: '',
  action_details: '',
  recommendation: '',
  asset_closed: false,
  photo: null,
  photoPreview: null,
};

// =============================================
// MAKE SAFE BUTTON (trigger)
// =============================================

export function MakeSafeButton({
  defectId,
  severity,
  description,
  siteName,
  assetCode,
  alreadyMadeSafe = false,
  onSuccess,
}: MakeSafeButtonProps): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);

  if (alreadyMadeSafe) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400">
        <CheckCircle className="w-3 h-3" />
        Made Safe
      </span>
    );
  }

  const isHighRisk = severity === 'very_high' || severity === 'high';

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          isHighRisk
            ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
            : 'bg-iv-surface-2 text-iv-muted hover:text-iv-text border border-iv-border'
        }`}
        aria-label="Record make-safe action"
      >
        <ShieldAlert className="w-3.5 h-3.5" />
        Make Safe
      </button>

      {modalOpen && (
        <MakeSafeModal
          defectId={defectId}
          severity={severity}
          description={description}
          siteName={siteName}
          assetCode={assetCode}
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            setModalOpen(false);
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}

// =============================================
// MAKE SAFE MODAL
// =============================================

function MakeSafeModal({
  defectId,
  severity,
  description,
  siteName,
  assetCode,
  onClose,
  onSuccess,
}: {
  defectId: string;
  severity: string;
  description: string;
  siteName: string;
  assetCode: string;
  onClose: () => void;
  onSuccess: () => void;
}): JSX.Element {
  const [form, setForm] = useState<MakeSafeFormData>(INITIAL_FORM);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [geoLocation, setGeoLocation] = useState<{ lat: number; lng: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Capture GPS on mount ───────────────────
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeoLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          // GPS unavailable — not blocking
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  }, []);

  // ── Lock body scroll ───────────────────────
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // ── Photo capture ──────────────────────────
  const handlePhotoCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({
        ...prev,
        photo: file,
        photoPreview: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  }, []);

  const removePhoto = useCallback(() => {
    setForm((prev) => ({ ...prev, photo: null, photoPreview: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ── Auto-set asset_closed when "Asset closed" action selected ──
  const handleActionChange = useCallback((value: string) => {
    setForm((prev) => ({
      ...prev,
      action_taken: value as MakeSafeActionType,
      asset_closed: value === 'asset_closed' ? true : prev.asset_closed,
    }));
  }, []);

  // ── Submit ─────────────────────────────────
  const handleSubmit = useCallback(async () => {
    // Validate
    if (!form.action_taken) {
      setErrorMsg('Please select what action you took.');
      return;
    }
    if (!form.action_details.trim()) {
      setErrorMsg('Please describe what you did.');
      return;
    }
    if (!form.recommendation.trim()) {
      setErrorMsg('Please add a recommendation before leaving site.');
      return;
    }

    setErrorMsg('');
    let photoR2Key: string | null = null;

    try {
      // ── Upload photo if present ──
      if (form.photo) {
        setStatus('uploading_photo');

        const uploadReq = await secureFetch('/api/v1/uploads/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: form.photo.name,
            content_type: form.photo.type,
            context: 'make_safe',
          }),
        }) as Response;

        if (!uploadReq.ok) throw new Error('Failed to get upload URL');

        const uploadData = await uploadReq.json() as {
          data: { r2_key: string; upload_url: string };
        };

        // Upload to R2
        const putRes = await fetch(uploadData.data.upload_url, {
          method: 'PUT',
          body: form.photo,
          headers: { 'Content-Type': form.photo.type },
        });

        if (!putRes.ok) throw new Error('Failed to upload photo');

        photoR2Key = uploadData.data.r2_key;

        // Confirm upload
        await secureFetch(`/api/v1/uploads/photo/${encodeURIComponent(photoR2Key)}/confirm`, {
          method: 'POST',
        });
      }

      // ── Submit make-safe action ──
      setStatus('submitting');

      const res = await secureFetch(`/api/v1/defects/${defectId}/make-safe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_taken: form.action_taken,
          action_details: form.action_details.trim(),
          recommendation: form.recommendation.trim(),
          asset_closed: form.asset_closed,
          photo_r2_key: photoR2Key,
          latitude: geoLocation?.lat ?? null,
          longitude: geoLocation?.lng ?? null,
        }),
      }) as Response;

      if (!res.ok) {
        const body = await res.json().catch(() => null) as Record<string, string> | null;
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }

      setStatus('success');

      // Auto-close after brief success display
      setTimeout(() => {
        onSuccess();
      }, 1500);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setErrorMsg(message);
      setStatus('error');
    }
  }, [form, defectId, geoLocation, onSuccess]);

  // ── Render ─────────────────────────────────
  const isSubmitting = status === 'uploading_photo' || status === 'submitting';
  const isHighRisk = severity === 'very_high' || severity === 'high';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Record make-safe action"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isSubmitting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[90vh] bg-iv-bg border border-iv-border rounded-t-2xl sm:rounded-2xl overflow-y-auto">
        {/* Success overlay */}
        {status === 'success' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-iv-bg/95 rounded-2xl">
            <CheckCircle className="w-12 h-12 text-emerald-400 mb-3" />
            <p className="text-lg font-semibold text-iv-text">Made Safe</p>
            <p className="text-sm text-iv-muted mt-1">Action recorded with evidence</p>
          </div>
        )}

        {/* Header */}
        <div className={`sticky top-0 z-10 flex items-center justify-between p-4 border-b ${
          isHighRisk ? 'bg-red-500/10 border-red-500/20' : 'bg-iv-surface border-iv-border'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isHighRisk ? 'bg-red-500/20' : 'bg-orange-500/15'
            }`}>
              <ShieldAlert className={`w-5 h-5 ${isHighRisk ? 'text-red-400' : 'text-orange-400'}`} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-iv-text">Make Safe</h2>
              <p className="text-2xs text-iv-muted">Record action taken before leaving site</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="iv-btn-icon"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Defect context */}
        <div className="px-4 py-3 bg-iv-surface-2/50 border-b border-iv-border">
          <p className="text-sm text-iv-text line-clamp-2">{description}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-2xs text-iv-muted">{siteName}</span>
            <span className="text-2xs text-iv-muted-2">·</span>
            <span className="text-2xs text-iv-muted">{assetCode}</span>
            {geoLocation && (
              <>
                <span className="text-2xs text-iv-muted-2">·</span>
                <span className="inline-flex items-center gap-1 text-2xs text-emerald-400">
                  <MapPin className="w-3 h-3" />
                  GPS
                </span>
              </>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Action taken */}
          <div>
            <label htmlFor="make-safe-action" className="block text-xs font-medium text-iv-muted mb-1.5">
              What did you do? <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <select
                id="make-safe-action"
                value={form.action_taken}
                onChange={(e) => handleActionChange(e.target.value)}
                disabled={isSubmitting}
                className="w-full appearance-none px-3 py-2.5 pr-9 bg-iv-surface border border-iv-border rounded-xl text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors disabled:opacity-50"
              >
                <option value="">Select action taken…</option>
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.icon} {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-iv-muted pointer-events-none" />
            </div>
          </div>

          {/* Action details */}
          <div>
            <label htmlFor="make-safe-details" className="block text-xs font-medium text-iv-muted mb-1.5">
              Describe what you did <span className="text-red-400">*</span>
            </label>
            <textarea
              id="make-safe-details"
              value={form.action_details}
              onChange={(e) => setForm((prev) => ({ ...prev, action_details: e.target.value }))}
              disabled={isSubmitting}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Applied red and white barrier tape around the swing frame. Secured to adjacent fencing posts to prevent access…"
              className="w-full px-3 py-2.5 bg-iv-surface border border-iv-border rounded-xl text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors disabled:opacity-50 resize-none"
            />
          </div>

          {/* Photo capture */}
          <div>
            <label className="block text-xs font-medium text-iv-muted mb-1.5">
              Evidence photo
            </label>
            {form.photoPreview ? (
              <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-iv-border">
                <img
                  src={form.photoPreview}
                  alt="Make-safe evidence"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={isSubmitting}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                  aria-label="Remove photo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                className="w-full flex flex-col items-center justify-center gap-2 py-8 bg-iv-surface border-2 border-dashed border-iv-border rounded-xl text-iv-muted hover:border-iv-accent/30 hover:text-iv-text transition-colors disabled:opacity-50"
              >
                <Camera className="w-6 h-6" />
                <span className="text-sm font-medium">Take or upload photo</span>
                <span className="text-2xs text-iv-muted-2">Shows what you did to make it safe</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
              aria-hidden="true"
            />
          </div>

          {/* Recommendation */}
          <div>
            <label htmlFor="make-safe-recommendation" className="block text-xs font-medium text-iv-muted mb-1.5">
              Recommendation before leaving site <span className="text-red-400">*</span>
            </label>
            <textarea
              id="make-safe-recommendation"
              value={form.recommendation}
              onChange={(e) => setForm((prev) => ({ ...prev, recommendation: e.target.value }))}
              disabled={isSubmitting}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Swing seat and chains require replacement by qualified contractor. Equipment must remain closed until repair is completed and re-inspected…"
              className="w-full px-3 py-2.5 bg-iv-surface border border-iv-border rounded-xl text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors disabled:opacity-50 resize-none"
            />
          </div>

          {/* Asset closed toggle */}
          <div className="flex items-center justify-between p-3 bg-iv-surface border border-iv-border rounded-xl">
            <div className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-400" />
              <div>
                <p className="text-sm font-medium text-iv-text">Asset taken out of use</p>
                <p className="text-2xs text-iv-muted">Marks asset as inactive until repaired</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.asset_closed}
              onClick={() => setForm((prev) => ({ ...prev, asset_closed: !prev.asset_closed }))}
              disabled={isSubmitting}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                form.asset_closed ? 'bg-red-500' : 'bg-iv-surface-2'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  form.asset_closed ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 p-4 border-t border-iv-border bg-iv-bg">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {status === 'uploading_photo' ? 'Uploading photo…' : 'Recording…'}
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4" />
                Record Make-Safe Action
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MakeSafeButton;
