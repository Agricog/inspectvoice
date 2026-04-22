/**
 * InspectVoice — Application Entry Point
 *
 * Integrates with vite-react-ssg for static pre-rendering of public marketing
 * pages. Client-only services (theme, Sentry, analytics, PWA service worker)
 * are dynamically imported inside the isClient callback so they never execute
 * during SSG pre-render.
 *
 * The ClerkProvider is mounted inside RootLayout in App.tsx (client-only),
 * not here — providers must be inside the React tree to survive SSG routing.
 *
 * Build Standard: Autaimate v3
 */

import { ViteReactSSG } from 'vite-react-ssg';
import { routes } from './App';
import './index.css';

declare global {
  interface Window {
    __IV_SW_UPDATE?: (reloadPage: boolean) => Promise<void>;
  }
}

export const createRoot = ViteReactSSG(
  { routes, basename: '/' },
  ({ isClient }) => {
    if (!isClient) return;
    void initialiseClient();
  }
);

async function initialiseClient(): Promise<void> {
  // Theme — before first paint
  const { initTheme } = await import('@services/theme');
  initTheme();

  // Observability
  const { initErrorTracking } = await import('@utils/errorTracking');
  const { initAnalytics } = await import('@utils/analytics');
  initErrorTracking();
  initAnalytics({ debug: !import.meta.env.PROD });

  // PWA service worker
  const { registerSW } = await import('virtual:pwa-register');
  const updateSW = registerSW({
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('iv-sw-update-available'));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('iv-sw-offline-ready'));
    },
    onRegisteredSW(swUrl, registration) {
      if (registration) {
        setInterval(
          () => {
            void registration.update();
          },
          60 * 60 * 1000
        );
      }
      if (import.meta.env.DEV) {
        console.info('[PWA] Service worker registered:', swUrl);
      }
    },
    onRegisterError(error) {
      console.error('[PWA] Service worker registration failed:', error);
    },
  });
  window.__IV_SW_UPDATE = updateSW;

  // Remove HTML splash screen once React mounts
  queueMicrotask(() => {
    const splash = document.getElementById('iv-splash');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 300);
    }
  });
}
