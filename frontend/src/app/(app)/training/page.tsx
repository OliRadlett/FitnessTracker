'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  TrainingPlan,
  TrainingPlanSummary,
  TrainingPlanDay,
  CreateTrainingPlanDayPayload,
  GeneratePlanPayload,
  CreateTrainingPlanPayload,
  UpdateTrainingPlanPayload,
  Event,
  CreateEventPayload,
  ChartData,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';
import { PlanBuilder } from '@/components/training/PlanBuilder';
import { WeeklyView } from '@/components/training/WeeklyView';
import { WorkoutPlanner } from '@/components/training/WorkoutPlanner';
import { WeatherForecast } from '@/components/training/WeatherForecast';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  active: 'bg-green-500/20 text-positive border-green-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  archived: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

const EVENT_TYPE_EMOJI: Record<string, string> = {
  race: '🏁',
  ride: '🚴',
  lift: '🏋️',
  other: '📌',
};

const BLOCK_TYPE_EMOJI: Record<string, string> = {
  base: '🏗️',
  build: '📈',
  peak: '🏔️',
  taper: '📉',
  recovery: '💚',
  custom: '⚙️',
};

/**
 * Map a local day to the PATCH payload. IMPORTANT: only include fields the
 * builder manages — the backend upserts by day_date and DELETES dates missing
 * from the array (so we always send ALL days), while untouched columns
 * (activity_id, lifting_session_id, planned_route_id) are preserved because
 * they are omitted here.
 */
function toDayPayload(d: TrainingPlanDay): CreateTrainingPlanDayPayload {
  return {
    day_date: d.day_date,
    sport: d.sport,
    planned_type: d.planned_type,
    planned_tss: d.planned_tss,
    planned_duration_min: d.planned_duration_min,
    workout_description: d.workout_description,
    planned_focus: d.planned_focus ?? null,
    planned_exercises: d.planned_exercises ?? null,
    planned_volume_kg: d.planned_volume_kg,
    planned_rpe: d.planned_rpe,
    planned_power_watts: d.planned_power_watts,
    planned_zone: d.planned_zone,
    warmup_template_id: d.warmup_template_id ?? null,
    notes: d.notes,
    completed: d.completed,
    // Include link fields so drag-to-reassign preserves them on moved days.
    ...(d.lifting_session_id ? { lifting_session_id: d.lifting_session_id } : {}),
    ...(d.planned_route_id ? { planned_route_id: d.planned_route_id } : {}),
  };
}

