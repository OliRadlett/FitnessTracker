'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import {
  Flag,
  Bike,
  Dumbbell,
  MapPin,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Mountain,
  Heart,
  Settings,
  Calendar,
  X,
} from 'lucide-react';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  TrainingPlan,
  TrainingPlanDay,
  Event,
  CreateEventPayload,
  CreateTrainingPlanDayPayload,
  GeneratePlanPayload,
  CreateTrainingPlanPayload,
  UpdateTrainingPlanPayload,
  ChartData,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SyncBadge } from '@/components/athlete';
import { LoadSummary } from '@/components/dashboard/LoadSummary';
import { useDashboardData } from '@/lib/dashboard/useDashboardData';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Chart } from '@/components/charts/Chart';
import { PlanBuilder } from '@/components/training/PlanBuilder';
import { WeeklyView } from '@/components/training/WeeklyView';
import { WorkoutPlanner } from '@/components/training/WorkoutPlanner';
import { WeatherForecast } from '@/components/training/WeatherForecast';
import { EventResultPanel } from '@/components/training/EventResultPanel';
import { EventAiAnalysisCard } from '@/components/training/EventAiAnalysisCard';
import { PlanSpine } from '@/components/training/PlanSpine';
import { ModeSwitch } from '@/components/training/ModeSwitch';
import { useTrainingShell } from '@/lib/training/useTrainingShell';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-surface-light/20 text-muted border-muted/30',
  active: 'bg-green-500/20 text-positive border-green-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  archived: 'bg-surface-light/20 text-muted border-muted/30',
};

const EVENT_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  race: Flag,
  ride: Bike,
  lift: Dumbbell,
  other: MapPin,
};

