/**
 * InspectVoice — Portal Notifications Page
 * src/portal/pages/NotificationsPage.tsx
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  type PortalNotification,
} from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, fmtDate } from './DashboardPage';

export function NotificationsPage() {
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchNotifications({ limit: 50 })
      .then((res) => {
        setItems(res.data);
        setUnreadCount(res.unread_count);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
  }

  async function handleMarkRead(id: string) {
    try {
      await markNotificationsRead([id]);
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </p>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Mark all as read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No notifications yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {items.map((n) => (
            <div
              key={n.id}
              className={`px-5 py-4 flex items-start gap-4 ${!n.is_read ? 'bg-blue-50/50' : ''}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <NotificationIcon type={n.notification_type} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!n.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {n.title}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">{n.body}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-gray-400">{fmtDate(n.created_at)}</span>
                  {n.link_url && (
                    <Link to={n.link_url} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                      View details
                    </Link>
                  )}
                  {!n.is_read && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    report_published: '📋',
    critical_defect: '🔴',
    defect_status_changed: '🔄',
    remedial_complete: '✅',
    comment_mention: '💬',
  };
  return <span className="text-lg">{icons[type] ?? '🔔'}</span>;
}
