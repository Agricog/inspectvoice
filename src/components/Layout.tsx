/**
 * InspectVoice — App Shell Layout
 * Persistent header with navigation, offline indicator, sync status,
 * and content area. Mobile-first responsive design.
 *
 * UPDATED Step 6: Sync status surfaced — inspector now has visibility into
 *   syncing/synced/error/auth-required states, not just connectivity.
 */
import { useState, useCallback, useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Shield,
  MapPin,
  ClipboardCheck,
  AlertTriangle,
  Settings,
  Menu,
  X,
  WifiOff,
  Wifi,
  Navigation,
  BarChart3,
  BookOpen,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { useOnlineStatus } from '@hooks/useOnlineStatus';
import { Sun, Moon } from 'lucide-react';
import { toggleTheme, getTheme } from '@services/theme';
import { syncService } from '@services/syncService';
import { SyncStatus } from '@/types';
import type { SyncStatusDetail } from '@services/syncService';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/sites', label: 'Sites', icon: <MapPin className="w-4 h-4" /> },
  { to: '/inspections', label: 'Inspections', icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: '/defects', label: 'Defects', icon: <AlertTriangle className="w-4 h-4" /> },
  { to: '/route-planner', label: 'Route', icon: <Navigation className="w-4 h-4" /> },
  { to: '/inspector-performance', label: 'Performance', icon: <BarChart3 className="w-4 h-4" /> },
  { to: '/defect-library', label: 'Library', icon: <BookOpen className="w-4 h-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
];

// =============================================
// SYNC STATUS — copy + colour for each state
// =============================================

interface SyncStatusDisplay {
  show: boolean;
  variant: 'info' | 'warning' | 'error' | 'success';
  icon: React.ReactNode;
  message: string;
}

function deriveSyncDisplay(
  isOnline: boolean,
  status: SyncStatus,
  detail: SyncStatusDetail | null,
): SyncStatusDisplay {
  // Offline always wins — that's the most relevant message
  if (!isOnline) {
    return {
      show: true,
      variant: 'warning',
      icon: <WifiOff className="w-4 h-4" />,
      message: 'Offline — data saved locally, will sync when connected',
    };
  }

  const pending = detail?.pendingCount ?? 0;

  switch (status) {
    case SyncStatus.SYNCING:
      return {
        show: true,
        variant: 'info',
        icon: <RefreshCw className="w-4 h-4 animate-spin" />,
        message: pending > 0 ? `Syncing ${pending} item${pending === 1 ? '' : 's'}…` : 'Syncing…',
      };
    case SyncStatus.AUTH_REQUIRED:
      return {
        show: true,
        variant: 'error',
        icon: <AlertTriangle className="w-4 h-4" />,
        message: 'Sign-in required to continue syncing',
      };
    case SyncStatus.ERROR:
      return {
        show: true,
        variant: 'error',
        icon: <AlertTriangle className="w-4 h-4" />,
        message: detail?.lastError
          ? `Sync error: ${detail.lastError}`
          : `Sync error — ${pending} item${pending === 1 ? '' : 's'} pending`,
      };
    case SyncStatus.OFFLINE:
      // Already handled above by isOnline check, but cover the enum value
      return {
        show: true,
        variant: 'warning',
        icon: <WifiOff className="w-4 h-4" />,
        message: 'Offline — data saved locally',
      };
    case SyncStatus.SYNCED:
    case SyncStatus.IDLE:
    default:
      // Don't show a banner when everything is fine
      return {
        show: false,
        variant: 'success',
        icon: <CheckCircle2 className="w-4 h-4" />,
        message: '',
      };
  }
}

const VARIANT_CLASSES: Record<SyncStatusDisplay['variant'], string> = {
  info: 'bg-iv-accent/10 border-iv-accent/30 text-iv-accent',
  warning: 'bg-risk-medium/15 border-risk-medium/30 text-risk-medium',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
};

// =============================================
// LAYOUT
// =============================================

export function Layout(): JSX.Element {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const { isOnline } = useOnlineStatus();

  // Subscribe to sync service status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncService.getStatus());
  const [syncDetail, setSyncDetail] = useState<SyncStatusDetail | null>(null);

  useEffect(() => {
    const unsubscribe = syncService.onStatusChange((status, detail) => {
      setSyncStatus(status);
      setSyncDetail(detail ?? null);
    });
    return unsubscribe;
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  const syncDisplay = deriveSyncDisplay(isOnline, syncStatus, syncDetail);

  return (
    <div className="min-h-dvh bg-iv-bg flex flex-col">
      {/* Sync / Offline status banner */}
      {syncDisplay.show && (
        <div
          role="status"
          aria-live="polite"
          className={`border-b px-4 py-2 flex items-center justify-center gap-2 ${VARIANT_CLASSES[syncDisplay.variant]}`}
        >
          {syncDisplay.icon}
          <span className="text-sm font-medium">{syncDisplay.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-iv-border bg-iv-surface/80 backdrop-blur-sm sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group min-w-0" onClick={closeMobileMenu}>
            <div className="w-9 h-9 rounded-lg bg-iv-accent/15 flex items-center justify-center transition-colors group-hover:bg-iv-accent/25">
              <Shield className="w-5 h-5 text-iv-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text leading-tight">
                InspectVoice
              </h1>
              <p className="text-2xs text-iv-muted hidden sm:block">
                BS EN 1176 Inspection Platform
              </p>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-iv-accent/10 text-iv-accent'
                      : 'text-iv-muted hover:text-iv-text hover:bg-iv-surface-2'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right side — status + mobile menu */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Theme toggle */}
            <button
              type="button"
              onClick={() => setThemeState(toggleTheme())}
              className="iv-btn-icon"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode (outdoor)' : 'Dark mode (office)'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Online indicator (desktop) */}
            <div className="hidden md:flex items-center gap-1.5">
              {isOnline ? (
                <Wifi className="w-4 h-4 text-iv-accent" />
              ) : (
                <WifiOff className="w-4 h-4 text-risk-medium" />
              )}
              <span className="text-2xs text-iv-muted">
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Mobile menu button */}
            <button
              type="button"
              className="iv-btn-icon md:hidden"
              onClick={toggleMobileMenu}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

       {/* Mobile nav overlay */}
        {mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={closeMobileMenu}
              aria-hidden="true"
            />
            <nav
              id="mobile-nav"
              className="fixed top-0 left-0 w-72 h-dvh z-50 md:hidden bg-iv-surface border-r border-iv-border px-4 py-6 overflow-y-auto animate-slide-up"
              aria-label="Mobile navigation"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-iv-accent/15 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-iv-accent" />
                  </div>
                  <span className="text-lg font-semibold text-iv-text">InspectVoice</span>
                </div>
                <button
                  type="button"
                  onClick={closeMobileMenu}
                  className="iv-btn-icon"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={closeMobileMenu}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-iv-accent/10 text-iv-accent'
                            : 'text-iv-muted hover:text-iv-text hover:bg-iv-surface-2'
                        }`
                      }
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>

              <div className="mt-6 pt-4 border-t border-iv-border flex items-center gap-2 px-3">
                {isOnline ? (
                  <Wifi className="w-4 h-4 text-iv-accent" />
                ) : (
                  <WifiOff className="w-4 h-4 text-risk-medium" />
                )}
                <span className="text-xs text-iv-muted">
                  {isOnline ? 'Online — syncing enabled' : 'Offline — data saved locally'}
                </span>
              </div>
            </nav>
          </>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-iv-border py-4 px-4 mt-auto">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <p className="text-xs text-iv-muted-2">
            &copy; {new Date().getFullYear()} Built by <a href="https://autaimate.com" target="_blank" rel="noopener noreferrer" className="text-iv-accent hover:underline">Autaimate</a>. All rights reserved.
          </p>
          <p className="text-xs text-iv-muted-2">v0.1.0</p>
        </div>
      </footer>
    </div>
  );
}
