// Notifications API client.
//
// Follows the codebase "inline authFetch" pattern (see goals.ts): each
// function takes the `authFetch` returned by `useAuthFetch()` as its first
// argument so components can call them directly in React Query query/mutation
// functions.
import type {
  AppNotification,
  NotificationPreferences,
  NotificationPreferencesUpdate,
  NotificationSummary,
  NotificationType,
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface NotificationFilters {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  /** `true` = read only, `false` = unread only, `undefined` = both. */
  read?: boolean;
  type?: NotificationType;
}

/**
 * Notifications are filtered server-side so a filter isn't limited to the
 * newest page — filtering a 200-row client-side cap meant "unread" only ever
 * searched the most recent 200 notifications.
 */
export async function listNotifications(
  authFetch: AuthFetch,
  { limit = 50, offset = 0, unreadOnly = false, read, type }: NotificationFilters = {},
): Promise<AppNotification[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) params.append('offset', String(offset));
  if (unreadOnly) params.append('unread_only', 'true');
  if (read !== undefined) params.append('read', String(read));
  if (type) params.append('type', type);
  return authFetch<AppNotification[]>(`/api/v1/notifications?${params.toString()}`);
}

/** Total/unread counts plus a per-type breakdown across the whole history. */
export async function getNotificationSummary(
  authFetch: AuthFetch,
): Promise<NotificationSummary> {
  return authFetch<NotificationSummary>('/api/v1/notifications/summary');
}

export async function markNotificationRead(
  authFetch: AuthFetch,
  id: string,
): Promise<AppNotification> {
  return authFetch<AppNotification>(`/api/v1/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export async function markAllNotificationsRead(
  authFetch: AuthFetch,
): Promise<{ marked: number }> {
  return authFetch<{ marked: number }>('/api/v1/notifications/read-all', {
    method: 'POST',
  });
}

export async function getNotificationPreferences(
  authFetch: AuthFetch,
): Promise<NotificationPreferences> {
  return authFetch<NotificationPreferences>('/api/v1/notifications/preferences');
}

export async function updateNotificationPreferences(
  authFetch: AuthFetch,
  patch: NotificationPreferencesUpdate,
): Promise<NotificationPreferences> {
  return authFetch<NotificationPreferences>('/api/v1/notifications/preferences', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}