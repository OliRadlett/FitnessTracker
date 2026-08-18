'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  TrainingPlan,
  TrainingPlanSummary,
  TrainingPlanDay,
  GeneratePlanPayload,
  CreateTrainingPlanPayload,
  Event,
  CreateEventPayload,
  ChartData,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Chart } from '@/components/charts/Chart';
import { PlanBuilder } from '@/components/training/PlanBuilder';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
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

export default function TrainingPage() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState<CreateEventPayload>({
    name: '',
    event_date: '',
    event_type: 'race',
    taper_days: 14,
  });

  // ── Queries ─────────────────────────────────────────────────────────

  const { data: plans, isLoading: plansLoading } = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans'],
    queryFn: () => authFetch<TrainingPlanSummary[]>('/api/v1/training-plans'),
  });

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
    queryKey: ['chart', 'periodization'],
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
  });

  const saveDaysMutation = useMutation({
    mutationFn: ({ planId, days }: { planId: string; days: TrainingPlanDay[] }) =>
      authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          days: days.map(d => ({
            day_date: d.day_date,
            planned_tss: d.planned_tss,
            planned_duration_min: d.planned_duration_min,
            planned_type: d.planned_type,
            notes: d.notes,
          })),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', selectedPlanId] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (planId: string) =>
      authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      queryClient.invalidateQueries({ queryKey: ['training-plan', selectedPlanId] });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: (planId: string) =>
      authFetch<void>(`/api/v1/training-plans/${planId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-plans'] });
      setSelectedPlanId(null);
    },
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
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) =>
      authFetch<void>(`/api/v1/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const handleSaveDays = (days: TrainingPlanDay[]) => {
    if (selectedPlanId) {
      saveDaysMutation.mutate({ planId: selectedPlanId, days });
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">📋 Training Plans</h1>
        <p className="text-muted mt-1">Plan your training blocks, manage events, and track periodization.</p>
      </div>

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
                    <button
                      onClick={() => deleteEventMutation.mutate(evt.id)}
                      className="text-xs text-muted hover:text-warning"
                    >
                      ✕
                    </button>
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

        {/* Right: Plan Builder */}
        <div className="lg:col-span-2">
          {planLoading && selectedPlanId ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent" />
            </div>
          ) : (
            <>
              <PlanBuilder
                plan={selectedPlan || undefined}
                onSave={handleSaveDays}
                onGenerate={(payload) => generateMutation.mutate(payload)}
                isSaving={saveDaysMutation.isPending}
              />
              {selectedPlan && (
                <div className="mt-4 flex gap-2">
                  {selectedPlan.status === 'draft' && (
                    <button
                      onClick={() => activateMutation.mutate(selectedPlan.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                    >
                      ▶️ Activate Plan
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm('Delete this plan?')) deletePlanMutation.mutate(selectedPlan.id);
                    }}
                    className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm font-medium hover:bg-red-600/30 transition-colors"
                  >
                    🗑️ Delete
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

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
