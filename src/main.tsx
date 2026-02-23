import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { initErrorTracking } from '@utils/errorTracking';
import { initAnalytics } from '@utils/analytics';
import { App } from './App';
import './index.css';

/** Initialise observability before React renders */
initErrorTracking();
initAnalytics({ debug: !import.meta.env.PROD });

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Check index.html has <div id="root">.');
}

createRoot(rootElement).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
);
