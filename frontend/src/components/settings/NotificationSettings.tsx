'use client';

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAuthFetch } from '@/lib/api';
import { getNotificationPreferences, updateNotificationPreferences } from '@/lib/api';
import type { NotificationPreferences, NotificationPreferencesUpdate } from '@/lib/api';

const TOGGLES: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'health_alert',
    label: 'Health alerts',
    description: 'Overtraining, injury, and illness risk alerts',
  },
  {
    key: 'pr',
    label: 'Personal records',
    description: 'When you set a new PR',
  },
  {
    key: 'goal_milestone',
    label: 'Goal milestones',
    description: '50%, 75%, and achieved goal crossings',
  },
  {
    key: 'plan_reminder',
    label: 'Plan reminders',
    description: "Daily morning reminder of today's planned session",
  },
];

export function NotificationSettings() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const queryKey = ['notification-preferences'] as const;

  const { data: prefs } = useQuery<NotificationPreferences>({
    queryKey,
    queryFn: () => getNotificationPreferences(authFetch),
  });

  const update = useMutation({
    mutationFn: (patch: NotificationPreferencesUpdate) =>
      updateNotificationPreferences(authFetch, patch),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  function toggle(key: keyof NotificationPreferences) {
    const current = prefs?.[key] ?? true;
    update.mutate({ [key]: !current });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6 space-y-3">
        {TOGGLES.map(({ key, label, description }) => {
          const enabled = prefs?.[key] ?? true;
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-white font-medium">{label}</p>
                <p className="text-xs text-muted">{description}</p>
              </div>
              <button
                role="switch"
                aria-checked={enabled}
                aria-label={label}
                onClick={() => toggle(key)}
                disabled={update.isPending}
                className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? 'bg-accent' : 'bg-surface-light'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-5' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>
          );
        })}
        <p className="text-xs text-muted pt-1">
          Notifications appear in the bell at the top right of the app.
        </p>
      </div>
    </Card>
  );
}