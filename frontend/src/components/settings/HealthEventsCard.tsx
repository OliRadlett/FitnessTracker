'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import {
  createHealthEvent,
  deleteHealthEvent,
  getHealthEventValidation,
  getHealthEvents,
  useAuthFetch,
} from '@/lib/api';
import type { HealthEvent, HealthEventSeverity, HealthEventType } from '@/lib/api';

const EVENT_TYPES: { value: HealthEventType; label: string }[] = [
  { value: 'illness', label: 'Illness' },
  { value: 'injury', label: 'Injury' },
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'other', label: 'Other' },
];

const SEVERITIES: { value: HealthEventSeverity; label: string }[] = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
];

function formatDay(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Self-reported outcome labels. They let the alert engines be measured against
 * something real; they do not auto-tune any score.
 */
export function HealthEventsCard() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [eventType, setEventType] = useState<HealthEventType>('illness');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [severity, setSeverity] = useState<HealthEventSeverity>('moderate');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const eventsQuery = useQuery<HealthEvent[]>({
    queryKey: ['health-events'],
    queryFn: () => getHealthEvents(authFetch),
  });
  const validationQuery = useQuery({
    queryKey: ['health-event-validation'],
    queryFn: () => getHealthEventValidation(authFetch),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['health-events'] });
    await queryClient.invalidateQueries({ queryKey: ['health-event-validation'] });
  };

  const add = async () => {
    if (!startDate) {
      toast.error('Choose a start date.');
      return;
    }
    setSaving(true);
    try {
      await createHealthEvent(authFetch, {
        event_type: eventType,
        start_date: startDate,
        end_date: endDate || null,
        severity,
        note: note.trim() || null,
      });
      setStartDate('');
      setEndDate('');
      setNote('');
      await refresh();
      toast.success('Health period marked');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save the period.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteHealthEvent(authFetch, id);
      await refresh();
      toast.success('Period removed');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not remove the period.');
    }
  };

  const validation = validationQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health periods</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6 space-y-4">
        <p className="text-sm text-muted">
          Mark illness, injury or fatigue periods. They are used to check whether the health alerts
          fired at the right time; they do not change your scores automatically.
        </p>

        {validation && validation.events > 0 ? (
          <p className="text-xs text-muted/70">
            {validation.matched_alerts} of {validation.alerts} alerts fall inside a marked period
            {validation.alert_precision != null
              ? ` (${Math.round(validation.alert_precision * 100)}%)`
              : ''}
            . {validation.covered_events} of {validation.events} periods had an overlapping alert.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Type
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value as HealthEventType)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            >
              {EVENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Severity
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as HealthEventSeverity)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            >
              {SEVERITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Start
            <input
              type="date"
              value={startDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            End (blank = ongoing)
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
            Note (optional)
            <input
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-lg border border-white/[0.08] bg-surface-light/30 px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={add}
            disabled={saving}
            className="rounded-lg bg-accent/20 px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Mark period'}
          </button>
        </div>

        {eventsQuery.data && eventsQuery.data.length > 0 ? (
          <ul className="divide-y divide-white/[0.06]">
            {eventsQuery.data.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm text-foreground">
                    {event.event_type[0].toUpperCase() + event.event_type.slice(1)} ·{' '}
                    <span className="text-muted">{event.severity}</span>
                  </p>
                  <p className="text-xs text-muted/70">
                    {formatDay(event.start_date)} –{' '}
                    {event.end_date ? formatDay(event.end_date) : 'ongoing'}
                    {event.note ? ` · ${event.note}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(event.id)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted/60">No periods marked yet.</p>
        )}
      </div>
    </Card>
  );
}
