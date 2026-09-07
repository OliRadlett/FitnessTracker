// Shared display metadata for notification types/severities — used by the
// NotificationBell dropdown and the /notifications page so they stay in sync.
import type { NotificationSeverity, NotificationType } from './api/types/notifications';

export const TYPE_ICONS: Record<NotificationType, string> = {
  health_alert: '🩺',
  pr: '🏆',
  goal_milestone: '🎯',
  plan_reminder: '📋',
  connection_reauth: '🔗',
  ftp_stale: '🚴',
};

export const SEVERITY_BADGE: Record<NotificationSeverity, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
  success: 'bg-emerald-500/15 text-emerald-400',
  info: 'bg-blue-500/15 text-blue-400',
};

export const TYPE_LABELS: Record<NotificationType, string> = {
  health_alert: 'Health',
  pr: 'Personal records',
  goal_milestone: 'Goals',
  plan_reminder: 'Plans',
  connection_reauth: 'Connections',
  ftp_stale: 'Cycling',
};