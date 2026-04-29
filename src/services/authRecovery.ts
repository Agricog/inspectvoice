/**
 * InspectVoice — Auth Recovery
 *
 * The single canonical recovery path when authentication has failed
 * or the user signs out. Idempotent — safe to call multiple times.
 *
 * Sequence:
 *   1. Stop sync service (no more API calls)
 *   2. Wait briefly for outbound queue to drain (preserve unsynced work)
 *   3. Clear CSRF token
 *   4. Clear cached offline session
 *   5. Clear all IndexedDB data
 *   6. Unregister service workers (forces fresh bundle on reload)
 *   7. Sign out of Clerk (best-effort, non-blocking)
 *   8. Hard reload to /sign-in
 *
 * Build Standard: Autaimate v3
 */

import { syncService } from '@services/syncService';
import { syncQueue, clearAllData } from '@services/offlineStore';
import { clearCSRFToken } from '@utils/csrf';
import { clearCachedSession } from '@services/offlineAuth';
import { captureWarning } from '@utils/errorTracking';

/** Max time to wait for outbound queue to drain before giving up */
const QUEUE_DRAIN_TIMEOUT_MS = 5_000;

/** Idempotency guard — prevent concurrent recoveries */
let recoveryInProgress = false;

/**
 * Recover from an auth failure or perform a coordinated sign-out.
 *
 * @param reason — short string for diagnostics (e.g. 'secureFetch:401',
 *                 'syncService:401', 'user-initiated-signout')
 */
export async function recoverFromAuthFailure(reason: string): Promise<void> {
  // Idempotency — only run once even if called concurrently
  if (recoveryInProgress) {
    return;
  }
  recoveryInProgress = true;

  // Diagnostic — captured to Sentry as a warning so we can see frequency
  captureWarning('Auth recovery triggered', {
    module: 'authRecovery',
    operation: 'recoverFromAuthFailure',
    metadata: { reason },
  });

  // 1. Stop the sync service (no more API calls)
  try {
    syncService.stop();
  } catch {
    // Non-blocking — continue recovery
  }

  // 2. Best-effort drain of outbound queue (preserve unsynced work)
  await drainOutboundQueueWithTimeout();

  // 3. Clear CSRF token
  try {
    clearCSRFToken();
  } catch {
    // Non-blocking
  }

  // 4. Clear cached offline session
  try {
    clearCachedSession();
  } catch {
    // Non-blocking
  }

  // 5. Clear all IndexedDB data
  try {
    await clearAllData();
  } catch {
    // Non-blocking — proceed to reload anyway
  }

  // 6. Unregister all service workers
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
  } catch {
    // Non-blocking
  }

  // 7. Sign out of Clerk (best-effort, non-blocking)
  // We call window.Clerk if available — avoids importing Clerk hooks here
  try {
    const clerk = (window as unknown as { Clerk?: { signOut: () => Promise<void> } }).Clerk;
    if (clerk?.signOut) {
      await Promise.race([
        clerk.signOut(),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  } catch {
    // Non-blocking
  }

  // 8. Hard reload to sign-in
  // Using replace() so the broken state isn't in browser history
  window.location.replace('/sign-in');
}

/**
 * Wait up to QUEUE_DRAIN_TIMEOUT_MS for the outbound queue to empty.
 * Returns whether the queue successfully drained.
 *
 * Note: this is best-effort. The sync service has been stopped, so
 * the queue won't drain itself — but if a sync cycle is currently
 * in flight, we give it a chance to finish.
 */
async function drainOutboundQueueWithTimeout(): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < QUEUE_DRAIN_TIMEOUT_MS) {
    try {
      const remaining = await syncQueue.count();
      if (remaining === 0) {
        return true;
      }
    } catch {
      return false;
    }
    // Poll every 250ms
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}
