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
} from './types';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function listNotifications(
  authFetch: AuthFetch,
  limit = 50,
  unreadOnly = false,
): Promise<AppNotification[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (unreadOnly) params.append('unread_only', 'true');
  return authFetch<AppNotification[]>(`/api/v1/notifications?${params.toString()}`);
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