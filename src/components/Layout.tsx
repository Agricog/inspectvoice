/**
 * InspectVoice — App Shell Layout
 * Persistent header with navigation, offline indicator, and content area.
 * Mobile-first responsive design.
 *
 * UPDATED: Feature 14 + 15 nav items added.
 */

import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import { useOnlineStatus } from '@hooks/useOnlineStatus';

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

export function Layout(): JSX.Element {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isOnline } = useOnlineStatus();

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  return (
    <div className="min-h-dvh bg-iv-bg flex flex-col">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-risk-medium/15 border-b border-risk-medium/30 px-4 py-2 flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 text-risk-medium" />
          <span className="text-sm font-medium text-risk-medium">
            Offline — data saved locally, will sync when connected
          </span>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-iv-border bg-iv-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group" onClick={closeMobileMenu}>
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
          <div className="flex items-center gap-3">
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

        {/* Mobile nav */}
        {mobileMenuOpen && (
          <nav
            id="mobile-nav"
            className="md:hidden border-t border-iv-border bg-iv-surface px-4 py-3 animate-slide-up"
            aria-label="Mobile navigation"
          >
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

            {/* Mobile online status */}
            <div className="mt-3 pt-3 border-t border-iv-border flex items-center gap-2 px-3">
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
