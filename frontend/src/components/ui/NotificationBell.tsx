'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api';
import type { AppNotification, NotificationSeverity, NotificationType } from '@/lib/api';
import { relativeTime } from '@/lib/analysisRenderer';

const TYPE_ICONS: Record<NotificationType, string> = {
  health_alert: '🩺',
  pr: '🏆',
  goal_milestone: '🎯',
  plan_reminder: '📋',
};

const SEVERITY_BADGE: Record<NotificationSeverity, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
  success: 'bg-emerald-500/15 text-emerald-400',
  info: 'bg-blue-500/15 text-blue-400',
};

/* ── Component ─────────────────────────────────────────────────────────── */

export function NotificationBell() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const queryKey = ['notifications'] as const;
  const { data: notifications = [], isLoading } = useQuery<AppNotification[]>({
    queryKey,
    queryFn: () => listNotifications(authFetch, 50),
    refetchInterval: 30_000,
    enabled: !!token,
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(authFetch, id),
    onSuccess: (updated) => {
      queryClient.setQueryData<AppNotification[]>(queryKey, (prev) =>
        prev?.map((n) => (n.id === updated.id ? { ...n, read: true } : n)) ?? [],
      );
    },
    onError: (err: Error) => {
      console.error('[NotificationBell] Mark read failed:', err);
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(authFetch),
    onSuccess: () => {
      queryClient.setQueryData<AppNotification[]>(queryKey, (prev) =>
        prev?.map((n) => ({ ...n, read: true })) ?? [],
      );
    },
    onError: (err: Error) => {
      console.error('[NotificationBell] Mark all read failed:', err);
    },
  });

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function handleOpen(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div ref={containerRef} className="fixed top-4 right-4 z-50">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close notifications' : `Open notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        className="relative p-2 rounded-lg bg-surface border border-surface-light/50 text-white hover:bg-surface-light transition-colors"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-surface border border-surface-light/50 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-light/50">
            <h2 className="text-sm font-semibold text-white">Notifications</h2>
            {unreadCount > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="text-xs text-accent hover:text-accent/80 disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading && notifications.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted text-center">Loading…</p>
            )}
            {!isLoading && notifications.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted text-center">No notifications yet</p>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleOpen(n)}
                className={`w-full text-left px-4 py-3 border-b border-surface-light/30 hover:bg-surface-light/40 transition-colors ${
                  n.read ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <span aria-hidden="true">{TYPE_ICONS[n.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm text-white ${n.read ? 'font-normal' : 'font-semibold'}`}>
                        {n.title}
                      </p>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${SEVERITY_BADGE[n.severity] ?? SEVERITY_BADGE.info}`}
                      >
                        {n.severity}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[10px] text-muted/70 mt-1">
                      {n.created_at ? relativeTime(n.created_at) : ''}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}