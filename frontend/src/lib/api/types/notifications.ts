// ─── In-app notifications ────────────────────────────────────────────────────

export type NotificationType = 'health_alert' | 'pr' | 'goal_milestone' | 'plan_reminder';
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
}

export type NotificationPreferencesUpdate = Partial<NotificationPreferences>;