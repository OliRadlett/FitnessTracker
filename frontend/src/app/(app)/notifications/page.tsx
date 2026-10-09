'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import {
  displayNotificationBody,
  getNotificationSummary,
  groupReauthByProvider,
  healthAlertLink,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  reauthGroupBody,
  reauthProvider,
  summarizeNotificationBody,
} from '@/lib/api';
import type { AppNotification, NotificationSummary, NotificationType, ReauthGroup } from '@/lib/api';
import { SEVERITY_BADGE, TYPE_ICONS, TYPE_LABELS } from '@/lib/notificationMeta';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRow } from '@/components/ui/Skeleton';
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Keys stay under the `['notifications']` prefix so an existing
  // `invalidateQueries({ queryKey: ['notifications'] })` (EventResultPanel,
  // the bell) still cascades to the page's list and summary.
  const summaryKey = ['notifications', 'summary'] as const;

  // Filters are applied server-side: filtering a 200-row client-side cap meant
  // "unread" only ever searched the most recent 200 notifications.
  const readParam = readFilter === 'all' ? undefined : readFilter === 'read';
  const typeParam = typeFilter === 'all' ? undefined : typeFilter;
  const listKey = ['notifications', readParam, typeParam] as const;

  const { data: notifications = [], isLoading, isError: notificationsError } = useQuery<AppNotification[]>({
    queryKey: listKey,
    queryFn: () =>
      listNotifications(authFetch, { limit: 200, read: readParam, type: typeParam }),
    refetchInterval: 30_000,
    enabled: !!token,
  });

  // Whole-history counts drive the filter chips and the unread badge.
  const { data: summary } = useQuery<NotificationSummary>({
    queryKey: summaryKey,
    queryFn: () => getNotificationSummary(authFetch),
    refetchInterval: 30_000,
    enabled: !!token,
  });

  const hasQueryError = notificationsError;

  // Fall back to the loaded rows so the UI is still correct before / if the
  // summary request fails — it is a different key and can fail on its own.
  const unreadTotal = summary?.unread ?? notifications.filter((n) => !n.read).length;
  const noneRead = unreadTotal === 0;

  // The server already applied the filters, so the response is the filtered set.
  const shown = notifications.slice(0, visibleLimit);
  const hasMore = notifications.length > visibleLimit;

  // A new filter is a new result set — don't inherit the old "show more" depth.
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [readFilter, typeFilter]);

  // Group consecutive identical notifications (2.4) — e.g. five "Video
  // processed" rows collapse into one expandable group.
  // `connection_reauth` rows are excluded here: they are deduped globally by
  // provider (Phase 0) into one escalating card each, no matter how far apart
  // the repeats sit in the list.
  type Row =
    | { kind: 'single'; n: AppNotification }
    | { kind: 'group'; key: string; items: AppNotification[] }
    | { kind: 'reauth'; group: ReauthGroup; total: number };
  const rows = useMemo<Row[]>(() => {
    // One escalating card per provider, placed where its newest alert sits.
    const reauthGroups = new Map(
      groupReauthByProvider(shown).map((g) => [g.provider, g]),
    );
    // Escalation counts come from the whole loaded history, not just the
    // visible slice, so "6 times" stays honest under "Show more" paging.
    const totals = new Map(
      groupReauthByProvider(notifications).map((g) => [g.provider, g.items.length]),
    );
    const emittedReauth = new Set<string>();
    const out: Row[] = [];
    for (const n of shown) {
      if (n.type === 'connection_reauth') {
        const key = reauthProvider(n);
        if (emittedReauth.has(key)) continue;
        emittedReauth.add(key);
        const group = reauthGroups.get(key);
        if (!group) continue;
        out.push({ kind: 'reauth', group, total: totals.get(key) ?? group.items.length });
        continue;
      }
      const last = out[out.length - 1];
      if (
        last?.kind === 'group' &&
        last.items[0].type === n.type &&
        last.items[0].title === n.title
      ) {
        last.items.push(n);
      } else if (
        last?.kind === 'single' &&
        last.n.type === n.type &&
        last.n.title === n.title
      ) {
        out[out.length - 1] = { kind: 'group', key: `${n.type}:${n.title}`, items: [last.n, n] };
      } else {
        out.push({ kind: 'single', n });
      }
    }
    return out;
  }, [shown, notifications]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The list is refetched rather than patched in place: the rows are now the
  // *server's* filtered set, so a row that just became read has to disappear
  // from an "unread" filter — and appear in a "read" one.
  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(authFetch, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (err: Error) => {
      console.error('[NotificationsPage] Mark read failed:', err);
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(authFetch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (err: Error) => {
      console.error('[NotificationsPage] Mark all read failed:', err);
    },
  });

  // Dismissing one escalating re-auth card clears every repeat behind it — a
  // fresh outage mints a fresh notification (per-episode dedup_key), so the
  // old repeats never need to resurface.
  const markGroupRead = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => markNotificationRead(authFetch, id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (err: Error) => {
      console.error('[NotificationsPage] Mark group read failed:', err);
    },
  });

  // Chip labels come from the summary (all history), not the loaded slice, so
  // the menu doesn't lose types that fall outside the current page.
  const typeOptions = useMemo(() => {
    const counts = summary?.by_type ?? {};
    const known = new Set(Object.keys(TYPE_LABELS) as NotificationType[]);
    const fromSummary = (Object.keys(counts) as NotificationType[]).filter(
      (t) => counts[t] > 0 && known.has(t),
    );
    if (fromSummary.length) return fromSummary;
    // Fallback while the summary is still loading.
    const local = new Set(notifications.map((n) => n.type));
    return (Object.keys(TYPE_LABELS) as NotificationType[]).filter((t) => local.has(t));
  }, [summary, notifications]);

  function handleOpen(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    // Phase 2: health-alert rows deep-link to Health (`?alert=`) — the full
    // text lives there; every other type keeps its stored link.
    const target = n.type === 'health_alert' ? healthAlertLink(n) : n.link;
    if (target) router.push(target);
  }

  function handleReconnect(group: ReauthGroup) {
    markGroupRead.mutate(group.items.map((i) => i.id));
    router.push(group.items[0]?.link || '/settings');
  }

  function renderItem(n: AppNotification) {
    // Phase 2 merge-vs-link (§1.2): health-alert rows carry a summary — the
    // full text lives once on Health behind the row's deep link.
    const isHealthAlert = n.type === 'health_alert';
    const body = isHealthAlert ? summarizeNotificationBody(n) : displayNotificationBody(n);
    return (
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
              <p className={`text-sm text-foreground ${n.read ? 'font-normal' : 'font-semibold'}`}>
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
            <p className="text-sm text-muted mt-1">{body}</p>
            {isHealthAlert && (
              <p className="text-xs text-accent mt-1">View full text on Health →</p>
            )}
            <p className="text-[11px] text-muted/70 mt-1.5">
              {n.created_at ? relativeTime(n.created_at) : ''}
            </p>
          </div>
          {!n.read && (
            <span className="mt-2 w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
          )}
        </div>
      </button>
    );
  }

  // One escalating card per provider for repeated re-auth alerts: plain-language
  // copy with the repeat count, a single Reconnect CTA, and the individual
  // alerts behind an expandable details section.
  function renderReauthGroup(group: ReauthGroup, total: number) {
    const key = `reauth:${group.provider}`;
    const expanded = expandedGroups.has(key);
    const anyUnread = group.items.some((i) => !i.read);
    const latest = group.items[0]?.created_at ? relativeTime(group.items[0].created_at!) : '';
    const severity: AppNotification['severity'] = group.items.some((i) => i.severity === 'error')
      ? 'error'
      : (group.items[0]?.severity ?? 'warning');
    return (
      <div key={key} className="border-b border-surface-light/30">
        <div className={`px-4 py-3.5 ${anyUnread ? '' : 'opacity-60'}`}>
          <div className="flex items-start gap-3">
            <span className="text-xl mt-0.5" aria-hidden="true">{TYPE_ICONS.connection_reauth}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`text-sm text-foreground ${anyUnread ? 'font-semibold' : 'font-normal'}`}>
                  {group.displayName} needs reconnecting
                </p>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.info}`}
                >
                  {severity}
                </span>
                {TYPE_LABELS.connection_reauth && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-light/50 text-muted uppercase">
                    {TYPE_LABELS.connection_reauth}
                  </span>
                )}
                {total > 1 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/15 text-warning tabular-nums">
                    {total} alerts
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-1">{reauthGroupBody(group.displayName, total)}</p>
              <p className="text-[11px] text-muted/70 mt-1.5">
                {latest}
                {total > group.items.length && (
                  <span className="tabular-nums"> · showing {group.items.length} of {total}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <button
                  onClick={() => handleReconnect(group)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors"
                >
                  Reconnect
                </button>
                {group.items.length > 1 && (
                  <button
                    onClick={() => toggleGroup(key)}
                    aria-expanded={expanded}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
                  >
                    {expanded ? 'Hide details ▾' : `Show all ${group.items.length} ▸`}
                  </button>
                )}
              </div>
            </div>
            {anyUnread && (
              <span className="mt-2 w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
            )}
          </div>
        </div>
        {expanded && (
          <div className="border-t border-surface-light/20">
            {group.items.map((n) => renderItem(n))}
          </div>
        )}
      </div>
    );
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
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {f.label}
                  {/* Authoritative whole-history count, not the loaded page. */}
                  {f.value === 'unread' && unreadTotal > 0 && (
                    <span className="ml-1 tabular-nums opacity-70">{unreadTotal}</span>
                  )}
                </button>
              ))}
            </div>
            {/* Type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              aria-label="Filter by type"
              className="bg-surface border border-surface-light/50 rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
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

        <ErrorState variant="inline" show={hasQueryError} message="Notifications failed to load." />

        <div className="border-t border-surface-light/50">
          {isLoading && notifications.length === 0 && (
            <div className="px-4 py-4 space-y-3" aria-label="Loading notifications">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          )}
          {!isLoading && notifications.length === 0 && (
            <div className="p-8">
              <EmptyState
                icon="📭"
                title={
                  (summary ? summary.total === 0 : notifications.length === 0)
                    ? 'No notifications yet'
                    : 'No matching notifications'
                }
                description={
                  (summary ? summary.total === 0 : notifications.length === 0)
                    ? 'Training milestones, health alerts, and sync notices will appear here.'
                    : 'Try clearing the read-status or type filters above.'
                }
                action={{ label: 'Notification settings', href: '/settings' }}
              />
            </div>
          )}
          {rows.map((row) =>
            row.kind === 'single' ? (
              renderItem(row.n)
            ) : row.kind === 'reauth' ? (
              renderReauthGroup(row.group, row.total)
            ) : (
              <div key={row.key} className="border-b border-surface-light/30">
                <button
                  onClick={() => toggleGroup(row.key)}
                  aria-expanded={expandedGroups.has(row.key)}
                  className="w-full text-left px-4 py-3.5 hover:bg-surface-light/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl mt-0.5" aria-hidden="true">{TYPE_ICONS[row.items[0].type]}</span>
                    <p className="text-sm text-foreground font-medium flex-1 min-w-0 truncate">
                      {row.items[0].title} · {row.items.length}
                    </p>
                    <span className="text-xs text-accent shrink-0" aria-hidden>
                      {expandedGroups.has(row.key) ? '▾' : '▸'}
                    </span>
                    {row.items.some((i) => !i.read) && (
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden="true" />
                    )}
                  </div>
                </button>
                {expandedGroups.has(row.key) && (
                  <div className="border-t border-surface-light/20">
                    {row.items.map((n) => renderItem(n))}
                  </div>
                )}
              </div>
            ),
          )}
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