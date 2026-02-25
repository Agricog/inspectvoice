/**
 * InspectVoice — NormalisationSettings Component
 * Settings section for configuring AI style normalisation.
 * Drops into SettingsPage.tsx as a new section (admin/manager only).
 *
 * Usage (in SettingsPage.tsx):
 *   {isManagerOrAdmin && org && (
 *     <NormalisationSettings org={org} onSave={handleSaveOrg} />
 *   )}
 *
 * Configures:
 *   - Enable/disable normalisation
 *   - Style preset (formal / technical / plain English)
 *   - Custom writing guide (free text)
 *   - Before/after examples (up to 10)
 *   - Spelling & grammar correction toggle
 *   - Require review before export toggle
 *   - Model preference (Haiku / Sonnet)
 *   - Monthly token budget
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Sparkles,
  Save,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Plus,
  X,
  ArrowRight,
} from 'lucide-react';
import type { Organisation } from '@/types/entities';
import type {
  NormalisationSettings as NormSettings,
  StylePreset,
  ModelPreference,
  StyleExample,
} from '@/types/normalisation';
import {
  DEFAULT_NORMALISATION_SETTINGS,
  STYLE_PRESET_LABELS,
  STYLE_PRESET_DESCRIPTIONS,
  MODEL_PREFERENCE_LABELS,
} from '@/types/normalisation';

// =============================================
// TYPES
// =============================================

interface NormalisationSettingsProps {
  org: Organisation;
  onSave: (data: Partial<Organisation>) => Promise<void>;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

// =============================================
// HELPERS
// =============================================

/** Extract normalisation settings from org, with defaults */
function extractSettings(org: Organisation): NormSettings {
  const raw = (org.settings as unknown as Record<string, unknown>)?.['normalisation'];
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NORMALISATION_SETTINGS };

  const s = raw as Record<string, unknown>;
  return {
    enabled: s['enabled'] === true,
    style_preset: (['formal', 'technical', 'plain_english'].includes(String(s['style_preset']))
      ? String(s['style_preset']) as StylePreset
      : 'formal'),
    custom_guide: typeof s['custom_guide'] === 'string' ? s['custom_guide'] : null,
    examples: Array.isArray(s['examples'])
      ? (s['examples'] as StyleExample[]).filter(
          (e) => typeof e.before === 'string' && typeof e.after === 'string',
        ).slice(0, 10)
      : [],
    correct_spelling_grammar: s['correct_spelling_grammar'] !== false,
    require_review_before_export: s['require_review_before_export'] !== false,
    monthly_token_budget: typeof s['monthly_token_budget'] === 'number'
      ? s['monthly_token_budget']
      : 500_000,
    model_preference: s['model_preference'] === 'sonnet' ? 'sonnet' : 'haiku',
  };
}

