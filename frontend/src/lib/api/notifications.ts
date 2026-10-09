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

// ─── Phase 0 hygiene: plain-language display copy + re-auth grouping ─────────
// Frontend-only. Stored notification rows are never rewritten — these helpers
// decide what the /notifications page renders instead of the raw `body`.

/**
 * Signatures of internal error text that must never reach the user verbatim
 * (e.g. `Deserialization failed because the 'numpy' module is not available
 * in the local environment` from a failed video job). Matched case-insensitively
 * against the stored body; on a hit the page renders `friendlyBodyFor()` instead.
 */
const INTERNAL_ERROR_PATTERNS: RegExp[] = [
  /\bno module named\b/i,
  /\bmodule\b.{0,40}\bnot available\b/i,
  /\bimport\s*error\b/i,
  /\btraceback\b/i,
  /\bdeserialization failed\b/i,
  /\bstack trace\b/i,
  /file\s+"[^"]+",\s*line\s+\d+/i,
  /\bnumpy\b/i,
  /\bpandas\b/i,
  /\bmediapipe\b/i,
  /\bopencv\b/i,
  /\bcv2\b/i,
  /\btorch\b/i,
  /\bcuda\b/i,
  /\bffmpeg\b/i,
  /\bmodal\b.{0,20}\bcontainer\b/i,
  /\blocal environment\b/i,
];

/** True when the stored body leaks internal implementation details. */
export function bodyLeaksInternalError(body: string | null | undefined): boolean {
  if (!body) return false;
  return INTERNAL_ERROR_PATTERNS.some((re) => re.test(body));
}

/**
 * Plain-language replacement for a stored body that leaks internals.
 * Per-type so the copy can name the recovery path; falls back to a generic
 * line for unknown types.
 */
export function friendlyBodyFor(n: AppNotification): string {
  if (n.type === 'video_processed') {
    return 'We couldn\u2019t process your video. Please try again, or re-upload it from your videos.';
  }
  if (n.type === 'connection_reauth') {
    return `${reauthDisplayName(reauthProvider(n))} stopped syncing. Reconnect to keep your data fresh.`;
  }
  return 'Something went wrong on our end \u2014 please try again later.';
}

/** Body to render: the stored text, unless it leaks internals. */
export function displayNotificationBody(n: AppNotification): string {
  if (bodyLeaksInternalError(n.body)) return friendlyBodyFor(n);
  return n.body;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  whoop: 'Whoop',
  withings: 'Withings',
  strava: 'Strava',
  wahoo: 'Wahoo',
  komoot: 'Komoot',
};

/**
 * Normalised provider key for a `connection_reauth` notification — from the
 * `payload.provider` the backend stores, falling back to parsing the title
 * (`"<provider> needs re-authentication"`).
 */
export function reauthProvider(n: AppNotification): string {
  const fromPayload = (n.payload as { provider?: unknown } | null)?.provider;
  if (typeof fromPayload === 'string' && fromPayload.trim()) {
    return fromPayload.trim().toLowerCase();
  }
  const fromTitle = /^\s*(\S+)\s+needs re-authentication/i.exec(n.title ?? '');
  if (fromTitle) return fromTitle[1].toLowerCase();
  return 'unknown';
}

/** Human-readable provider name (`whoop` → `Whoop`). */
export function reauthDisplayName(provider: string): string {
  const key = provider.trim().toLowerCase();
  if (PROVIDER_DISPLAY_NAMES[key]) return PROVIDER_DISPLAY_NAMES[key];
  if (!key || key === 'unknown') return 'A connection';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export interface ReauthGroup {
  provider: string;
  displayName: string;
  items: AppNotification[];
}

/**
 * Group every `connection_reauth` notification by provider, newest first,
 * preserving first-seen (i.e. newest) order. Non-reauth rows are ignored.
 */
export function groupReauthByProvider(notifications: AppNotification[]): ReauthGroup[] {
  const groups = new Map<string, ReauthGroup>();
  for (const n of notifications) {
    if (n.type !== 'connection_reauth') continue;
    const provider = reauthProvider(n);
    const existing = groups.get(provider);
    if (existing) existing.items.push(n);
    else groups.set(provider, { provider, displayName: reauthDisplayName(provider), items: [n] });
  }
  return [...groups.values()];
}

/**
 * Escalating card copy for one provider's re-auth group. `total` is the
 * whole-history count for the provider (may exceed `items.length` when the
 * list is paginated); the card names the full count so repeats stay visible.
 */
export function reauthGroupBody(displayName: string, total: number): string {
  if (total <= 1) return `${displayName} stopped syncing. Reconnect to keep your data fresh.`;
  return (
    `${displayName} still isn\u2019t syncing \u2014 this has come up ${total} times. ` +
    `Reconnect once to clear it.`
  );
}
