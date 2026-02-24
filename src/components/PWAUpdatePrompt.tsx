/**
 * InspectVoice — PWA Update Prompt
 *
 * Non-intrusive banner that appears when a new service worker version
 * is available. Allows the inspector to finish their current work
 * before updating — critical for field use where losing state mid-inspection
 * would be unacceptable.
 *
 * Also shows a brief "offline ready" toast on first install.
 *
 * Events listened for (dispatched from main.tsx):
 *   - iv-sw-update-available → new version ready, show update banner
 *   - iv-sw-offline-ready    → app cached, show brief confirmation
 *
 * Build Standard: Autaimate v3
 */

import { useState, useEffect, useCallback } from 'react';
import { Download, X, Wifi, WifiOff } from 'lucide-react';

// =============================================
// OFFLINE READY TOAST
// =============================================

function OfflineReadyToast({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  // Auto-dismiss after 4 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 animate-slide-up"
    >
      <div className="flex items-center gap-3 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl backdrop-blur-sm">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
          <WifiOff className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-emerald-400">Ready for offline use</p>
          <p className="text-2xs text-iv-muted mt-0.5">You can now inspect without a connection.</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="iv-btn-icon shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// =============================================
// UPDATE AVAILABLE BANNER
// =============================================

function UpdateBanner({ onUpdate, onDismiss }: { onUpdate: () => void; onDismiss: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-50 animate-slide-up"
    >
      <div className="flex items-start gap-3 p-4 bg-iv-surface border border-iv-accent/30 rounded-xl shadow-lg shadow-black/20 backdrop-blur-sm">
        <div className="w-9 h-9 rounded-lg bg-iv-accent/15 flex items-center justify-center shrink-0 mt-0.5">
          <Download className="w-4 h-4 text-iv-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-iv-text">Update available</p>
          <p className="text-2xs text-iv-muted mt-0.5">
            A new version of InspectVoice is ready. Update when you've finished your current task.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onUpdate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-iv-accent text-white rounded-lg text-xs font-medium hover:bg-iv-accent/90 transition-colors"
            >
              <Download className="w-3 h-3" />
              Update now
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 text-xs font-medium text-iv-muted hover:text-iv-text transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="iv-btn-icon shrink-0"
          aria-label="Dismiss update notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// =============================================
// ONLINE STATUS INDICATOR
// =============================================

function OfflineBanner(): JSX.Element | null {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-50 bg-yellow-500/15 border-b border-yellow-500/30 px-4 py-2"
    >
      <div className="flex items-center justify-center gap-2">
        <WifiOff className="w-3.5 h-3.5 text-yellow-400" />
        <p className="text-xs font-medium text-yellow-400">
          You're offline — changes will sync when you reconnect
        </p>
        <Wifi className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
      </div>
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export function PWAUpdatePrompt(): JSX.Element {
  const [showUpdate, setShowUpdate] = useState(false);
  const [showOfflineReady, setShowOfflineReady] = useState(false);

  useEffect(() => {
    const handleUpdateAvailable = (): void => {
      setShowUpdate(true);
    };

    const handleOfflineReady = (): void => {
      setShowOfflineReady(true);
    };

    window.addEventListener('iv-sw-update-available', handleUpdateAvailable);
    window.addEventListener('iv-sw-offline-ready', handleOfflineReady);

    return () => {
      window.removeEventListener('iv-sw-update-available', handleUpdateAvailable);
      window.removeEventListener('iv-sw-offline-ready', handleOfflineReady);
    };
  }, []);

  const handleUpdate = useCallback(() => {
    if (window.__IV_SW_UPDATE) {
      void window.__IV_SW_UPDATE(true);
    }
  }, []);

  const handleDismissUpdate = useCallback(() => {
    setShowUpdate(false);
  }, []);

  const handleDismissOfflineReady = useCallback(() => {
    setShowOfflineReady(false);
  }, []);

  return (
    <>
      <OfflineBanner />

      {showOfflineReady && (
        <OfflineReadyToast onDismiss={handleDismissOfflineReady} />
      )}

      {showUpdate && (
        <UpdateBanner onUpdate={handleUpdate} onDismiss={handleDismissUpdate} />
      )}
    </>
  );
}

export default PWAUpdatePrompt;
