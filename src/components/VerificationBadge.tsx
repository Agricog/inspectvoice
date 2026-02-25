/**
 * Feature 10: Verification Badge
 * src/components/VerificationBadge.tsx
 *
 * Displays tamper-evident seal status with inline verify button.
 * Used on export list items and post-download confirmation.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState } from 'react';
import { Shield, CheckCircle, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { verifyBundle, getVerifyUrl } from '@services/sealedExport';

// =============================================
// TYPES
// =============================================

type VerifyStatus = 'idle' | 'verifying' | 'valid' | 'invalid' | 'error';

interface VerificationBadgeProps {
  readonly bundleId: string;
  readonly compact?: boolean;
}

// =============================================
// COMPONENT
// =============================================

export function VerificationBadge({ bundleId, compact = false }: VerificationBadgeProps): JSX.Element {
  const [status, setStatus] = useState<VerifyStatus>('idle');
  const truncatedId = bundleId.slice(0, 8);

  async function handleVerify(): Promise<void> {
    setStatus('verifying');
    try {
      const result = await verifyBundle(bundleId);
      setStatus(result.valid ? 'valid' : 'invalid');
      setTimeout(() => setStatus('idle'), 10000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 5000);
    }
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Shield className="w-3 h-3 text-emerald-400" />
        <span className="text-emerald-400 font-medium">Sealed</span>
        <span className="text-iv-muted font-mono">{truncatedId}</span>
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm">
      <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
      <span className="text-emerald-300 font-medium">Tamper-Evident</span>

      <span className="text-emerald-500/40">|</span>
      <span className="text-emerald-400/70 font-mono text-xs">{truncatedId}</span>

      <span className="text-emerald-500/40">|</span>

      {status === 'verifying' ? (
        <span className="text-emerald-400 text-xs flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Verifying…
        </span>
      ) : status === 'valid' ? (
        <span className="text-emerald-300 text-xs font-medium flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" />
          Verified
        </span>
      ) : status === 'invalid' ? (
        <span className="text-red-400 text-xs font-medium flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5" />
          Invalid
        </span>
      ) : status === 'error' ? (
        <span className="text-amber-400 text-xs">Check failed</span>
      ) : (
        <button
          type="button"
          onClick={() => void handleVerify()}
          className="text-emerald-400 text-xs font-medium hover:text-emerald-300 transition-colors flex items-center gap-0.5"
          title={getVerifyUrl(bundleId)}
        >
          Verify
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default VerificationBadge;
