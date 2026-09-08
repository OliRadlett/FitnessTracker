'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAuthFetch } from '@/lib/api';
import {
  getHealthPreferences,
  updateHealthPreferences,
  HEALTH_SIGNAL_LABELS,
} from '@/lib/api';
import type {
  HealthPreferences,
  HealthPreferencesUpdate,
} from '@/lib/api';

const SNOOZE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No snooze' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

const THRESHOLD_FIELDS: Record<
  string,
  { key: string; label: string; suffix: string; step: number }[]
> = {
  performance_decline: [
    { key: 'drop_pct', label: 'FTP drop threshold', suffix: '%', step: 1 },
    { key: 'critical_pct', label: 'Critical FTP drop', suffix: '%', step: 1 },
  ],
  sleep_consistency: [
    { key: 'stddev_min', label: 'Variability threshold', suffix: 'min', step: 5 },
    { key: 'critical_stddev_min', label: 'Critical variability', suffix: 'min', step: 5 },
  ],
  resting_hr_elevation: [
    { key: 'bpm', label: 'Elevation threshold', suffix: 'bpm', step: 1 },
    { key: 'critical_bpm', label: 'Critical elevation', suffix: 'bpm', step: 1 },
  ],
};

function isoDateIn(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function HealthAlertSettings() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const queryKey = ['health-preferences'] as const;

  const { data: prefs } = useQuery<HealthPreferences>({
    queryKey,
    queryFn: () => getHealthPreferences(authFetch),
    enabled: !!token,
  });

  const [draft, setDraft] = useState<HealthPreferences | null>(null);
  useEffect(() => {
    if (prefs && !draft) setDraft(prefs);
  }, [prefs, draft]);

  const update = useMutation({
    mutationFn: (patch: HealthPreferencesUpdate) =>
      updateHealthPreferences(authFetch, patch),
    onSuccess: (next: HealthPreferences) => {
      queryClient.setQueryData(queryKey, next);
      setDraft(next);
    },
    onError: (err: Error) => {
      console.error('[HealthAlertSettings] Update failed:', err);
    },
  });

  if (!prefs || !draft) return null;

  const current: HealthPreferences = draft;

  function apply(patch: HealthPreferencesUpdate) {
    update.mutate(patch);
    // Optimistically reflect the change so toggles respond immediately.
    setDraft(prev =>
      prev
        ? {
            ...prev,
            disabled: patch.disabled ?? prev.disabled,
            snoozed: patch.snoozed ?? prev.snoozed,
            thresholds: patch.thresholds ?? prev.thresholds,
          }
        : prev,
    );
  }

  function toggle(type: string, enabled: boolean) {
    apply({
      disabled: enabled
        ? current.disabled.filter(t => t !== type)
        : [...new Set([...current.disabled, type])],
    });
  }

  function snooze(type: string, days: string) {
    const snoozed = { ...current.snoozed };
    if (!days) delete snoozed[type];
    else snoozed[type] = isoDateIn(Number(days));
    apply({ snoozed });
  }

  function setThreshold(type: string, field: string, value: string) {
    const num = parseFloat(value);
    apply({
      thresholds: {
        ...current.thresholds,
        [type]: {
          ...(current.thresholds[type] ?? {}),
          [field]: Number.isFinite(num) && num >= 0 ? num : 0,
        },
      },
    });
  }

  const pending = update.isPending;

  function snoozeDaysFor(type: string): string {
    const until = current.snoozed[type];
    if (!until) return '';
    const days = Math.round(
      (new Date(until.slice(0, 10)).getTime() - Date.now()) / 86400000,
    );
    if (days <= 0) return '';
    if (days <= 3) return '3';
    if (days <= 7) return '7';
    if (days <= 14) return '14';
    return '30';
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health alerts</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6 space-y-3">
        <p className="text-xs text-muted">
          Tune which health alerts are active, snooze them, and adjust the
          sensitivity of the newer performance / sleep / resting-HR signals.
          Thresholds apply at the next analysis run.
        </p>
        {current.signal_types.map(type => {
          const meta = HEALTH_SIGNAL_LABELS[type];
          if (!meta) return null;
          const enabled = !current.disabled.includes(type);
          return (
            <div key={type} className="py-1 border-b border-surface-light/40 last:border-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm text-white font-medium">{meta.label}</p>
                  <p className="text-xs text-muted">{meta.description}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <select
                    value={snoozeDaysFor(type)}
                    onChange={e => snooze(type, e.target.value)}
                    disabled={!enabled || pending}
                    aria-label={`Snooze ${meta.label}`}
                    className="px-2 py-1 text-xs bg-background border border-surface-light rounded text-white focus:outline-none focus:border-accent disabled:opacity-50"
                  >
                    {SNOOZE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    aria-label={meta.label}
                    onClick={() => toggle(type, !enabled)}
                    disabled={pending}
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
              </div>
              {!enabled && (
                <div className="flex items-center justify-between gap-4 mt-1">
                  {THRESHOLD_FIELDS[type]?.map(f => (
                    <label key={f.key} className="text-xs text-muted flex items-center gap-2">
                      {f.label}
                      <input
                        type="number"
                        step={f.step}
                        min={0}
                        value={current.thresholds[type]?.[f.key] ?? 0}
                        disabled
                        className="w-20 px-2 py-1 bg-surface-light/30 border border-surface-light rounded text-white text-xs focus:outline-none disabled:opacity-40"
                      />
                      <span>{f.suffix}</span>
                    </label>
                  ))}
                </div>
              )}
              {enabled && THRESHOLD_FIELDS[type] && (
                <>
                  {current.snoozed[type] && (
                    <p className="text-xs text-positive mt-1">
                      Snoozed until {current.snoozed[type].slice(0, 10)}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-4 mt-2 ml-1">
                    {THRESHOLD_FIELDS[type].map(f => (
                      <label key={f.key} className="text-xs text-muted flex items-center gap-2">
                        {f.label}
                        <input
                          type="number"
                          step={f.step}
                          min={0}
                          value={current.thresholds[type]?.[f.key] ?? 0}
                          onChange={e => setThreshold(type, f.key, e.target.value)}
                          disabled={pending}
                          className="w-20 px-2 py-1 bg-background border border-surface-light rounded text-white text-xs focus:outline-none focus:border-accent disabled:opacity-50"
                        />
                        <span>{f.suffix}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}