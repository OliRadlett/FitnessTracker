// ─── In-app notifications ────────────────────────────────────────────────────

export type NotificationType =
  | 'health_alert'
  | 'pr'
  | 'goal_milestone'
  | 'plan_reminder'
  | 'connection_reauth'
  | 'ftp_stale'
  | 'event_result'
  | 'race_day'
  | 'event_countdown'
  | 'taper_start';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  link: string;
  read: boolean;
  created_at: string | null;
  payload: Record<string, unknown> | null;
}

export interface NotificationPreferences {
  health_alert: boolean;
  pr: boolean;
  goal_milestone: boolean;
  plan_reminder: boolean;
  connection_reauth: boolean;
  ftp_stale: boolean;
  event_result: boolean;
  race_day: boolean;
  event_countdown: boolean;
  taper_start: boolean;
}

export type NotificationPreferencesUpdate = Partial<NotificationPreferences>;