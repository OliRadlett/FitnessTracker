'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch, listGoals } from '@/lib/api';
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
  Event,
  Goal,
  CreateEventPayload,
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
import { CreatePlanPanel } from '@/components/training/plan/CreatePlanPanel';
import { WeeklyView } from '@/components/training/WeeklyView';
import { WeatherForecast } from '@/components/training/WeatherForecast';
import { ConformityTrendCard } from '@/components/training/review/ConformityTrendCard';
import { AdaptiveSuggestionsCard } from '@/components/training/AdaptiveSuggestionsCard';
import { StrengthSuggestionsCard } from '@/components/training/StrengthSuggestionsCard';
import { PlanGoalsStrip } from '@/components/training/PlanGoalsStrip';
import { EventForm } from '@/components/training/peaks/EventForm';
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

  const [showEventForm, setShowEventForm] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [exportingEventId, setExportingEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [linkPlanId, setLinkPlanId] = useState<Record<string, string>>({});

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

  // ── Review mode (read-only evidence) ────────────────────────────────
  const { data: volumeIntensityChart } = useQuery<ChartData>({
    queryKey: ['chart-volume-intensity', 16],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/volume_intensity_periodization?weeks=16'),
    enabled: !!token,
  });
  const { data: combinedLoadChart } = useQuery<ChartData>({
    queryKey: ['chart-combined-load', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/combined_training_load?days=90'),
    enabled: !!token,
  });
  const { data: weeklyVolumeChart } = useQuery<ChartData>({
    queryKey: ['chart-weekly-volume', 16],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weekly_volume?weeks=16'),
    enabled: !!token,
  });
  const { data: activeGoals } = useQuery<Goal[]>({
    queryKey: ['goals', 'active'],
    queryFn: () => listGoals(authFetch, 'active'),
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
        events={events ?? []}
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
            <WeeklyView
              key={selectedPlanId}
              plan={selectedPlan}
              events={events}
              highlightDate={highlightDate}
            />
          ) : (
            <div className="bg-surface rounded-xl border border-surface-light/50 p-8 text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">No plan selected</h3>
              <p className="text-muted mb-6">
                Create a plan — from scratch or a template — on the Plans surface.
              </p>
              <button
                onClick={() => setMode('plans')}
                className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors"
              >
                Go to Plans
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Review mode — the evidence. Read-only; action surfaces stay
             in Plan/Peaks. ──────────────────────────────────────────── */}
      {mode === 'review' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {selectedPlanId && <ConformityTrendCard planId={selectedPlanId} weeks={8} />}
            {selectedPlanId && <AdaptiveSuggestionsCard planId={selectedPlanId} />}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {periodizationChart && (
              <Card>
                <CardHeader>
                  <CardTitle>Periodization — Planned vs Actual</CardTitle>
                </CardHeader>
                <Chart data={periodizationChart} />
              </Card>
            )}
            {volumeIntensityChart && (
              <Card>
                <CardHeader>
                  <CardTitle>Volume × Intensity</CardTitle>
                </CardHeader>
                <Chart data={volumeIntensityChart} />
              </Card>
            )}
          </div>

          {combinedLoadChart && (
            <Card>
              <CardHeader>
                <CardTitle>Combined training load (cycling + lifting)</CardTitle>
              </CardHeader>
              <Chart data={combinedLoadChart} />
            </Card>
          )}

          {weeklyVolumeChart && (
            <Card>
              <CardHeader>
                <CardTitle>Weekly lifting volume</CardTitle>
              </CardHeader>
              <Chart data={weeklyVolumeChart} />
            </Card>
          )}

          {selectedPlan?.plan_type === 'strength' && selectedPlanId && (
            <StrengthSuggestionsCard planId={selectedPlanId} />
          )}

          <PlanGoalsStrip goals={activeGoals ?? []} />
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
            <div className="mb-4">
              <EventForm
                onSubmit={(payload) => createEventMutation.mutate(payload)}
                onCancel={() => setShowEventForm(false)}
                pending={createEventMutation.isPending}
              />
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
                {/* Link this event to a plan (PATCH the plan's event_id). */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(() => {
                    const linkedPlan = plans.find((p) => p.event_id === evt.id);
                    if (linkedPlan) {
                      return (
                        <>
                          <span className="text-[11px] text-muted">
                            Linked plan: <span className="text-foreground">{linkedPlan.name}</span>
                          </span>
                          <button
                            onClick={() =>
                              updatePlanMutation.mutate({
                                planId: linkedPlan.id,
                                payload: { event_id: null },
                              })
                            }
                            className="text-[11px] text-warning hover:text-warning/80"
                          >
                            Unlink
                          </button>
                        </>
                      );
                    }
                    return (
                      <>
                        <select
                          value={linkPlanId[evt.id] ?? ''}
                          onChange={(e) => setLinkPlanId((m) => ({ ...m, [evt.id]: e.target.value }))}
                          aria-label={`Link ${evt.name} to a plan`}
                          className="px-2 py-1 bg-background border border-surface-light rounded text-foreground text-[11px]"
                        >
                          <option value="">Link to plan…</option>
                          {plans
                            .filter((p) => p.status === 'active' || p.status === 'draft')
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={() => {
                            const pid = linkPlanId[evt.id];
                            if (pid)
                              updatePlanMutation.mutate({
                                planId: pid,
                                payload: { event_id: evt.id },
                              });
                          }}
                          disabled={!linkPlanId[evt.id] || updatePlanMutation.isPending}
                          className="px-2 py-1 bg-accent/20 text-accent rounded text-[11px] font-medium hover:bg-accent/30 disabled:opacity-40"
                        >
                          Link
                        </button>
                      </>
                    );
                  })()}
                </div>

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
          <CreatePlanPanel
            events={events ?? []}
            onCreatePlan={(payload) => createPlanMutation.mutate(payload)}
            onGeneratePlan={(payload) => generateMutation.mutate(payload)}
            isCreating={createPlanMutation.isPending}
            isGenerating={generateMutation.isPending}
          />

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