// =============================================
// TOGGLE COMPONENT (reuse pattern from SettingsPage)
// =============================================

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between p-3 bg-iv-surface-2 rounded-lg">
      <div>
        <p className="text-sm text-iv-text">{label}</p>
        <p className="text-2xs text-iv-muted mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${
          checked ? 'bg-iv-accent' : 'bg-iv-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export function NormalisationSettings({ org, onSave }: NormalisationSettingsProps): JSX.Element {
  const [settings, setSettings] = useState<NormSettings>(() => extractSettings(org));
  const [newBefore, setNewBefore] = useState('');
  const [newAfter, setNewAfter] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Sync if org changes externally
  useEffect(() => {
    setSettings(extractSettings(org));
  }, [org]);

  // ── Update helpers ─────────────────────────
  const update = useCallback(<K extends keyof NormSettings>(key: K, value: NormSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Examples management ────────────────────
  const handleAddExample = useCallback(() => {
    const before = newBefore.trim();
    const after = newAfter.trim();
    if (!before || !after) return;
    if (settings.examples.length >= 10) return;

    update('examples', [...settings.examples, { before, after }]);
    setNewBefore('');
    setNewAfter('');
  }, [newBefore, newAfter, settings.examples, update]);

  const handleRemoveExample = useCallback((index: number) => {
    update('examples', settings.examples.filter((_, i) => i !== index));
  }, [settings.examples, update]);

  // ── Save ───────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    setErrorMsg('');

    try {
      // Merge normalisation into existing settings
      const existingSettings = (org.settings as unknown as Record<string, unknown>) ?? {};
      const updatedSettings = {
        ...existingSettings,
        normalisation: {
          enabled: settings.enabled,
          style_preset: settings.style_preset,
          custom_guide: settings.custom_guide || null,
          examples: settings.examples,
          correct_spelling_grammar: settings.correct_spelling_grammar,
          require_review_before_export: settings.require_review_before_export,
          monthly_token_budget: settings.monthly_token_budget,
          model_preference: settings.model_preference,
        },
      };

      await onSave({ settings: updatedSettings as unknown as Organisation['settings'] });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setErrorMsg('Failed to save normalisation settings');
    }
  }, [settings, org.settings, onSave]);

  // ── Token budget presets ───────────────────
  const budgetPresets = [
    { label: '100k', value: 100_000 },
    { label: '500k', value: 500_000 },
    { label: '1M', value: 1_000_000 },
    { label: '5M', value: 5_000_000 },
  ];

  return (
    <section className="bg-iv-surface border border-iv-border rounded-xl p-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-iv-accent/15 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4 text-iv-accent" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-iv-text">Writing Style & Normalisation</h2>
          <p className="text-2xs text-iv-muted mt-0.5">
            AI-powered text normalisation ensures consistent report language across all inspectors.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Enable toggle */}
        <Toggle
          label="Enable AI Normalisation"
          description="Inspectors can normalise text per-field or review all suggestions at sign-off."
          checked={settings.enabled}
          onChange={(v) => update('enabled', v)}
        />

        {/* Only show config when enabled */}
        {settings.enabled && (
          <>
            {/* Style preset */}
            <div>
              <label className="block text-xs font-medium text-iv-muted mb-1.5">
                Writing Style Preset
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(Object.entries(STYLE_PRESET_LABELS) as Array<[StylePreset, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update('style_preset', key)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      settings.style_preset === key
                        ? 'border-iv-accent bg-iv-accent/10'
                        : 'border-iv-border bg-iv-surface-2 hover:border-iv-accent/30'
                    }`}
                  >
                    <p className={`text-xs font-medium ${settings.style_preset === key ? 'text-iv-accent' : 'text-iv-text'}`}>
                      {label}
                    </p>
                    <p className="text-2xs text-iv-muted mt-0.5">
                      {STYLE_PRESET_DESCRIPTIONS[key]}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom guide */}
            <div>
              <label htmlFor="norm-custom-guide" className="block text-xs font-medium text-iv-muted mb-1.5">
                Custom Writing Guide <span className="text-iv-muted-2">(optional)</span>
              </label>
              <textarea
                id="norm-custom-guide"
                value={settings.custom_guide ?? ''}
                onChange={(e) => update('custom_guide', e.target.value || null)}
                placeholder="Additional style rules, e.g. 'Never use abbreviations. Always capitalise equipment names. Use metric measurements only.'"
                rows={3}
                maxLength={2000}
                className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors resize-y"
              />
              <p className="text-2xs text-iv-muted mt-1 text-right">
                {(settings.custom_guide ?? '').length}/2000
              </p>
            </div>

            {/* Before/after examples */}
            <div>
              <label className="block text-xs font-medium text-iv-muted mb-1.5">
                Style Examples <span className="text-iv-muted-2">({settings.examples.length}/10)</span>
              </label>
              <p className="text-2xs text-iv-muted mb-2">
                Show the AI your preferred phrasing. 3–5 examples are usually enough to lock tone.
              </p>

              {/* Existing examples */}
              {settings.examples.length > 0 && (
                <div className="space-y-2 mb-3">
                  {settings.examples.map((example, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-iv-surface-2 rounded-lg p-2">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <span className="text-2xs text-iv-muted">Before:</span>
                          <p className="text-xs text-iv-muted mt-0.5">{example.before}</p>
                        </div>
                        <div>
                          <span className="text-2xs text-iv-accent">After:</span>
                          <p className="text-xs text-iv-text mt-0.5">{example.after}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveExample(idx)}
                        className="iv-btn-icon shrink-0 text-iv-muted hover:text-red-400"
                        aria-label="Remove example"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new example */}
              {settings.examples.length < 10 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newBefore}
                    onChange={(e) => setNewBefore(e.target.value)}
                    placeholder="Inspector writes: 'chain's dodgy'"
                    maxLength={500}
                    className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newAfter}
                      onChange={(e) => setNewAfter(e.target.value)}
                      placeholder="Should become: 'Chain integrity compromised'"
                      maxLength={500}
                      className="flex-1 px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handleAddExample}
                      disabled={!newBefore.trim() || !newAfter.trim()}
                      className="iv-btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Add example"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Toggles */}
            <Toggle
              label="Correct Spelling & Grammar"
              description="Fix spelling, grammar, and punctuation as part of normalisation. Uses British English."
              checked={settings.correct_spelling_grammar}
              onChange={(v) => update('correct_spelling_grammar', v)}
            />

            <Toggle
              label="Require Review Before Export"
              description="Block PDF export/email until all normalisation suggestions are accepted or rejected."
              checked={settings.require_review_before_export}
              onChange={(v) => update('require_review_before_export', v)}
            />

            {/* Model preference */}
            <div>
              <label className="block text-xs font-medium text-iv-muted mb-1.5">
                AI Model
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MODEL_PREFERENCE_LABELS) as Array<[ModelPreference, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update('model_preference', key)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      settings.model_preference === key
                        ? 'border-iv-accent bg-iv-accent/10'
                        : 'border-iv-border bg-iv-surface-2 hover:border-iv-accent/30'
                    }`}
                  >
                    <p className={`text-xs font-medium ${settings.model_preference === key ? 'text-iv-accent' : 'text-iv-text'}`}>
                      {label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Token budget */}
            <div>
              <label className="block text-xs font-medium text-iv-muted mb-1.5">
                Monthly Token Budget
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {budgetPresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => update('monthly_token_budget', preset.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      settings.monthly_token_budget === preset.value
                        ? 'bg-iv-accent text-white'
                        : 'bg-iv-surface-2 text-iv-muted border border-iv-border hover:border-iv-accent/30'
                    }`}
                  >
                    {preset.label} tokens
                  </button>
                ))}
                <span className="text-2xs text-iv-muted">
                  ≈ ${settings.model_preference === 'haiku'
                    ? ((settings.monthly_token_budget / 1_000_000) * 2.4).toFixed(2)
                    : ((settings.monthly_token_budget / 1_000_000) * 9).toFixed(2)
                  }/month
                </span>
              </div>
            </div>

            {/* Link to history */}
            <a
              href="/normalisation-history"
              className="inline-flex items-center gap-1 text-xs text-iv-accent hover:underline"
            >
              View normalisation history & usage
              <ArrowRight className="w-3 h-3" />
            </a>
          </>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-4 border-t border-iv-border mt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-accent text-white rounded-lg text-sm font-medium hover:bg-iv-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saveStatus === 'saving' ? 'Saving…' : 'Save Changes'}
        </button>

        {saveStatus === 'success' && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5" />
            Saved
          </span>
        )}

        {saveStatus === 'error' && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            {errorMsg}
          </span>
        )}
      </div>
    </section>
  );
}

export default NormalisationSettings;
