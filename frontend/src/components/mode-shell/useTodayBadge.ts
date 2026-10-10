'use client';

import { useQuery } from '@tanstack/react-query';
import { getNotificationSummary, useAuthFetch } from '@/lib/api';
import type { NotificationSummary } from '@/lib/api';

/**
 * Phase 2 (plans/ui-redesign-v2.md §2) — TODAY badge count.
 *
 * Notifications live in SYSTEM, but the TODAY rail item / bottom-bar tab
 * carries the whole-history unread count. Reads the EXISTING
 * `['notifications', 'summary']` query with the same key + refetch interval
 * as `NotificationBell`, so all three share one cache entry and no new
 * endpoint or computation is involved.
 */
export function useTodayBadge(): number {
  const { authFetch, token } = useAuthFetch();
  const { data: summary } = useQuery<NotificationSummary>({
    queryKey: ['notifications', 'summary'],
    queryFn: () => getNotificationSummary(authFetch),
    refetchInterval: 30_000,
    enabled: !!token,
  });
  return summary?.unread ?? 0;
}
