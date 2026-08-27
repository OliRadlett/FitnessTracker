'use client';

/**
 * PlanBuilder — Phase 5A redesign.
 *
 * Structure: empty state (scratch / template creation) → plan header
 * (inline-editable name, badges, event link, Activate/Delete) → week tabs
 * with an "All" overview → 7-column day-card grid with expandable editors,
 * HTML5 drag-and-drop date swapping, and a sticky unsaved-changes footer.
 *
 * Save model: edits accumulate locally (keyed by day_date); Save PATCHes the
 * FULL days array — the backend upserts by day_date and DELETES any dates
 * missing from the payload, so partial saves must never be sent.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TrainingPlan,
  TrainingPlanDay,
  GeneratePlanPayload,
  CreateTrainingPlanPayload,
  UpdateTrainingPlanPayload,
  PlannedExercise,
  PlanSport,
  PlanDayType,
  Event,
} from '@/lib/api';
import {
  getWarmupTemplates,
  getLiftingSessions,
  copySessionToPlanDay,
  copyPlanDayToDate,
  previewWorkout,
  type WorkoutPreviewTargets,
} from '@/lib/api';
import { useAuthFetch } from '@/lib/api/fetch';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';
import { RoutePickerModal } from './RoutePickerModal';

// ─── Constants ────────────────────────────────────────────────────────────

const DAY_TYPES: PlanDayType[] = ['rest', 'easy', 'moderate', 'hard', 'race'];

const DAY_TYPE_COLORS: Record<string, string> = {
  rest: 'bg-gray-800/60 border-gray-600/50 text-gray-400',
  easy: 'bg-green-900/30 border-green-700/40 text-green-300',
  moderate: 'bg-blue-900/30 border-blue-700/40 text-blue-300',
  hard: 'bg-orange-900/30 border-orange-700/40 text-orange-300',
  race: 'bg-red-900/30 border-red-700/40 text-red-300',
};

const SPORT_EMOJI: Record<string, string> = {
  cycle: '🚴',
  strength: '🏋️',
  rest: '😴',
};

const FOCUS_OPTIONS = [
  { value: 'squat', label: 'Squat' },
  { value: 'bench', label: 'Bench' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'overhead_press', label: 'Overhead Press' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'full_body', label: 'Full Body' },
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'legs', label: 'Legs' },
  { value: 'upper', label: 'Upper' },
  { value: 'lower', label: 'Lower' },
] as const;

const TEMPLATE_OPTIONS = [
  { value: 'base', label: 'Base — Steady foundation' },
  { value: 'build', label: 'Build — Progressive overload' },
  { value: 'peak', label: 'Peak — High intensity' },
  { value: 'taper', label: 'Taper — Pre-event reduction' },
  { value: 'recovery', label: 'Recovery — Active rest' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  active: 'bg-green-500/20 text-positive border-green-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  archived: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) /
      86400000,
  );
}

function getWeekDates(startDate: string, weekIndex: number): string[] {
  const weekStart = addDays(startDate, weekIndex * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function getTotalWeeks(startDate?: string, endDate?: string): number {
  if (!startDate || !endDate) return 1;
  return Math.max(1, Math.ceil((diffDays(startDate, endDate) + 1) / 7));
}

function getDayOfWeek(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
  });
}

/** Σ weight × reps × sets across exercises with a target weight. */
export function computedVolumeKg(exercises?: PlannedExercise[] | null): number | null {
  if (!exercises || exercises.length === 0) return null;
  const total = exercises.reduce(
    (sum, ex) => sum + (ex.weight_kg ?? 0) * (ex.reps || 0) * (ex.sets || 0),
    0,
  );
  return total > 0 ? Math.round(total) : null;
}

/** Blank day used when the user edits a date that has no persisted record yet. */
function blankDay(dateStr: string, planId: string): TrainingPlanDay {
  return {
    id: `draft-${dateStr}`,
    plan_id: planId,
    day_date: dateStr,
    sport: 'rest',
    planned_type: 'rest',
    completed: false,
  };
}

const inputCls =
  'w-full px-2 py-1.5 bg-background border border-surface-light rounded-lg text-white text-sm focus:outline-none focus:border-accent';
const labelCls = 'block text-xs text-muted mb-1';

// ─── Props ────────────────────────────────────────────────────────────────

