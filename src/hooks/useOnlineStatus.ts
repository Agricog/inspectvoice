/**
 * InspectVoice — useOnlineStatus Hook
 * Detects browser online/offline state changes.
 * Used to trigger sync when connectivity returns.
 *
 * Usage:
 *   const { isOnline, wasOffline } = useOnlineStatus();
 *   // wasOffline = true when transitioning from offline → online (sync trigger)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SyncEvents } from '@utils/analytics';

interface OnlineStatus {
  /** Current online state */
  isOnline: boolean;
  /** True when just transitioned from offline → online (reset after read) */
  wasOffline: boolean;
  /** Timestamp of last connectivity change */
  lastChangeAt: number | null;
  /** Acknowledge the offline→online transition (resets wasOffline) */
  acknowledgeReconnect: () => void;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastChangeAt, setLastChangeAt] = useState<number | null>(null);
  const previousOnlineRef = useRef(navigator.onLine);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    setLastChangeAt(Date.now());
    SyncEvents.cameOnline();

    // If we were offline before, flag for sync
    if (!previousOnlineRef.current) {
      setWasOffline(true);
    }
    previousOnlineRef.current = true;
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setLastChangeAt(Date.now());
    previousOnlineRef.current = false;
    SyncEvents.wentOffline();
  }, []);

  const acknowledgeReconnect = useCallback(() => {
    setWasOffline(false);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return {
    isOnline,
    wasOffline,
    lastChangeAt,
    acknowledgeReconnect,
  };
}
