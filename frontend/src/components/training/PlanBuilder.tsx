'use client';

import React, { useState, useCallback } from 'react';
import type { TrainingPlan, TrainingPlanDay, GeneratePlanPayload } from '@/lib/api';

const DAY_TYPES = ['rest', 'easy', 'moderate', 'hard', 'race'] as const;
const DAY_TYPE_COLORS: Record<string, string> = {
  rest: 'bg-gray-700 border-gray-600 text-gray-400',
  easy: 'bg-green-900/40 border-green-700/50 text-green-300',
  moderate: 'bg-blue-900/40 border-blue-700/50 text-blue-300',
  hard: 'bg-orange-900/40 border-orange-700/50 text-orange-300',
  race: 'bg-red-900/40 border-red-700/50 text-red-300',
};
const DAY_TYPE_EMOJI: Record<string, string> = {
  rest: '😴',
  easy: '🚶',
  moderate: '🏃',
  hard: '🔥',
  race: '🏁',
};

interface PlanBuilderProps {
  plan?: TrainingPlan;
  onSave: (days: TrainingPlanDay[]) => void;
  onGenerate: (payload: GeneratePlanPayload) => void;
  isSaving?: boolean;
}

function getWeekDates(startDate: string, weekIndex: number): string[] {
  const start = new Date(startDate);
  start.setDate(start.getDate() + weekIndex * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

function getDayOfWeek(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
}

export function PlanBuilder({ plan, onSave, onGenerate, isSaving }: PlanBuilderProps) {
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateForm, setGenerateForm] = useState<GeneratePlanPayload>({
    name: '',
    template_type: 'build',
    weeks: 4,
    start_date: new Date().toISOString().split('T')[0],
    base_tss: 300,
  });

  // Local editable copy of days for drag interactions
  const [days, setDays] = useState<TrainingPlanDay[]>(plan?.days ?? []);

  // Compute weeks from plan dates
  const startDate = plan?.start_date || generateForm.start_date;
  const endDate = plan?.end_date || '';
  const totalDays = plan ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1 : generateForm.weeks! * 7;
  const totalWeeks = Math.ceil(totalDays / 7);

  const updateDay = useCallback((dateStr: string, field: keyof TrainingPlanDay, value: string | number | boolean | undefined) => {
    setDays(prev => {
      const existing = prev.find(d => d.day_date === dateStr);
      if (existing) {
        return prev.map(d => d.day_date === dateStr ? { ...d, [field]: value } : d);
      }
      return [...prev, {
        id: `temp-${dateStr}`,
        plan_id: plan?.id || '',
        day_date: dateStr,
        planned_type: field === 'planned_type' ? (value as string) : 'rest',
        planned_tss: field === 'planned_tss' ? (value as number) : undefined,
        planned_duration_min: field === 'planned_duration_min' ? (value as number) : undefined,
        completed: false,
        created_at: new Date().toISOString(),
      } as TrainingPlanDay];
    });
  }, [plan?.id]);

  const handleGenerate = () => {
    onGenerate(generateForm);
    setShowGenerate(false);
  };

  const handleSave = () => {
    onSave(days);
  };

  // Weekly TSS summary
  const weekSummaries = Array.from({ length: totalWeeks }, (_, wi) => {
    const weekDates = getWeekDates(startDate, wi);
    const weekDays = days.filter(d => weekDates.includes(d.day_date));
    const totalTss = weekDays.reduce((sum, d) => sum + (d.planned_tss || 0), 0);
    const totalDuration = weekDays.reduce((sum, d) => sum + (d.planned_duration_min || 0), 0);
    const trainingDays = weekDays.filter(d => d.planned_type !== 'rest').length;
    return { weekIndex: wi, totalTss, totalDuration, trainingDays };
  });

  if (!plan && !showGenerate) {
    return (
      <div className="space-y-6">
        <div className="bg-surface rounded-xl border border-surface-light/50 p-8 text-center">
          <p className="text-4xl mb-4">📋</p>
          <h3 className="text-lg font-semibold text-white mb-2">No Training Plan</h3>
          <p className="text-muted mb-6">Create a plan from scratch or generate one from a template.</p>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setShowGenerate(true)}
              className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors"
            >
              ⚡ Auto-Generate Plan
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showGenerate) {
    return (
      <div className="bg-surface rounded-xl border border-surface-light/50 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">⚡ Generate Training Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm text-muted mb-1">Plan Name</label>
            <input
              type="text"
              value={generateForm.name}
              onChange={e => setGenerateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Build Phase"
              className="w-full px-3 py-2 bg-background border border-surface-light rounded-lg text-white focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Template Type</label>
            <select
              value={generateForm.template_type}
              onChange={e => setGenerateForm(f => ({ ...f, template_type: e.target.value }))}
              className="w-full px-3 py-2 bg-background border border-surface-light rounded-lg text-white focus:outline-none focus:border-accent"
            >
              <option value="base">Base — Steady foundation</option>
              <option value="build">Build — Progressive overload</option>
              <option value="peak">Peak — High intensity</option>
              <option value="taper">Taper — Pre-event reduction</option>
              <option value="recovery">Recovery — Active rest</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Weeks</label>
            <input
              type="number"
              min={1}
              max={24}
              value={generateForm.weeks}
              onChange={e => setGenerateForm(f => ({ ...f, weeks: parseInt(e.target.value) || 4 }))}
              className="w-full px-3 py-2 bg-background border border-surface-light rounded-lg text-white focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Start Date</label>
            <input
              type="date"
              value={generateForm.start_date}
              onChange={e => setGenerateForm(f => ({ ...f, start_date: e.target.value }))}
              className="w-full px-3 py-2 bg-background border border-surface-light rounded-lg text-white focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Base Weekly TSS</label>
            <input
              type="number"
              min={50}
              max={1500}
              step={25}
              value={generateForm.base_tss}
              onChange={e => setGenerateForm(f => ({ ...f, base_tss: parseFloat(e.target.value) || 300 }))}
              className="w-full px-3 py-2 bg-background border border-surface-light rounded-lg text-white focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            disabled={!generateForm.name}
            className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            Generate Plan
          </button>
          <button
            onClick={() => setShowGenerate(false)}
            className="px-6 py-3 bg-surface-light text-muted rounded-lg font-medium hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plan Header */}
      {plan && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{plan.name}</h2>
            {plan.description && <p className="text-muted text-sm mt-1">{plan.description}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : '💾 Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Weekly Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {weekSummaries.map(ws => (
          <div key={ws.weekIndex} className="bg-surface rounded-lg border border-surface-light/50 p-3 text-center">
            <p className="text-xs text-muted mb-1">Week {ws.weekIndex + 1}</p>
            <p className="text-lg font-bold text-white">{Math.round(ws.totalTss)}</p>
            <p className="text-xs text-muted">TSS</p>
            <p className="text-xs text-muted mt-1">{ws.trainingDays} days · {ws.totalDuration}min</p>
          </div>
        ))}
      </div>

      {/* Weekly Calendar Grid */}
      {Array.from({ length: totalWeeks }, (_, wi) => {
        const weekDates = getWeekDates(startDate, wi);
        return (
          <div key={wi} className="bg-surface rounded-xl border border-surface-light/50 p-4">
            <h3 className="text-sm font-semibold text-muted mb-3 uppercase tracking-wider">
              Week {wi + 1}
            </h3>
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map(dateStr => {
                const day = days.find(d => d.day_date === dateStr);
                const ptype = day?.planned_type || 'rest';
                return (
                  <div
                    key={dateStr}
                    className={`rounded-lg border p-2 min-h-[100px] ${DAY_TYPE_COLORS[ptype]}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{getDayOfWeek(dateStr)}</span>
                      <span className="text-sm">{DAY_TYPE_EMOJI[ptype]}</span>
                    </div>
                    <p className="text-xs opacity-75 mb-2">{dateStr.slice(5)}</p>

                    {/* Type selector */}
                    <select
                      value={ptype}
                      onChange={e => updateDay(dateStr, 'planned_type', e.target.value)}
                      className="w-full text-xs bg-transparent border-0 p-0 focus:outline-none cursor-pointer mb-1"
                    >
                      {DAY_TYPES.map(dt => (
                        <option key={dt} value={dt} className="bg-background text-white">
                          {DAY_TYPE_EMOJI[dt]} {dt}
                        </option>
                      ))}
                    </select>

                    {/* TSS input */}
                    {ptype !== 'rest' && (
                      <div className="space-y-1">
                        <input
                          type="number"
                          placeholder="TSS"
                          value={day?.planned_tss ?? ''}
                          onChange={e => updateDay(dateStr, 'planned_tss', parseFloat(e.target.value) || 0)}
                          className="w-full text-xs bg-transparent border border-current/20 rounded px-1 py-0.5 focus:outline-none"
                        />
                        <input
                          type="number"
                          placeholder="min"
                          value={day?.planned_duration_min ?? ''}
                          onChange={e => updateDay(dateStr, 'planned_duration_min', parseInt(e.target.value) || 0)}
                          className="w-full text-xs bg-transparent border border-current/20 rounded px-1 py-0.5 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {DAY_TYPES.map(dt => (
          <div key={dt} className="flex items-center gap-1.5">
            <span>{DAY_TYPE_EMOJI[dt]}</span>
            <span className="text-xs text-muted capitalize">{dt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