export default function TrainingPage() {
  usePageTitle('Training');
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [view, setView] = useState<'builder' | 'week'>('builder');
  const [showEventForm, setShowEventForm] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<CreateEventPayload>({
    name: '',
    event_date: '',
    event_type: 'race',
    taper_days: 14,
  });

  // ── Queries ─────────────────────────────────────────────────────────

  const [actionError, setActionError] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading, isError: plansError, error: plansErrorMessage } = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans'],
    queryFn: () => authFetch<TrainingPlanSummary[]>('/api/v1/training-plans'),
  });

  // Auto-select the most recent active plan on initial load
  useEffect(() => {
    if (plans && !selectedPlanId) {
      const activePlans = plans.filter(p => p.status === 'active')
        .sort((a, b) => {
          const aTime = new Date(a.updated_at ?? a.start_date).getTime();
          const bTime = new Date(b.updated_at ?? b.start_date).getTime();
          return bTime - aTime;
        });
      if (activePlans.length > 0) {
        setSelectedPlanId(activePlans[0].id);
      }
    }
  }, [plans, selectedPlanId]);

   const { data: selectedPlan, isLoading: planLoading } = useQuery<TrainingPlan>({
    queryKey: ['training-plan', selectedPlanId],
    queryFn: () => authFetch<TrainingPlan>(`/api/v1/training-plans/${selectedPlanId}`),
    enabled: !!selectedPlanId,
  });

  const { data: events } = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
  });

  const { data: periodizationChart } = useQuery<ChartData>({
    queryKey: ['chart-periodization'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/periodization?weeks=16'),
  });

  // ── Mutations ───────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (payload: GeneratePlanPayload) =>
      authFetch<TrainingPlan>('/api/v1/training-plans/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      setSelectedPlanId(plan.id);
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to generate plan'),
  });

  const createPlanMutation = useMutation({
    mutationFn: (payload: CreateTrainingPlanPayload) =>
      authFetch<TrainingPlan>('/api/v1/training-plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      setSelectedPlanId(plan.id);
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to create plan'),
  });

  const saveDaysMutation = useMutation({
    mutationFn: ({ planId, days }: { planId: string; days: TrainingPlanDay[] }) =>
      authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({ days: days.map(toDayPayload) }),
      }),
    onSuccess: (_, { planId }) => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to save days'),
  });

  const updatePlanMutation = useMutation({
    mutationFn: ({
      planId,
      payload,
    }: {
      planId: string;
      payload: UpdateTrainingPlanPayload;
    }) =>
      authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_, { planId }) => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to update plan'),
  });

  const deletePlanMutation = useMutation({
    mutationFn: (planId: string) =>
      authFetch<void>(`/api/v1/training-plans/${planId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      setSelectedPlanId(null);
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to delete plan'),
  });

  const createEventMutation = useMutation({
    mutationFn: (payload: CreateEventPayload) =>
      authFetch<Event>('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowEventForm(false);
      setEventForm({ name: '', event_date: '', event_type: 'race', taper_days: 14 });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to create event'),
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) =>
      authFetch<void>(`/api/v1/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err: Error) => setActionError(err.message || 'Failed to delete event'),
  });

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">📋 Training Plans</h1>
        <p className="text-muted mt-1">Plan your training blocks, manage events, and track periodization.</p>
      </div>

      {/* Error banner */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-red-400 hover:text-red-300"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* 7-Day Weather Forecast */}
      <WeatherForecast />

      {/* Plans List + Plan Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Plans List */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Plans</CardTitle>
            </CardHeader>
            <div className="space-y-2">
              {plansLoading && <p className="text-muted text-sm">Loading...</p>}
              {plansError && <p className="text-red-400 text-sm">Failed to load plans: {plansErrorMessage?.message}</p>}
              {plans && plans.length === 0 && (
                <p className="text-muted text-sm text-center py-4">No plans yet. Generate one to get started!</p>
              )}
              {plans?.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlanId(p.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedPlanId === p.id
                      ? 'bg-accent/10 border-accent/30'
                      : 'bg-surface-light/30 border-surface-light/50 hover:bg-surface-light/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium text-sm">{p.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status]}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                    <span>{BLOCK_TYPE_EMOJI[p.plan_type] || '⚙️'} {p.plan_type}</span>
                    <span>{p.start_date} → {p.end_date}</span>
                  </div>
                  <div className="mt-1.5">
                    <div className="w-full bg-surface-light rounded-full h-1.5">
                      <div
                        className="bg-accent rounded-full h-1.5"
                        style={{ width: `${p.day_count > 0 ? (p.completed_days / p.day_count) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted mt-0.5">{p.completed_days}/{p.day_count} days</p>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Events */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>🎯 Events</CardTitle>
                <button
                  onClick={() => setShowEventForm(!showEventForm)}
                  className="text-xs text-accent hover:text-accent/80"
                >
                  + Add Event
                </button>
              </div>
            </CardHeader>

            {showEventForm && (
              <div className="mb-4 p-3 bg-surface-light/30 rounded-lg border border-surface-light/50 space-y-2">
                <input
                  type="text"
                  placeholder="Event name"
                  value={eventForm.name}
                  onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
                />
                <input
                  type="date"
                  value={eventForm.event_date}
                  onChange={e => setEventForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={eventForm.event_type}
                    onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))}
                    className="px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="race">🏁 Race</option>
                    <option value="ride">🚴 Ride</option>
                    <option value="lift">🏋️ Lift</option>
                    <option value="other">📌 Other</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Taper days"
                    value={eventForm.taper_days}
                    onChange={e => setEventForm(f => ({ ...f, taper_days: parseInt(e.target.value) || 14 }))}
                    className="px-2 py-1.5 bg-background border border-surface-light rounded text-white text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => eventForm.name && eventForm.event_date && createEventMutation.mutate(eventForm)}
                    disabled={!eventForm.name || !eventForm.event_date}
                    className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium hover:bg-accent/80 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowEventForm(false)}
                    className="px-3 py-1.5 text-muted text-xs hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {events && events.length === 0 && !showEventForm && (
                <p className="text-muted text-sm text-center py-4">No upcoming events</p>
              )}
              {events?.map(evt => (
                <div
                  key={evt.id}
                  className="p-3 bg-surface-light/30 rounded-lg border border-surface-light/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium text-sm">
                      {EVENT_TYPE_EMOJI[evt.event_type] || '📌'} {evt.name}
                    </span>
                    {confirmingDeleteId === evt.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-warning">Confirm?</span>
                        <button
                          onClick={() => {
                            deleteEventMutation.mutate(evt.id);
                            setConfirmingDeleteId(null);
                          }}
                          className="text-xs text-warning hover:text-red-300 font-medium"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          className="text-xs text-muted hover:text-white"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingDeleteId(evt.id)}
                        className="text-xs text-muted hover:text-warning"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    📅 {evt.event_date} · {evt.days_until === 0 ? 'Today!' : `${evt.days_until} days away`}
                  </p>
                  {evt.is_in_taper && (
                    <p className="text-xs text-amber-400 mt-1">
                      📉 Taper phase active
                    </p>
                  )}
                  {evt.days_until_taper !== undefined && evt.days_until_taper > 0 && (
                    <p className="text-xs text-muted mt-1">
                      Taper starts in {evt.days_until_taper} days
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: Plan Builder / Weekly View — keyed by plan id so state resets when switching plans */}
        <div className="lg:col-span-2">
          {selectedPlanId && (
            <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-surface-light/30 w-fit">
              {(
                [
                  { key: 'builder', label: 'Plan Builder' },
                  { key: 'week', label: 'This Week' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    view === key ? 'bg-accent text-white' : 'text-muted hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {planLoading && selectedPlanId ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent" />
            </div>
          ) : view === 'week' && selectedPlan ? (
            <WeeklyView key={selectedPlanId} plan={selectedPlan} events={events} />
          ) : (
            <PlanBuilder
              key={selectedPlanId ?? 'empty'}
              plan={selectedPlan || undefined}
              events={events}
              onCreatePlan={(payload) => createPlanMutation.mutate(payload)}
              onGeneratePlan={(payload) => generateMutation.mutate(payload)}
              onUpdatePlan={(planId, payload) => updatePlanMutation.mutate({ planId, payload })}
              onSaveDays={(planId, days) => saveDaysMutation.mutate({ planId, days })}
              onDeletePlan={(planId) => deletePlanMutation.mutate(planId)}
              onRefreshPlan={(planId) => {
                queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
                queryClient.invalidateQueries({ queryKey: ['training-plans'] });
              }}
              isSaving={saveDaysMutation.isPending}
              isCreating={createPlanMutation.isPending}
              isGenerating={generateMutation.isPending}
            />
          )}
        </div>
      </div>

      {/* Workout Planner */}
      <WorkoutPlanner />

      {/* Periodization Chart */}
      {periodizationChart && (
        <Card>
          <CardHeader>
            <CardTitle>📊 Periodization — Planned vs Actual</CardTitle>
          </CardHeader>
          <Chart data={periodizationChart} />
        </Card>
      )}
    </div>
  );
}
