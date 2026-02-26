/**
 * InspectVoice — Portal Layout
 * src/portal/layout/PortalLayout.tsx
 *
 * Sidebar + header shell for the client portal.
 * Mobile-responsive: sidebar collapses to hamburger menu.
 */

import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePortalUser } from '../auth/PortalAuthProvider';
import { fetchNotifications } from '../api/portalApi';

interface Props {
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/portal', icon: '📊' },
  { label: 'Sites', path: '/portal/sites', icon: '📍' },
  { label: 'Inspections', path: '/portal/inspections', icon: '📋' },
  { label: 'Defects', path: '/portal/defects', icon: '⚠️' },
  { label: 'Notifications', path: '/portal/notifications', icon: '🔔' },
];

export function PortalLayout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const { name, email } = usePortalUser();

  // Fetch unread notification count
  useEffect(() => {
    fetchNotifications({ limit: 1, unread: true })
      .then((res) => setUnreadCount(res.unread_count))
      .catch(() => {});
  }, [location.pathname]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-64 bg-white border-r border-gray-200
          transform transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Logo / brand */}
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <span className="text-lg font-bold text-blue-600">InspectVoice</span>
          <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Portal</span>
        </div>

        {/* Nav links */}
        <nav className="p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.path === '/portal'
                ? location.pathname === '/portal'
                : location.pathname.startsWith(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-colors
                  ${isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }
                `}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
                {item.label === 'Notifications' && unreadCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User info at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">
              {name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
              <p className="text-xs text-gray-500 truncate">{email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 lg:px-6 gap-4">
          {/* Hamburger (mobile) */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Page title from route */}
          <h1 className="text-lg font-semibold text-gray-900">
            {getPageTitle(location.pathname)}
          </h1>

          <div className="ml-auto flex items-center gap-3">
            {/* Notification bell */}
            <Link
              to="/portal/notifications"
              className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function getPageTitle(pathname: string): string {
  if (pathname === '/portal') return 'Dashboard';
  if (pathname === '/portal/sites') return 'Sites';
  if (pathname.startsWith('/portal/sites/')) return 'Site Details';
  if (pathname === '/portal/inspections') return 'Inspections';
  if (pathname.startsWith('/portal/inspections/')) return 'Inspection Report';
  if (pathname === '/portal/defects') return 'Defect Tracker';
  if (pathname.startsWith('/portal/defects/')) return 'Defect Details';
  if (pathname === '/portal/notifications') return 'Notifications';
  return 'Portal';
}
