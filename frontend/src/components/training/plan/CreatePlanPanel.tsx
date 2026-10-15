'use client';

/**
 * CreatePlanPanel — the create-a-plan forms (scratch / template / strength
 * progression), extracted from PlanBuilder's empty state.
 *
 * Used by the Plans surface and by Plan mode when no plan is selected. Owns its
 * own mode state so callers just render it.
 */

import React, { useState } from 'react';
import { ClipboardList, Dumbbell, Flag, Pencil, Zap } from 'lucide-react';

import type {
  CreateTrainingPlanPayload,
  Event,
  GeneratePlanPayload,
} from '@/lib/api';
import { addDays, toDateStr } from '@/lib/training/week';

const TEMPLATE_OPTIONS = [
  { value: 'base', label: 'Base — Steady foundation' },
  { value: 'build', label: 'Build — Progressive overload' },
  { value: 'peak', label: 'Peak — High intensity' },
  { value: 'taper', label: 'Taper — Pre-event reduction' },
  { value: 'recovery', label: 'Recovery — Active rest' },
  { value: 'strength', label: 'Strength — User-defined progression' },
] as const;

const inputCls =
  'w-full px-2 py-1.5 bg-background border border-surface-light rounded-lg text-foreground text-sm focus:outline-none focus:border-accent';
const labelCls = 'block text-xs text-muted mb-1';

export interface CreatePlanPanelProps {
  events: Event[];
  onCreatePlan: (payload: CreateTrainingPlanPayload) => void;
  onGeneratePlan: (payload: GeneratePlanPayload) => void;
  isCreating?: boolean;
  isGenerating?: boolean;
}

