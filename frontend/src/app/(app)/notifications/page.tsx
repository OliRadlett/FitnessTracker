'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api';
import type { AppNotification, NotificationType } from '@/lib/api';
import { SEVERITY_BADGE, TYPE_ICONS, TYPE_LABELS } from '@/lib/notificationMeta';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { usePageTitle } from '@/lib/usePageTitle';
import { relativeTime } from '@/lib/analysisRenderer';

type ReadFilter = 'all' | 'unread' | 'read';
type TypeFilter = 'all' | NotificationType;

const READ_FILTERS: { value: ReadFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
];

const PAGE_SIZE = 50;

export default function NotificationsPage() {
  usePageTitle('Notifications');
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const queryKey = ['notifications'] as const;
  const { data: notifications = [], isLoading } = useQuery<AppNotification[]>({
    queryKey,
    queryFn: () => listNotifications(authFetch, 200),
    refetchInterval: 30_000,
    enabled: !!token,
  });

  const noneRead = notifications.every((n) => n.read);

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === 'unread' && n.read) return false;
      if (readFilter === 'read' && !n.read) return false;
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, readFilter, typeFilter]);

  const shown = filtered.slice(0, visibleLimit);
  const hasMore = filtered.length > visibleLimit;

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(authFetch, id),
    onSuccess: (updated) => {
      queryClient.setQueryData<AppNotification[]>(queryKey, (prev) =>
        prev?.map((n) => (n.id === updated.id ? { ...n, read: true } : n)) ?? [],
      );
    },
    onError: (err: Error) => {
      console.error('[NotificationsPage] Mark read failed:', err);
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
      console.error('[NotificationsPage] Mark all read failed:', err);
    },
  });

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notifications) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return (Object.keys(TYPE_LABELS) as NotificationType[]).filter((t) => counts.has(t));
  }, [notifications]);

  function handleOpen(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    if (n.link) router.push(n.link);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-3">
          <CardTitle>Notifications</CardTitle>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {/* Read filter */}
            <div className="flex items-center gap-1 bg-surface rounded-lg p-1" role="group" aria-label="Filter by read status">
              {READ_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setReadFilter(f.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    readFilter === f.value
                      ? 'bg-accent/20 text-accent'
                      : 'text-muted hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {/* Type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              aria-label="Filter by type"
              className="bg-surface border border-surface-light/50 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent"
            >
              <option value="all">All types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {TYPE_ICONS[t]} {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {!noneRead && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="px-2.5 py-1 rounded-lg text-xs text-accent hover:text-accent/80 border border-accent/30 bg-accent/10 font-medium disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>
        </CardHeader>

        <div className="border-t border-surface-light/50">
          {isLoading && notifications.length === 0 && (
            <p className="px-4 py-10 text-sm text-muted text-center">Loading…</p>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-3xl mb-2" aria-hidden="true">📭</p>
              <p className="text-sm text-muted">
                {notifications.length === 0 ? 'No notifications yet' : 'No notifications match the selected filters'}
              </p>
            </div>
          )}
          {shown.map((n) => (
            <button
              key={n.id}
              onClick={() => handleOpen(n)}
              className={`w-full text-left px-4 py-3.5 border-b border-surface-light/30 hover:bg-surface-light/40 transition-colors ${
                n.read ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5" aria-hidden="true">{TYPE_ICONS[n.type]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm text-white ${n.read ? 'font-normal' : 'font-semibold'}`}>
                      {n.title}
                    </p>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${SEVERITY_BADGE[n.severity] ?? SEVERITY_BADGE.info}`}
                    >
                      {n.severity}
                    </span>
                    {TYPE_LABELS[n.type] && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-light/50 text-muted uppercase">
                        {TYPE_LABELS[n.type]}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted mt-1">{n.body}</p>
                  <p className="text-[11px] text-muted/70 mt-1.5">
                    {n.created_at ? relativeTime(n.created_at) : ''}
                  </p>
                </div>
                {!n.read && (
                  <span className="mt-2 w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
                )}
              </div>
            </button>
          ))}
          {hasMore && (
            <div className="p-3 text-center">
              <button
                onClick={() => setVisibleLimit((v) => v + PAGE_SIZE)}
                className="text-xs text-accent hover:text-accent/80 font-medium"
              >
                Show more
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}