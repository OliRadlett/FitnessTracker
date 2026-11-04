'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, Calendar, Dumbbell, Flag, MapPin, TrendingDown, X } from 'lucide-react';

import { useAuthFetch } from '@/lib/api';
import type { CreateEventPayload, Event, TrainingPlan, TrainingPlanSummary } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { EventForm } from '../peaks/EventForm';
import { EventResultPanel } from '../EventResultPanel';
import { EventAiAnalysisCard } from '../EventAiAnalysisCard';

const EVENT_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  race: Flag,
  ride: Bike,
  lift: Dumbbell,
  other: MapPin,
};

/**
 * Events & races.
 *
 * Kept as its own view rather than folded into the coverage grid. The contract
 * wanted event markers on the strip and no third surface; an event carries a
 * result panel, an AI prep card and a PDF export, which is a surface. Removing a
 * working one to honour a drawing would be the wrong trade — recorded in
 * `PRODUCTION.md`.
 */
export function EventsView({ onBack }: { onBack: () => void }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [linkPlan, setLinkPlan] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: events } = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
    enabled: !!token,
  });

  const { data: plans } = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans'],
    queryFn: () => authFetch<TrainingPlanSummary[]>('/api/v1/training-plans'),
    enabled: !!token,
  });

  const createEvent = useMutation({
    mutationFn: (payload: CreateEventPayload) =>
      authFetch<Event>('/api/v1/events', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowForm(false);
    },
    onError: (e: Error) => setError(e.message || 'Failed to create event'),
  });

  const deleteEvent = useMutation({
    mutationFn: (id: string) => authFetch<void>(`/api/v1/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
    onError: (e: Error) => setError(e.message || 'Failed to delete event'),
  });

  const linkEvent = useMutation({
    mutationFn: ({ planId, eventId }: { planId: string; eventId: string | null }) =>
      authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({ event_id: eventId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan'] });
    },
    onError: (e: Error) => setError(e.message || 'Failed to link event'),
  });

  const downloadReport = async (eventId: string) => {
    try {
      setExportingId(eventId);
      const res = await fetch(`/api/v1/export/event-report/${eventId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `fittrack_event_${eventId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't prepare that report — try again.");
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-accent hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to the plan
      </button>

      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Events</CardTitle>
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              className="min-h-[44px] text-xs text-accent hover:underline"
            >
              + Add Event
            </button>
          </div>
        </CardHeader>

        {showForm && (
          <div className="mb-4">
            <EventForm
              onSubmit={(payload) => createEvent.mutate(payload)}
              onCancel={() => setShowForm(false)}
              pending={createEvent.isPending}
            />
          </div>
        )}

        <div className="space-y-2">
          {events && events.length === 0 && !showForm && (
            <EmptyState
              icon={<Flag className="h-8 w-8 text-muted" />}
              title="No upcoming events"
              description="Add a race or target ride to get taper guidance and race prep."
            />
          )}

          {events?.map((evt) => {
            const Icon = EVENT_TYPE_ICON[evt.event_type] ?? MapPin;
            const linkedPlan = plans?.find((p) => p.event_id === evt.id);
            return (
              <div
                key={evt.id}
                className="rounded-lg border border-surface-light/50 bg-surface-light/20 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Icon className="h-4 w-4" />
                    {evt.name}
                  </span>
                  {confirmingId === evt.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-warning">Confirm?</span>
                      <button
                        type="button"
                        onClick={() => {
                          deleteEvent.mutate(evt.id);
                          setConfirmingId(null);
                        }}
                        className="min-h-[44px] text-xs font-medium text-warning"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="min-h-[44px] text-xs text-muted"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(evt.id)}
                      aria-label={`Delete ${evt.name}`}
                      className="min-h-[44px] min-w-[44px] text-muted hover:text-warning"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                  <Calendar className="h-3 w-3" /> {evt.event_date} ·{' '}
                  {evt.days_until === 0 ? 'Today' : `${evt.days_until} days away`}
                </p>
                {evt.is_in_taper && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                    <TrendingDown className="h-3 w-3" />
                    Taper phase active
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {linkedPlan ? (
                    <>
                      <span className="text-xs text-muted">
                        Linked plan: <span className="text-foreground">{linkedPlan.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => linkEvent.mutate({ planId: linkedPlan.id, eventId: null })}
                        className="min-h-[44px] text-xs text-warning hover:underline"
                      >
                        Unlink
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        value={linkPlan[evt.id] ?? ''}
                        onChange={(e) => setLinkPlan((m) => ({ ...m, [evt.id]: e.target.value }))}
                        aria-label={`Link ${evt.name} to a plan`}
                        className="min-h-[44px] rounded border border-surface-light bg-background px-2 text-xs text-foreground"
                      >
                        <option value="">Link to plan…</option>
                        {plans
                          ?.filter((p) => p.status === 'active' || p.status === 'draft')
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!linkPlan[evt.id]}
                        onClick={() => {
                          const pid = linkPlan[evt.id];
                          if (pid) linkEvent.mutate({ planId: pid, eventId: evt.id });
                        }}
                        className="min-h-[44px] text-xs font-medium text-accent disabled:opacity-40"
                      >
                        Link
                      </button>
                    </>
                  )}
                </div>

                <EventResultPanel event={evt} />
                {evt.days_until !== undefined && evt.days_until <= 7 && (
                  <div className="mt-2">
                    <EventAiAnalysisCard eventId={evt.id} />
                  </div>
                )}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => downloadReport(evt.id)}
                    disabled={exportingId === evt.id}
                    className="min-h-[44px] text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    {exportingId === evt.id ? 'Preparing…' : 'Export Prep PDF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
