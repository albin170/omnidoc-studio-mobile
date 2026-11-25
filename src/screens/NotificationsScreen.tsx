import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Megaphone, MessageSquarePlus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { NotificationItem } from '../types';

export const NotificationsScreen: React.FC<{
  onUnreadChange: (count: number) => void;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}> = ({ onUnreadChange, onToast }) => {
  const { isOnline } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const load = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const [notifRes, annRes] = await Promise.all([
        apiClient.listNotifications({ status: filter, limit: 50 }),
        apiClient.getActiveAnnouncements().catch(() => ({ items: [] })),
      ]);
      setItems(notifRes.items);
      onUnreadChange(notifRes.unread_count);
      setAnnouncements(annRes.items || []);
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [filter, isOnline, onToast, onUnreadChange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkAllRead = async () => {
    try {
      await apiClient.markAllNotificationsRead();
      onUnreadChange(0);
      await load();
      onToast('success', 'All notifications marked as read.');
    } catch (err: any) {
      onToast('error', err?.message || 'Action failed');
    }
  };

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    try {
      await apiClient.sendSupportMessage(subject.trim(), body.trim());
      setSubject('');
      setBody('');
      onToast('success', 'Support message sent to administrator.');
    } catch (err: any) {
      onToast('error', err?.message || 'Could not send message');
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-1.5 flex-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setFilter('all')}
            className={`py-2 rounded-lg text-xs font-semibold ${filter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`py-2 rounded-lg text-xs font-semibold ${filter === 'unread' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
          >
            Unread
          </button>
        </div>
        <button onClick={handleMarkAllRead} className="h-10 px-3 rounded-xl bg-slate-800 text-xs font-medium flex items-center gap-1">
          <CheckCheck className="w-4 h-4 text-emerald-400" /> Read All
        </button>
        <button onClick={load} className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {announcements.map((a) => (
        <div key={a.id} className="bg-indigo-950/60 border border-indigo-500/30 rounded-2xl p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
              <Megaphone className="w-4 h-4" /> {a.title}
            </span>
            <button
              onClick={async () => {
                await apiClient.dismissAnnouncement(a.id);
                setAnnouncements((prev) => prev.filter((x) => x.id !== a.id));
              }}
              className="text-[11px] text-slate-400"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-slate-200">{a.body}</p>
        </div>
      ))}

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
            <Bell className="w-6 h-6 mx-auto mb-2 text-slate-600" />
            {isOnline ? 'No notifications in this view.' : 'Connect to the internet to load notifications.'}
          </div>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              onClick={async () => {
                if (!n.is_read) {
                  await apiClient.markNotificationRead(n.id);
                  await load();
                }
              }}
              className={`rounded-2xl p-3.5 border space-y-1 ${
                n.is_read ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-900 border-indigo-500/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{n.title}</p>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await apiClient.deleteNotification(n.id);
                    await load();
                  }}
                  className="text-slate-500 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-slate-300">{n.body}</p>
              <p className="text-[10px] text-slate-500">
                {n.category} · {new Date(n.created_at).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Contact Admin Support */}
      {isOnline && (
        <form onSubmit={handleSupportSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <MessageSquarePlus className="w-4 h-4 text-cyan-400" /> Message Administrator
          </h4>
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
          />
          <textarea
            rows={2}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe your request..."
            className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
          />
          <button type="submit" className="w-full h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white">
            Send Support Message
          </button>
        </form>
      )}
    </div>
  );
};
