/**
 * InspectVoice — Theme Manager
 * Handles light/dark theme switching with localStorage persistence.
 *
 * Light theme is the default (optimised for outdoor field use).
 * Dark theme is opt-in for evening/office work.
 *
 * Usage:
 *   import { initTheme, toggleTheme, getTheme } from '@services/theme';
 *   initTheme();  // Call once on app startup
 *   toggleTheme(); // Toggle between light and dark
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'iv-theme';

/** Read the stored theme preference, defaulting to light for field use */
export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (private browsing etc.)
  }
  return 'light';
}

/** Apply the theme to the document */
function applyTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/** Initialise theme on app startup — call once in main.tsx or App.tsx */
export function initTheme(): void {
  applyTheme(getTheme());
}

/** Toggle between light and dark, persist choice */
export function toggleTheme(): Theme {
  const current = getTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-blocking
  }
  applyTheme(next);
  return next;
}

/** Set a specific theme */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Non-blocking
  }
  applyTheme(theme);
}