export function CreatePlanPanel({
  events,
  onCreatePlan,
  onGeneratePlan,
  isCreating,
  isGenerating,
}: CreatePlanPanelProps) {
  const [mode, setMode] = useState<'none' | 'scratch' | 'template'>('none');
  const todayStr = toDateStr(new Date());

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
        <h3 className="text-lg font-semibold text-foreground mb-4">
          <Pencil className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Start From Scratch
        </h3>
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
            className="px-6 py-2.5 bg-surface-light text-muted rounded-lg font-medium hover:text-foreground transition-colors"
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
        <h3 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
          <Zap className="w-5 h-5" /> Use Template
        </h3>
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
              onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Build Phase"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Template</label>
            <select
              value={templateForm.template_type}
              onChange={(e) => setTemplateForm((f) => ({ ...f, template_type: e.target.value }))}
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
              onChange={(e) => setTemplateForm((f) => ({ ...f, start_date: e.target.value }))}
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
                setTemplateForm((f) => ({ ...f, base_tss: parseFloat(e.target.value) || 300 }))
              }
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Taper for Event (optional)</label>
            <select
              value={templateForm.event_id ?? ''}
              onChange={(e) =>
                setTemplateForm((f) => ({ ...f, event_id: e.target.value || undefined }))
              }
              className={inputCls}
            >
              <option value="">No event</option>
              {events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  <Flag className="w-3 h-3 inline mr-1" />
                  {evt.name} ({evt.event_date})
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

        {/* Strength template options (shown when template_type === 'strength') */}
        {templateForm.template_type === 'strength' && (
          <div className="mt-4 pt-4 border-t border-surface-light/50 space-y-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
              <Dumbbell className="w-4 h-4" /> Strength Progression
            </h4>
            <p className="text-xs text-muted">
              Define your weekly RPE/sets/reps progression. Only specify weeks where the stimulus
              changes — unset weeks inherit from the nearest preceding week.
            </p>

            {/* Starting values */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>Starting RPE</label>
                <input
                  type="number"
                  min={5}
                  max={10}
                  step={0.5}
                  value={templateForm.strength_start_rpe ?? 8}
                  onChange={(e) =>
                    setTemplateForm((f) => ({
                      ...f,
                      strength_start_rpe: parseFloat(e.target.value) || 8,
                    }))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Starting Sets</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={templateForm.strength_start_sets ?? 5}
                  onChange={(e) =>
                    setTemplateForm((f) => ({
                      ...f,
                      strength_start_sets: parseInt(e.target.value) || 5,
                    }))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Starting Reps</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={templateForm.strength_start_reps ?? 5}
                  onChange={(e) =>
                    setTemplateForm((f) => ({
                      ...f,
                      strength_start_reps: parseInt(e.target.value) || 5,
                    }))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Starting Weight (kg)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  step={0.5}
                  value={templateForm.strength_start_weight_kg ?? ''}
                  onChange={(e) =>
                    setTemplateForm((f) => ({
                      ...f,
                      strength_start_weight_kg: parseFloat(e.target.value) || undefined,
                    }))
                  }
                  placeholder="Auto-detect from history"
                  className={inputCls}
                />
              </div>
            </div>

            {/* Weekly progression template */}
            <div>
              <label className={labelCls}>Weekly Progression (optional)</label>
              <div className="space-y-2">
                {(templateForm.strength_template || []).map((entry, idx) => (
                  <div key={idx} className="grid grid-cols-5 gap-2 items-end">
                    <div>
                      <label className={labelCls}>Week</label>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={entry.week}
                        onChange={(e) => {
                          const newTemplate = [...(templateForm.strength_template || [])];
                          newTemplate[idx].week = parseInt(e.target.value) || 1;
                          setTemplateForm((f) => ({ ...f, strength_template: newTemplate }));
                        }}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>RPE</label>
                      <input
                        type="number"
                        min={5}
                        max={10}
                        step={0.5}
                        value={entry.rpe ?? ''}
                        onChange={(e) => {
                          const newTemplate = [...(templateForm.strength_template || [])];
                          newTemplate[idx].rpe = parseFloat(e.target.value) || undefined;
                          setTemplateForm((f) => ({ ...f, strength_template: newTemplate }));
                        }}
                        placeholder="Inherit"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Sets</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={entry.sets ?? ''}
                        onChange={(e) => {
                          const newTemplate = [...(templateForm.strength_template || [])];
                          newTemplate[idx].sets = parseInt(e.target.value) || undefined;
                          setTemplateForm((f) => ({ ...f, strength_template: newTemplate }));
                        }}
                        placeholder="Inherit"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Reps</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={entry.reps ?? ''}
                        onChange={(e) => {
                          const newTemplate = [...(templateForm.strength_template || [])];
                          newTemplate[idx].reps = parseInt(e.target.value) || undefined;
                          setTemplateForm((f) => ({ ...f, strength_template: newTemplate }));
                        }}
                        placeholder="Inherit"
                        className={inputCls}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => {
                          const newTemplate = [...(templateForm.strength_template || [])];
                          newTemplate.splice(idx, 1);
                          setTemplateForm((f) => ({ ...f, strength_template: newTemplate }));
                        }}
                        className="text-xs text-warning hover:text-warning/80"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const newTemplate = [
                      ...(templateForm.strength_template || []),
                      { week: (templateForm.strength_template?.length ?? 0) + 1 },
                    ];
                    setTemplateForm((f) => ({ ...f, strength_template: newTemplate }));
                  }}
                  className="px-3 py-1.5 text-xs bg-surface-light text-foreground rounded hover:bg-surface-light/70"
                >
                  + Add Week
                </button>
              </div>
            </div>
          </div>
        )}

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
            className="px-6 py-2.5 bg-surface-light text-muted rounded-lg font-medium hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-8 text-center">
      <ClipboardList className="w-12 h-12 mx-auto text-muted mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">Create a plan</h3>
      <p className="text-muted mb-6">Start from scratch, or generate one from a template.</p>
      <div className="flex flex-col sm:flex-row justify-center gap-3">
        <button
          onClick={() => setMode('scratch')}
          className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors"
        >
          <Pencil className="w-4 h-4 inline mr-1.5" /> Start From Scratch
        </button>
        <button
          onClick={() => setMode('template')}
          className="px-6 py-3 bg-surface-light text-foreground rounded-lg font-medium hover:bg-surface-light/70 transition-colors"
        >
          <Zap className="w-4 h-4 mr-2" /> Use Template
        </button>
      </div>
    </div>
  );
}