interface PlanBuilderProps {
  /** Keyed by plan id from the parent so switching plans resets all state. */
  plan?: TrainingPlan;
  events?: Event[];
  onCreatePlan: (payload: CreateTrainingPlanPayload) => void;
  onGeneratePlan: (payload: GeneratePlanPayload) => void;
  onUpdatePlan: (planId: string, payload: UpdateTrainingPlanPayload) => void;
  onSaveDays: (planId: string, days: TrainingPlanDay[]) => void;
  onDeletePlan: (planId: string) => void;
  /** Invalidate plan queries to refetch fresh data from server. */
  onRefreshPlan: (planId: string) => void;
  isSaving?: boolean;
  isCreating?: boolean;
  isGenerating?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────

export function PlanBuilder({
  plan,
  events = [],
  onCreatePlan,
  onGeneratePlan,
  onUpdatePlan,
  onSaveDays,
  onDeletePlan,
  onRefreshPlan,
  isSaving,
  isCreating,
  isGenerating,
}: PlanBuilderProps) {
  const [createMode, setCreateMode] = useState<'none' | 'scratch' | 'template'>('none');

  // ── Empty state ─────────────────────────────────────────────────────
  if (!plan) {
    return (
      <EmptyState
        mode={createMode}
        setMode={setCreateMode}
        events={events}
        onCreatePlan={onCreatePlan}
        onGeneratePlan={onGeneratePlan}
        isCreating={isCreating}
        isGenerating={isGenerating}
      />
    );
  }

  return (
    <PlanEditor
      key={plan.id}
      plan={plan}
      events={events}
      onUpdatePlan={onUpdatePlan}
      onSaveDays={onSaveDays}
      onDeletePlan={onDeletePlan}
      onRefreshPlan={onRefreshPlan}
      isSaving={isSaving}
    />
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────

interface EmptyStateProps {
  mode: 'none' | 'scratch' | 'template';
  setMode: (m: 'none' | 'scratch' | 'template') => void;
  events: Event[];
  onCreatePlan: (payload: CreateTrainingPlanPayload) => void;
  onGeneratePlan: (payload: GeneratePlanPayload) => void;
  isCreating?: boolean;
  isGenerating?: boolean;
}

const todayStr = toDateStr(new Date());

function EmptyState({
  mode,
  setMode,
  events,
  onCreatePlan,
  onGeneratePlan,
  isCreating,
  isGenerating,
}: EmptyStateProps) {
  const [scratchForm, setScratchForm] = useState({
    name: '',
    start_date: todayStr,
    weeks: 4,
  });
  const [templateForm, setTemplateForm] = useState<GeneratePlanPayload>({
    name: '',
    template_type: 'build',
    weeks: 4,
    start_date: todayStr,
    base_tss: 300,
    event_id: undefined,
  });

  const handleCreateScratch = () => {
    onCreatePlan({
      name: scratchForm.name.trim(),
      start_date: scratchForm.start_date,
      end_date: addDays(scratchForm.start_date, scratchForm.weeks * 7 - 1),
      plan_type: 'custom',
      status: 'draft',
    });
  };

  const handleGenerate = () => {
    onGeneratePlan({ ...templateForm, name: templateForm.name.trim() });
  };

  if (mode === 'scratch') {
    return (
      <div className="bg-surface rounded-xl border border-surface-light/50 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">📝 Start From Scratch</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-3">
            <label className={labelCls}>Plan Name</label>
            <input
              type="text"
              autoFocus
              value={scratchForm.name}
              onChange={(e) => setScratchForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Autumn Strength Block"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Start Date</label>
            <input
              type="date"
              value={scratchForm.start_date}
              onChange={(e) => setScratchForm((f) => ({ ...f, start_date: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Weeks</label>
            <input
              type="number"
              min={1}
              max={24}
              value={scratchForm.weeks}
              onChange={(e) =>
                setScratchForm((f) => ({ ...f, weeks: parseInt(e.target.value) || 4 }))
              }
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleCreateScratch}
            disabled={!scratchForm.name.trim() || !scratchForm.start_date || isCreating}
            className="px-6 py-2.5 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create Empty Plan'}
          </button>
          <button
            onClick={() => setMode('none')}
            className="px-6 py-2.5 bg-surface-light text-muted rounded-lg font-medium hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'template') {
    const linkedEvent = events.find((e) => e.id === templateForm.event_id);
    return (
      <div className="bg-surface rounded-xl border border-surface-light/50 p-6">
        <h3 className="text-lg font-semibold text-white mb-1">⚡ Use Template</h3>
        <p className="text-sm text-muted mb-4">
          Mixed weeks: Sun rest · Tue strength (squat-focus) · Thu bench/deadlift rotation ·
          Mon/Wed/Fri/Sat rides.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className={labelCls}>Plan Name</label>
            <input
              type="text"
              autoFocus
              value={templateForm.name}
              onChange={(e) =>
                setTemplateForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="e.g. Build Phase"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Template</label>
            <select
              value={templateForm.template_type}
              onChange={(e) =>
                setTemplateForm((f) => ({ ...f, template_type: e.target.value }))
              }
              className={inputCls}
            >
              {TEMPLATE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Weeks</label>
            <input
              type="number"
              min={1}
              max={24}
              value={templateForm.weeks}
              onChange={(e) =>
                setTemplateForm((f) => ({ ...f, weeks: parseInt(e.target.value) || 4 }))
              }
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Start Date</label>
            <input
              type="date"
              value={templateForm.start_date}
              onChange={(e) =>
                setTemplateForm((f) => ({ ...f, start_date: e.target.value }))
              }
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Base Weekly TSS</label>
            <input
              type="number"
              min={50}
              max={1500}
              step={25}
              value={templateForm.base_tss}
              onChange={(e) =>
                setTemplateForm((f) => ({
                  ...f,
                  base_tss: parseFloat(e.target.value) || 300,
                }))
              }
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Taper for Event (optional)</label>
            <select
              value={templateForm.event_id ?? ''}
              onChange={(e) =>
                setTemplateForm((f) => ({
                  ...f,
                  event_id: e.target.value || undefined,
                }))
              }
              className={inputCls}
            >
              <option value="">No event</option>
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  🏁 {evt.name} ({evt.event_date})
                </option>
              ))}
            </select>
            {linkedEvent && (
              <p className="text-xs text-muted mt-1">
                Plan will taper over the final {linkedEvent.taper_days} days before{' '}
                {linkedEvent.event_date}.
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            disabled={!templateForm.name.trim() || isGenerating}
            className="px-6 py-2.5 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Generate Plan'}
          </button>
          <button
            onClick={() => setMode('none')}
            className="px-6 py-2.5 bg-surface-light text-muted rounded-lg font-medium hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-8 text-center">
      <p className="text-4xl mb-4">📋</p>
      <h3 className="text-lg font-semibold text-white mb-2">No Plan Selected</h3>
      <p className="text-muted mb-6">Select a plan on the left, or create a new one.</p>
      <div className="flex flex-col sm:flex-row justify-center gap-3">
        <button
          onClick={() => setMode('scratch')}
          className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors"
        >
          📝 Start From Scratch
        </button>
        <button
          onClick={() => setMode('template')}
          className="px-6 py-3 bg-surface-light text-white rounded-lg font-medium hover:bg-surface-light/70 transition-colors"
        >
          ⚡ Use Template
        </button>
      </div>
    </div>
  );
}

// ─── Plan Editor ──────────────────────────────────────────────────────────

interface PlanEditorProps {
  plan: TrainingPlan;
  events: Event[];
  onUpdatePlan: (planId: string, payload: UpdateTrainingPlanPayload) => void;
  onSaveDays: (planId: string, days: TrainingPlanDay[]) => void;
  onDeletePlan: (planId: string) => void;
  onRefreshPlan: (planId: string) => void;
  isSaving?: boolean;
}

function PlanEditor({
  plan,
  events,
  onUpdatePlan,
  onSaveDays,
  onDeletePlan,
  onRefreshPlan,
  isSaving,
}: PlanEditorProps) {
  // Local editable copy of ALL days — re-initialised whenever the plan object
  // changes (parent also keys this component by plan id).
  const [days, setDays] = useState<TrainingPlanDay[]>(() =>
    (plan.days ?? []).map((d) => ({ ...d })),
  );
  const [dirtyDates, setDirtyDates] = useState<Set<string>>(new Set());
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<number | 'all'>(0);
  const [nameDraft, setNameDraft] = useState(plan.name);
  const [draggingDate, setDraggingDate] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);

  useEffect(() => {
    setDays((plan.days ?? []).map((d) => ({ ...d })));
    setDirtyDates(new Set());
    setNameDraft(plan.name);
    setExpandedDate(null);
  }, [plan]);

  const linkedEvent = useMemo(
    () => events.find((e) => e.id === plan.event_id),
    [events, plan.event_id],
  );

  const totalWeeks = useMemo(
    () => getTotalWeeks(plan.start_date, plan.end_date),
    [plan.start_date, plan.end_date],
  );

  const daysByDate = useMemo(() => {
    const map = new Map<string, TrainingPlanDay>();
    for (const d of days) map.set(d.day_date, d);
    return map;
  }, [days]);

  const weekSummaries = useMemo(
    () =>
      Array.from({ length: totalWeeks }, (_, wi) => {
        const dates = getWeekDates(plan.start_date, wi);
        const weekDays = dates
          .map((dt) => daysByDate.get(dt))
          .filter((d): d is TrainingPlanDay => !!d);
        return {
          weekIndex: wi,
          totalTss: Math.round(
            weekDays.reduce((sum, d) => sum + (d.planned_tss || 0), 0),
          ),
          rides: weekDays.filter((d) => d.sport === 'cycle').length,
          strength: weekDays.filter((d) => d.sport === 'strength').length,
          rest: dates.filter((dt) => {
            const d = daysByDate.get(dt);
            return !d || d.sport === 'rest';
          }).length,
        };
      }),
    [totalWeeks, plan.start_date, daysByDate],
  );

  // ── Editing ─────────────────────────────────────────────────────────

  const markDirty = (dateStr: string) => {
    setDirtyDates((prev) => {
      if (prev.has(dateStr)) return prev;
      const next = new Set(prev);
      next.add(dateStr);
      return next;
    });
  };

  const updateDayFields = (dateStr: string, patch: Partial<TrainingPlanDay>) => {
    setDays((prev) => {
      const idx = prev.findIndex((d) => d.day_date === dateStr);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      }
      return [...prev, { ...blankDay(dateStr, plan.id), ...patch }];
    });
    markDirty(dateStr);
  };

  /** Toggle completed — accumulates like other edits and persists on Save. */
  const toggleCompleted = (dateStr: string) => {
    const day = daysByDate.get(dateStr);
    updateDayFields(dateStr, { completed: !(day?.completed ?? false) });
  };

  /** Drag-and-drop: swapping dates between two slots (move if target empty). */
  const handleDropOn = (targetDate: string) => {
    const sourceDate = draggingDate;
    setDraggingDate(null);
    setDropTargetDate(null);
    if (!sourceDate || sourceDate === targetDate) return;

    const source = daysByDate.get(sourceDate);
    const target = daysByDate.get(targetDate);
    if (!source && !target) return;

    setDays((prev) =>
      prev.map((d) => {
        if (source && d.day_date === sourceDate) return { ...d, day_date: targetDate };
        if (!source && d.day_date === targetDate) return { ...d, day_date: sourceDate };
        if (target && d.day_date === targetDate) return { ...d, day_date: sourceDate };
        return d;
      }),
    );
    markDirty(targetDate);
    markDirty(sourceDate);
    // Keep the open editor attached to the moved day
    if (expandedDate === sourceDate) setExpandedDate(targetDate);
    else if (target && expandedDate === targetDate) setExpandedDate(sourceDate);
  };

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== plan.name) {
      onUpdatePlan(plan.id, { name: trimmed });
    } else {
      setNameDraft(plan.name);
    }
  };

  const discardChanges = () => {
    setDays((plan.days ?? []).map((d) => ({ ...d })));
    setDirtyDates(new Set());
  };

  const saveAll = () => {
    onSaveDays(plan.id, days);
  };

  const activeDates =
    activeTab === 'all' ? [] : getWeekDates(plan.start_date, activeTab);

  return (
    <div className="space-y-4 pb-16">
      {/* Header */}
      <div className="bg-surface rounded-xl border border-surface-light/50 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              title="Click to rename"
              className="w-full bg-transparent border border-transparent rounded-lg px-2 py-0.5 -ml-2 text-xl font-bold text-white hover:border-surface-light focus:outline-none focus:border-accent"
            />
            <div className="flex flex-wrap items-center gap-2 mt-1 px-0.5">
              <span className="text-xs px-2 py-0.5 rounded-full border bg-accent/10 border-accent/30 text-accent capitalize">
                {plan.plan_type}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[plan.status]} capitalize`}
              >
                {plan.status}
              </span>
              <span className="text-xs text-muted">
                📅 {plan.start_date} → {plan.end_date}
              </span>
              {linkedEvent ? (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-purple-500/20 border-purple-500/30 text-purple-300">
                  🏁 {linkedEvent.name}
                  <button
                    onClick={() => onUpdatePlan(plan.id, { event_id: null })}
                    title="Unlink event"
                    className="hover:text-white"
                  >
                    ✕
                  </button>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {plan.status === 'draft' && (
              <button
                onClick={() => onUpdatePlan(plan.id, { status: 'active' })}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                ▶️ Activate
              </button>
            )}
            <button
              onClick={() => {
                if (confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) {
                  onDeletePlan(plan.id);
                }
              }}
              className="px-3 py-1.5 bg-red-600/20 text-warning border border-red-600/30 rounded-lg text-sm font-medium hover:bg-red-600/30 transition-colors"
            >
              🗑️ Delete
            </button>
          </div>
        </div>
      </div>

      {/* Week tabs */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'all'
              ? 'bg-accent text-white'
              : 'bg-surface-light/40 text-muted hover:text-white'
          }`}
        >
          All
        </button>
        {Array.from({ length: totalWeeks }, (_, wi) => (
          <button
            key={wi}
            onClick={() => setActiveTab(wi)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === wi
                ? 'bg-accent text-white'
                : 'bg-surface-light/40 text-muted hover:text-white'
            }`}
          >
            Week {wi + 1}
          </button>
        ))}
      </div>

      {/* All-tab: per-week summary cards */}
      {activeTab === 'all' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {weekSummaries.map((ws) => (
            <button
              key={ws.weekIndex}
              onClick={() => setActiveTab(ws.weekIndex)}
              className="bg-surface rounded-lg border border-surface-light/50 p-3 text-left hover:border-accent/40 transition-colors"
            >
              <p className="text-xs text-muted mb-1 font-semibold uppercase tracking-wider">
                Week {ws.weekIndex + 1}
              </p>
              <p className="text-lg font-bold text-white">
                {ws.totalTss} <span className="text-xs font-normal text-muted">TSS</span>
              </p>
              <p className="text-xs text-muted mt-1">
                🚴 {ws.rides} · 🏋️ {ws.strength} · 😴 {ws.rest}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Week view: day cards */}
      {activeTab !== 'all' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
            {activeDates.map((dateStr) => {
              const day = daysByDate.get(dateStr);
              const ptype = day?.planned_type ?? 'rest';
              const sport = day?.sport ?? 'rest';
              const isExpanded = expandedDate === dateStr;
              const isDropTarget = dropTargetDate === dateStr && draggingDate !== null;
              const volume = computedVolumeKg(day?.planned_exercises);
              return (
                <div
                  key={dateStr}
                  draggable
                  onDragStart={() => setDraggingDate(dateStr)}
                  onDragEnd={() => {
                    setDraggingDate(null);
                    setDropTargetDate(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggingDate && draggingDate !== dateStr) {
                      setDropTargetDate(dateStr);
                    }
                  }}
                  onDragLeave={() =>
                    setDropTargetDate((prev) => (prev === dateStr ? null : prev))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOn(dateStr);
                  }}
                  onClick={() => setExpandedDate(isExpanded ? null : dateStr)}
                  className={`rounded-lg border p-2 min-h-[104px] cursor-grab active:cursor-grabbing transition-shadow ${
                    DAY_TYPE_COLORS[ptype]
                  } ${
                    isDropTarget
                      ? 'ring-2 ring-accent border-accent shadow-lg'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-xs font-semibold">{getDayOfWeek(dateStr)}</span>{' '}
                      <span className="text-[10px] opacity-75">{dateStr.slice(5)}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCompleted(dateStr);
                      }}
                      title={day?.completed ? 'Marked complete' : 'Mark complete'}
                      className={`w-5 h-5 rounded-full border text-[10px] leading-none flex items-center justify-center transition-colors ${
                        day?.completed
                          ? 'bg-positive/80 border-positive text-white'
                          : 'border-current/40 opacity-50 hover:opacity-100'
                      }`}
                    >
                      ✓
                    </button>
                  </div>

                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base">{SPORT_EMOJI[sport]}</span>
                    {day?.planned_focus && sport === 'strength' && (
                      <span className="text-[10px] uppercase tracking-wide opacity-75">
                        {(day.planned_focus as string).replace('_', ' ')}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1 text-[10px] opacity-90">
                    <span className="capitalize">{ptype}</span>
                    {day?.planned_tss != null && <span>· {Math.round(day.planned_tss)} TSS</span>}
                    {day?.planned_duration_min != null && (
                      <span>· {day.planned_duration_min}m</span>
                    )}
                    {volume != null && <span>· {volume}kg</span>}
                  </div>

                  {dirtyDates.has(dateStr) && (
                    <span className="block mt-1 text-[9px] text-warning">● unsaved</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Expanded day editor (only one open) */}
          {expandedDate && (() => {
            const editorDay = daysByDate.get(expandedDate) ?? blankDay(expandedDate, plan.id);
            return (
              <DayEditor
                key={expandedDate}
                dateStr={expandedDate}
                day={editorDay}
                planId={plan.id}
                isDraft={editorDay.id.startsWith('draft-')}
                onPatch={(patch) => updateDayFields(expandedDate, patch)}
                onClose={() => setExpandedDate(null)}
                onRefreshPlan={() => onRefreshPlan(plan.id)}
              />
            );
          })()}

          <div className="flex flex-wrap gap-3 pt-1">
            <span className="text-[10px] text-muted">
              Tip: drag a day onto another slot to swap dates.
            </span>
          </div>
        </>
      )}

      {/* Sticky unsaved-changes footer */}
      {dirtyDates.size > 0 && (
        <div className="sticky bottom-0 z-10 -mx-1 px-1">
          <div className="bg-surface border border-surface-light rounded-xl shadow-lg p-3 flex items-center justify-between gap-3">
            <span className="text-sm text-warning font-medium">
              ● Unsaved changes ({dirtyDates.size} day{dirtyDates.size > 1 ? 's' : ''})
            </span>
            <div className="flex gap-2">
              <button
                onClick={discardChanges}
                disabled={isSaving}
                className="px-4 py-2 text-sm text-muted hover:text-white disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={saveAll}
                disabled={isSaving}
                className="px-5 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Day Editor ───────────────────────────────────────────────────────────

interface DayEditorProps {
  dateStr: string;
  day: TrainingPlanDay;
  planId: string;
  isDraft: boolean;
  onPatch: (patch: Partial<TrainingPlanDay>) => void;
  onClose: () => void;
  onRefreshPlan: () => void;
}

function DayEditor({ dateStr, day, planId, isDraft, onPatch, onClose, onRefreshPlan }: DayEditorProps) {
  const isRest = day.sport === 'rest';
  const isStrength = day.sport === 'strength';
  const volume = computedVolumeKg(day.planned_exercises);
  const queryClient = useQueryClient();
  const { authFetch } = useAuthFetch();

  const { data: warmupTemplates } = useQuery({
    queryKey: ['warmup-templates'],
    queryFn: () => getWarmupTemplates(authFetch),
    staleTime: 5 * 60 * 1000,
  });

  const { data: liftingSessions } = useQuery({
    queryKey: ['lifting-sessions'],
    queryFn: () => getLiftingSessions(authFetch),
    enabled: isStrength,
    staleTime: 60 * 1000,
  });

  const selectedWarmup = warmupTemplates?.find((wt) => wt.id === day.warmup_template_id);

  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showDuplicatePicker, setShowDuplicatePicker] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const [duplicateDate, setDuplicateDate] = useState('');
  const [copyError, setCopyError] = useState<string | null>(null);
  const [previewTargets, setPreviewTargets] = useState<WorkoutPreviewTargets | null>(null);

  // Fetch workout preview when type/duration changes for cycle days
  useEffect(() => {
    if (day.sport !== 'cycle' || !day.planned_type || day.planned_type === 'rest' || !day.planned_duration_min) {
      setPreviewTargets(null);
      return;
    }
    let cancelled = false;
    previewWorkout(authFetch, day.planned_type, day.planned_duration_min)
      .then((res) => {
        if (!cancelled) setPreviewTargets(res.targets);
      })
      .catch(() => {
        if (!cancelled) setPreviewTargets(null);
      });
    return () => { cancelled = true; };
  }, [day.sport, day.planned_type, day.planned_duration_min, authFetch]);

  // Persist preview targets to the model so conformity scoring can read them
  useEffect(() => {
    if (!previewTargets) return;
    const midPower = Math.round((previewTargets.target_power_low + previewTargets.target_power_high) / 2);
    const midTss = Math.round((previewTargets.target_tss_low + previewTargets.target_tss_high) / 2);
    const patch: Record<string, unknown> = {};
    if (day.planned_power_watts !== midPower) patch.planned_power_watts = midPower;
    if (day.planned_tss !== midTss) patch.planned_tss = midTss;
    if (day.planned_zone !== previewTargets.zone_name) patch.planned_zone = previewTargets.zone_name;
    if (Object.keys(patch).length > 0) onPatch(patch);
  }, [previewTargets]);

  const handleCopySession = async () => {
    if (!selectedSessionId || isDraft) return;
    setCopyError(null);
    try {
      await copySessionToPlanDay(authFetch, planId, day.id, selectedSessionId);
      setShowSessionPicker(false);
      setSelectedSessionId('');
      onRefreshPlan();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy session');
    }
  };

  const handleDuplicateDay = async () => {
    if (!duplicateDate || isDraft) return;
    setCopyError(null);
    try {
      await copyPlanDayToDate(authFetch, planId, day.id, duplicateDate);
      setShowDuplicatePicker(false);
      setDuplicateDate('');
      onRefreshPlan();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to duplicate day');
    }
  };

  const patchExercise = (idx: number, patch: Partial<PlannedExercise>) => {
    const list = [...(day.planned_exercises ?? [])];
    list[idx] = { ...list[idx], ...patch };
    onPatch({ planned_exercises: list });
  };

  const removeExercise = (idx: number) => {
    onPatch({
      planned_exercises: (day.planned_exercises ?? []).filter((_, i) => i !== idx),
    });
  };

  const addExercise = () => {
    onPatch({
      planned_exercises: [
        ...(day.planned_exercises ?? []),
        { exercise: '', sets: 3, reps: 8, weight_kg: null, rpe: null },
      ],
    });
  };

  return (
    <div className="bg-surface rounded-xl border border-accent/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">
          Edit {getDayOfWeek(dateStr)} {dateStr}
        </h4>
        <div className="flex items-center gap-1">
          {isStrength && !isDraft && (
            <>
              <button
                onClick={() => {
                  setShowSessionPicker(!showSessionPicker);
                  setShowDuplicatePicker(false);
                  setCopyError(null);
                }}
                title="Copy exercises from a past session"
                className="text-[10px] px-2 py-1 rounded bg-surface-light/60 text-muted hover:text-white transition-colors"
              >
                📋 Copy Session
              </button>
              <button
                onClick={() => {
                  setShowDuplicatePicker(!showDuplicatePicker);
                  setShowSessionPicker(false);
                  setCopyError(null);
                }}
                title="Duplicate this day to another date"
                className="text-[10px] px-2 py-1 rounded bg-surface-light/60 text-muted hover:text-white transition-colors"
              >
                📅 Duplicate
              </button>
            </>
          )}
          {isStrength && isDraft && (
            <span className="text-[10px] text-muted italic px-2 py-1">
              Save the plan first to use Copy/Duplicate
            </span>
          )}
          <button onClick={onClose} className="text-muted hover:text-white text-sm px-1">
            ✕
          </button>
        </div>
      </div>

      {showSessionPicker && isStrength && (
        <div className="flex items-center gap-2 p-2 bg-background rounded-lg border border-surface-light">
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className={`${inputCls} flex-1`}
          >
            <option value="">Select a session...</option>
            {(liftingSessions ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.session_date} — {s.focus ?? 'No focus'} ({s.sets.length} sets)
              </option>
            ))}
          </select>
          <button
            onClick={handleCopySession}
            disabled={!selectedSessionId}
            className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            Copy
          </button>
          <button
            onClick={() => setShowSessionPicker(false)}
            className="text-muted hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {showDuplicatePicker && isStrength && (
        <div className="flex items-center gap-2 p-2 bg-background rounded-lg border border-surface-light">
          <input
            type="date"
            value={duplicateDate}
            onChange={(e) => setDuplicateDate(e.target.value)}
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={handleDuplicateDay}
            disabled={!duplicateDate}
            className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            Duplicate
          </button>
          <button
            onClick={() => setShowDuplicatePicker(false)}
            className="text-muted hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {copyError && (
        <p className="text-xs text-warning px-1">{copyError}</p>
      )}

      {/* Sport */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Sport</label>
          <select
            value={day.sport}
            onChange={(e) => {
              const sport = e.target.value as PlanSport;
              if (sport === 'rest') {
                onPatch({ sport, planned_type: 'rest' });
              } else if (sport === 'strength' && day.sport !== 'strength') {
                onPatch({ sport, planned_focus: day.planned_focus ?? 'squat' });
              } else {
                onPatch({ sport });
              }
            }}
            className={inputCls}
          >
            <option value="rest">😴 Rest</option>
            <option value="cycle">🚴 Cycle</option>
            <option value="strength">🏋️ Strength</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select
            value={day.planned_type}
            disabled={isRest}
            onChange={(e) =>
              onPatch({ planned_type: e.target.value as PlanDayType })
            }
            className={`${inputCls} disabled:opacity-50`}
          >
            {DAY_TYPES.map((dt) => (
              <option key={dt} value={dt} className="capitalize">
                {dt}
              </option>
            ))}
          </select>
        </div>
        {!isStrength && (
          <div>
            <label className={labelCls}>Duration (min)</label>
            <input
              type="number"
              min={0}
              value={day.planned_duration_min ?? ''}
              onChange={(e) =>
                onPatch({
                  planned_duration_min: e.target.value === '' ? null : parseInt(e.target.value),
                })
              }
              className={inputCls}
            />
          </div>
        )}
        {!isRest && !isStrength && (
          <div>
            <label className={labelCls}>TSS</label>
            {previewTargets ? (
              <p className="text-sm text-white font-medium mt-1">
                {Math.round(previewTargets.target_tss_low)}–{Math.round(previewTargets.target_tss_high)}
              </p>
            ) : (
              <input
                type="number"
                min={0}
                value={day.planned_tss ?? ''}
                onChange={(e) =>
                  onPatch({
                    planned_tss: e.target.value === '' ? null : parseFloat(e.target.value),
                  })
                }
                className={inputCls}
              />
            )}
          </div>
        )}
      </div>

      {/* Cycle extras — auto-computed from type + duration + FTP */}
      {day.sport === 'cycle' && (
        <div className="space-y-3">
          {previewTargets ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Zone</label>
                <p className="text-sm text-white font-medium">{previewTargets.zone_name}</p>
              </div>
              <div>
                <label className={labelCls}>Power (W)</label>
                <p className="text-sm text-white font-medium">
                  {previewTargets.target_power_low}–{previewTargets.target_power_high}
                </p>
              </div>
              <div>
                <label className={labelCls}>TSS</label>
                <p className="text-sm text-white font-medium">
                  {Math.round(previewTargets.target_tss_low)}–{Math.round(previewTargets.target_tss_high)}
                </p>
              </div>
              <div>
                <label className={labelCls}>IF</label>
                <p className="text-sm text-white font-medium">
                  {previewTargets.target_if_low}–{previewTargets.target_if_high}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">
              {day.planned_duration_min ? 'Set FTP in Cycling Profile to see computed targets' : 'Set duration to see targets'}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Route</label>
            {day.planned_route_id ? (
              <div className="flex items-center gap-2">
                <span className="inline-block text-xs px-2 py-1 rounded-full bg-positive/15 text-positive border border-positive/30">
                  Route assigned ✓
                </span>
                <button
                  onClick={() => setShowRoutePicker(true)}
                  className="text-xs text-accent hover:text-accent/80"
                >
                  Change
                </button>
                <button
                  onClick={() => onPatch({ planned_route_id: null })}
                  className="text-xs text-warning hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowRoutePicker(true)}
                className="w-full px-3 py-2 text-left text-sm bg-background border border-surface-light rounded-lg text-muted hover:text-white hover:border-accent/50 transition-colors"
              >
                🗺️ Pick a route...
              </button>
            )}
          </div>
        </div>
        </div>
      )}

      {/* Strength extras */}
      {isStrength && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Session Type</label>
              <select
                value={day.planned_focus ?? 'squat'}
                onChange={(e) => onPatch({ planned_focus: e.target.value })}
                className={inputCls}
              >
                {FOCUS_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Duration (min)</label>
              <input
                type="number"
                min={0}
                value={day.planned_duration_min ?? ''}
                onChange={(e) =>
                  onPatch({
                    planned_duration_min:
                      e.target.value === '' ? null : parseInt(e.target.value),
                  })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Target RPE</label>
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={day.planned_rpe ?? ''}
                onChange={(e) =>
                  onPatch({
                    planned_rpe: e.target.value === '' ? null : parseFloat(e.target.value),
                  })
                }
                className={inputCls}
              />
            </div>
          </div>

          {/* Warmup Template */}
          <div>
            <label className={labelCls}>Warmup Template</label>
            <select
              value={day.warmup_template_id ?? ''}
              onChange={(e) => onPatch({ warmup_template_id: e.target.value || null })}
              className={inputCls}
            >
              <option value="">No warmup</option>
              {warmupTemplates?.map((wt) => (
                <option key={wt.id} value={wt.id}>
                  {wt.name}{wt.exercise_name ? ` (${wt.exercise_name})` : ''}
                </option>
              ))}
            </select>
            {selectedWarmup && selectedWarmup.steps.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {selectedWarmup.steps.map((s) => (
                  <p key={s.step_number} className="text-[10px] text-muted">
                    {s.step_number}. {s.weight_kg}kg × {s.reps} reps{s.notes ? ` — ${s.notes}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Exercise list */}
          <div className="space-y-2">
            <label className={labelCls}>
              Exercises{volume != null && (
                <span className="ml-2 normal-case text-muted">
                  Target volume ≈ {volume.toLocaleString()} kg
                </span>
              )}
            </label>
            {(day.planned_exercises ?? []).map((ex, idx) => (
              <div
                key={idx}
                className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 items-center"
              >
                <div className="col-span-6 sm:col-span-4">
                  <ExerciseAutocomplete
                    value={ex.exercise}
                    onChange={(v) => patchExercise(idx, { exercise: v })}
                    placeholder="Exercise"
                    className="w-full bg-background border border-surface-light text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent"
                  />
                </div>
                <input
                  type="number"
                  min={1}
                  aria-label="Sets"
                  value={ex.sets}
                  onChange={(e) =>
                    patchExercise(idx, { sets: parseInt(e.target.value) || 1 })
                  }
                  className="col-span-1 sm:col-span-1 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-white text-xs focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  min={1}
                  aria-label="Reps"
                  value={ex.reps}
                  onChange={(e) =>
                    patchExercise(idx, { reps: parseInt(e.target.value) || 1 })
                  }
                  className="col-span-1 sm:col-span-1 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-white text-xs focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  min={0}
                  step={2.5}
                  aria-label="Weight kg"
                  placeholder="kg"
                  value={ex.weight_kg ?? ''}
                  onChange={(e) =>
                    patchExercise(idx, {
                      weight_kg: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                  className="col-span-2 sm:col-span-2 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-white text-xs focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.5}
                  aria-label="RPE"
                  placeholder="RPE"
                  value={ex.rpe ?? ''}
                  onChange={(e) =>
                    patchExercise(idx, {
                      rpe: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                  className="col-span-2 sm:col-span-2 px-1.5 py-1.5 bg-background border border-surface-light rounded-lg text-white text-xs focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => removeExercise(idx)}
                  title="Remove exercise"
                  className="col-span-6 sm:col-span-2 text-xs text-muted hover:text-warning py-1"
                >
                  ✕ Remove
                </button>
              </div>
            ))}
            <button
              onClick={addExercise}
              className="text-xs text-accent hover:text-accent/80 font-medium"
            >
              + Add exercise
            </button>
          </div>
        </div>
      )}

      {/* Descriptions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Workout Description</label>
          <textarea
            rows={2}
            maxLength={1000}
            value={day.workout_description ?? ''}
            onChange={(e) =>
              onPatch({ workout_description: e.target.value || null })
            }
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            rows={2}
            value={day.notes ?? ''}
            onChange={(e) => onPatch({ notes: e.target.value || null })}
            className={inputCls}
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={day.completed}
          onChange={() => onPatch({ completed: !day.completed })}
          className="accent-green-500"
        />
        Completed
      </label>

      <RoutePickerModal
        open={showRoutePicker}
        onClose={() => setShowRoutePicker(false)}
        onSelect={(routeId) => onPatch({ planned_route_id: routeId })}
        onUnassign={() => onPatch({ planned_route_id: null })}
        currentRouteId={day.planned_route_id}
      />
    </div>
  );
}