const BLOCK_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  base: BarChart3,
  build: TrendingUp,
  peak: Mountain,
  taper: TrendingDown,
  recovery: Heart,
  custom: Settings,
  strength: Dumbbell,
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
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const dashboardData = useDashboardData();

  const {
    mode,
    setMode,
    plans,
    plansLoading,
    plansError,
    refetchPlans,
    selectedPlanId,
    setSelectedPlanId,
    selectedPlan,
    planLoading,
    highlightDate,
  } = useTrainingShell();

  // Plan mode holds the temporary Build | Week toggle until Phase 1 unifies the
  // editor. A `?day=` deep link lands in the week view.
  const [planView, setPlanView] = useState<'builder' | 'week'>('builder');
  useEffect(() => {
    if (highlightDate) setPlanView('week');
  }, [highlightDate]);

  const [showEventForm, setShowEventForm] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [exportingEventId, setExportingEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<CreateEventPayload>({
    name: '',
    event_date: '',
    event_type: 'race',
    taper_days: 14,
  });

  // ── Queries ─────────────────────────────────────────────────────────
  const { data: events } = useQuery<Event[]>({
    queryKey: ['events', 'upcoming'],
    queryFn: () => authFetch<Event[]>('/api/v1/events?upcoming_only=true'),
    enabled: !!token,
  });

  const { data: periodizationChart } = useQuery<ChartData>({
    queryKey: ['chart-periodization', 16],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/periodization?weeks=16'),
    enabled: !!token,
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
      setMode('plan');
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
      setMode('plan');
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
    mutationFn: ({ planId, payload }: { planId: string; payload: UpdateTrainingPlanPayload }) =>
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
    onError: (err: Error) => setActionError(err.message || 'Failed to delete event'),
  });

  const downloadEventReport = async (eventId: string) => {
    try {
      setExportingEventId(eventId);
      const res = await fetch(`/api/v1/export/event-report/${eventId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fittrack_event_${eventId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download event report', err);
      setActionError("Couldn't prepare that report — try again.");
    } finally {
      setExportingEventId(null);
    }
  };

  const openPlan = (id: string) => {
    setSelectedPlanId(id);
    setMode('plan');
  };

  const planEditorProps = {
    events,
    onCreatePlan: (payload: CreateTrainingPlanPayload) => createPlanMutation.mutate(payload),
    onGeneratePlan: (payload: GeneratePlanPayload) => generateMutation.mutate(payload),
    onUpdatePlan: (planId: string, payload: UpdateTrainingPlanPayload) =>
      updatePlanMutation.mutate({ planId, payload }),
    onSaveDays: (planId: string, days: TrainingPlanDay[]) =>
      saveDaysMutation.mutate({ planId, days }),
    onDeletePlan: (planId: string) => deletePlanMutation.mutate(planId),
    onRefreshPlan: (planId: string) => {
      queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
    },
    isSaving: saveDaysMutation.isPending,
    isCreating: createPlanMutation.isPending,
    isGenerating: generateMutation.isPending,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Training"
        subtitle="Author the plan, run the week, review the evidence, and manage your peaks."
      />

      <div id="load-summary" className="scroll-mt-4">
        <LoadSummary
          data={dashboardData}
          syncBadge={
            <SyncBadge
              lastSyncedAt={dashboardData.lastSyncedAt}
              stale={dashboardData.staleProviders.length > 0}
              provider={dashboardData.staleProviders[0]?.provider ?? null}
            />
          }
        />
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-warning hover:text-warning/80"
            aria-label="Dismiss error"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Plan spine + mode switch — frames every mode ─────────────── */}
      <PlanSpine
        plan={selectedPlan ?? null}
        plans={plans}
        plansLoading={plansLoading}
        onSelectPlan={openPlan}
        onOpenPlans={() => setMode('plans')}
      />

      <ModeSwitch mode={mode} onChange={setMode} />

      {/* ── Plan mode — author + run. Temporary Build | Week toggle until
             Phase 1 collapses the two editors into one. ─────────────── */}
      {mode === 'plan' && (
        <div className="space-y-4">
          <WeatherForecast />

          {planLoading && selectedPlanId ? (
            <div className="space-y-3" aria-label="Loading plan">
              <SkeletonRow className="h-20" />
              <SkeletonRow className="h-40" />
            </div>
          ) : selectedPlan ? (
            <>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-light/30 w-fit">
                {(
                  [
                    { key: 'builder', label: 'Plan Builder' },
                    { key: 'week', label: 'This Week' },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setPlanView(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      planView === key ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {planView === 'week' ? (
                <WeeklyView
                  key={selectedPlanId}
                  plan={selectedPlan}
                  events={events}
                  highlightDate={highlightDate}
                />
              ) : (
                <PlanBuilder key={selectedPlanId} plan={selectedPlan} {...planEditorProps} />
              )}
            </>
          ) : (
            <PlanBuilder
              key="empty"
              plan={undefined}
              {...planEditorProps}
              onRefreshPlan={() => refetchPlans()}
            />
          )}

          {/* RM1: the standalone Workout Planner (absorbed into the day editor
              in Phase 1). Kept here for parity until then. */}
          <WorkoutPlanner planId={selectedPlan?.id ?? null} planDays={selectedPlan?.days} />
        </div>
      )}

      {/* ── Review mode — the evidence. Moves past action surfaces. ──── */}
      {mode === 'review' && (
        <div className="space-y-4">
          {periodizationChart ? (
            <Card>
              <CardHeader>
                <CardTitle>Periodization — Planned vs Actual</CardTitle>
              </CardHeader>
              <Chart data={periodizationChart} />
            </Card>
          ) : (
            <Card>
              <div className="space-y-2" aria-busy="true">
                <SkeletonRow className="h-8" />
                <SkeletonRow className="h-40" />
              </div>
            </Card>
          )}
          <p className="text-xs text-muted">
            Conformity trend, adaptive advice and load analytics land here in Phase 2.
          </p>
        </div>
      )}

      {/* ── Peaks mode — events / races / lifts (moved off the sidebar) ── */}
      {mode === 'peaks' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Events</CardTitle>
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
                onChange={(e) => setEventForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-2 py-1.5 bg-background border border-surface-light rounded text-foreground text-sm focus:outline-none focus:border-accent"
              />
              <input
                type="date"
                value={eventForm.event_date}
                onChange={(e) => setEventForm((f) => ({ ...f, event_date: e.target.value }))}
                className="w-full px-2 py-1.5 bg-background border border-surface-light rounded text-foreground text-sm focus:outline-none focus:border-accent"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={eventForm.event_type}
                  onChange={(e) => setEventForm((f) => ({ ...f, event_type: e.target.value }))}
                  className="px-2 py-1.5 min-h-[44px] bg-background border border-surface-light rounded text-foreground text-sm focus:outline-none focus:border-accent"
                >
                  <option value="race">Race</option>
                  <option value="ride">Ride</option>
                  <option value="lift">Lift</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="number"
                  placeholder="Taper days"
                  value={eventForm.taper_days}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, taper_days: parseInt(e.target.value) || 14 }))
                  }
                  className="px-2 py-1.5 min-h-[44px] bg-background border border-surface-light rounded text-foreground text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    eventForm.name && eventForm.event_date && createEventMutation.mutate(eventForm)
                  }
                  disabled={!eventForm.name || !eventForm.event_date}
                  className="px-3 py-1.5 min-h-[44px] bg-accent text-white rounded text-xs font-medium hover:bg-accent/80 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowEventForm(false)}
                  className="px-3 py-1.5 min-h-[44px] text-muted text-xs hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {events && events.length === 0 && !showEventForm && (
              <EmptyState
                icon={<Flag className="w-8 h-8 text-muted" />}
                title="No upcoming events"
                description="Add a race or target ride to get taper guidance and race prep."
              />
            )}
            {events?.map((evt) => (
              <div
                key={evt.id}
                className="p-3 bg-surface-light/30 rounded-lg border border-surface-light/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-foreground font-medium text-sm flex items-center gap-2">
                    {(() => {
                      const Icon = EVENT_TYPE_ICON[evt.event_type];
                      return Icon ? <Icon className="w-4 h-4" /> : <MapPin className="w-4 h-4" />;
                    })()}
                    {evt.name}
                  </span>
                  {confirmingDeleteId === evt.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-warning">Confirm?</span>
                      <button
                        onClick={() => {
                          deleteEventMutation.mutate(evt.id);
                          setConfirmingDeleteId(null);
                        }}
                        className="text-xs text-warning hover:text-warning/80 font-medium"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        className="text-xs text-muted hover:text-foreground"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDeleteId(evt.id)}
                      className="text-xs text-muted hover:text-warning"
                      aria-label={`Delete ${evt.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {evt.event_date} ·{' '}
                  {evt.days_until === 0 ? 'Today!' : `${evt.days_until} days away`}
                </p>
                {evt.is_in_taper && (
                  <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3 text-amber-400" />Taper phase active
                  </p>
                )}
                {evt.days_until_taper !== undefined && evt.days_until_taper > 0 && (
                  <p className="text-xs text-muted mt-1">
                    Taper starts in {evt.days_until_taper} days
                  </p>
                )}
                <EventResultPanel event={evt} />
                {evt.days_until !== undefined && evt.days_until <= 7 && (
                  <div className="mt-2">
                    <EventAiAnalysisCard eventId={evt.id} />
                  </div>
                )}
                <div className="mt-2">
                  <button
                    onClick={() => downloadEventReport(evt.id)}
                    disabled={exportingEventId === evt.id}
                    className="text-xs text-accent hover:text-accent/80 disabled:opacity-50"
                  >
                    {exportingEventId === evt.id ? 'Preparing…' : 'Export Prep PDF'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Plans surface — create / switch / archive / delete ────────── */}
      {mode === 'plans' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Create a plan</CardTitle>
            </CardHeader>
            <PlanBuilder key="plans-create" plan={undefined} {...planEditorProps} />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All plans</CardTitle>
            </CardHeader>
            <div className="space-y-2">
              {plansLoading && <SkeletonRow className="h-20" />}
              {plansError && (
                <ErrorState
                  title="Couldn't load plans"
                  message="Check your connection and try again."
                  onRetry={() => refetchPlans()}
                />
              )}
              {!plansLoading && !plansError && plans.length === 0 && (
                <EmptyState
                  icon={<Calendar className="w-8 h-8 text-muted" />}
                  title="No training plans yet"
                  description="Create one above — from scratch or from a template."
                />
              )}
              {plans.map((p) => {
                const Icon = BLOCK_TYPE_ICON[p.plan_type] ?? Settings;
                const pct =
                  p.day_count > 0 ? Math.round((p.completed_days / p.day_count) * 100) : 0;
                return (
                  <div
                    key={p.id}
                    className={`p-3 rounded-lg border ${
                      selectedPlanId === p.id
                        ? 'bg-accent/10 border-accent/30'
                        : 'bg-surface-light/30 border-surface-light/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-foreground font-medium text-sm truncate">{p.name}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status] ?? STATUS_COLORS.draft}`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Icon className="w-3 h-3" /> {p.plan_type}
                      </span>
                      <span>
                        {p.start_date} → {p.end_date}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <div className="w-full bg-surface-light rounded-full h-1.5">
                        <div className="bg-accent rounded-full h-1.5" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-muted mt-0.5">
                        {p.completed_days}/{p.day_count} days
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      <button
                        onClick={() => openPlan(p.id)}
                        className="text-xs text-accent hover:text-accent/80 font-medium"
                      >
                        Open
                      </button>
                      {p.status === 'draft' && (
                        <button
                          onClick={() =>
                            updatePlanMutation.mutate({ planId: p.id, payload: { status: 'active' } })
                          }
                          className="text-xs text-positive hover:text-positive/80 font-medium"
                        >
                          Activate
                        </button>
                      )}
                      {p.status === 'active' && (
                        <button
                          onClick={() =>
                            updatePlanMutation.mutate({
                              planId: p.id,
                              payload: { status: 'archived' },
                            })
                          }
                          className="text-xs text-muted hover:text-foreground"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Delete plan "${p.name}"? This cannot be undone.`)) {
                            deletePlanMutation.mutate(p.id);
                          }
                        }}
                        className="text-xs text-warning hover:text-warning/80 ml-auto"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
