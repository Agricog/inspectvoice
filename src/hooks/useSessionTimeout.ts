/**
 * InspectVoice — useSessionTimeout Hook
 * Monitors user activity and triggers sign-out after inactivity.
 * Integrates with Clerk's signOut.
 *
 * Default: 30 minutes of inactivity.
 * Shows warning 5 minutes before timeout.
 *
 * Usage:
 *   const { remainingSeconds, showWarning } = useSessionTimeout({
 *     signOut: clerkSignOut,
 *     timeoutMinutes: 30,
 *   });
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// =============================================
// TYPES
// =============================================

interface SessionTimeoutConfig {
  /** Clerk signOut function */
  signOut: () => Promise<void>;
  /** Inactivity timeout in minutes (default: 30) */
  timeoutMinutes?: number;
  /** Warning shown X minutes before timeout (default: 5) */
  warningMinutes?: number;
  /** Callback when session expires */
  onTimeout?: () => void;
  /** Disable timeout (e.g. during active inspection) */
  disabled?: boolean;
}

interface SessionTimeoutState {
  /** Seconds remaining before timeout */
  remainingSeconds: number;
  /** Whether the warning period is active */
  showWarning: boolean;
  /** Reset the inactivity timer (call on user action) */
  resetTimer: () => void;
}

// =============================================
// ACTIVITY EVENTS
// =============================================

const ACTIVITY_EVENTS: readonly string[] = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'pointerdown',
] as const;

// =============================================
// HOOK
// =============================================

export function useSessionTimeout(config: SessionTimeoutConfig): SessionTimeoutState {
  const {
    signOut,
    timeoutMinutes = 30,
    warningMinutes = 5,
    onTimeout,
    disabled = false,
  } = config;

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const warningMs = warningMinutes * 60 * 1000;

  const [remainingSeconds, setRemainingSeconds] = useState(timeoutMinutes * 60);
  const [showWarning, setShowWarning] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signedOutRef = useRef(false);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setRemainingSeconds(timeoutMinutes * 60);
  }, [timeoutMinutes]);

  // Track user activity
  useEffect(() => {
    if (disabled) return;

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [disabled]);

  // Check timeout on interval
  useEffect(() => {
    if (disabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, timeoutMs - elapsed);
      const remainingSec = Math.ceil(remaining / 1000);

      setRemainingSeconds(remainingSec);

      // Show warning when entering warning period
      if (remaining <= warningMs && remaining > 0) {
        setShowWarning(true);
      } else if (remaining > warningMs) {
        setShowWarning(false);
      }

      // Timeout reached — sign out
      if (remaining <= 0 && !signedOutRef.current) {
        signedOutRef.current = true;
        onTimeout?.();
        void signOut();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [disabled, timeoutMs, warningMs, signOut, onTimeout]);

  return {
    remainingSeconds,
    showWarning,
    resetTimer,
  };
}
