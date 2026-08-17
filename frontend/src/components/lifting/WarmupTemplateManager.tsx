'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { WarmupTemplate, CreateWarmupTemplatePayload } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

interface WarmupStepRow {
  weight_kg: number;
  reps: number;
  notes: string;
}

export function WarmupTemplateManager() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formExercise, setFormExercise] = useState('');
  const [formSteps, setFormSteps] = useState<WarmupStepRow[]>([
    { weight_kg: 0, reps: 0, notes: '' },
  ]);

  const { data: templates, isLoading } = useQuery<WarmupTemplate[]>({
    queryKey: ['warmup-templates'],
    queryFn: () => authFetch<WarmupTemplate[]>('/api/v1/lifting/warmup-templates'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateWarmupTemplatePayload) =>
      authFetch<WarmupTemplate>('/api/v1/lifting/warmup-templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warmup-templates'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateWarmupTemplatePayload }) =>
      authFetch<WarmupTemplate>(`/api/v1/lifting/warmup-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warmup-templates'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      authFetch<void>(`/api/v1/lifting/warmup-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warmup-templates'] });
      setConfirmDeleteId(null);
    },
  });

  function resetForm() {
    setShowCreate(false);
    setEditingId(null);
    setFormName('');
    setFormExercise('');
    setFormSteps([{ weight_kg: 0, reps: 0, notes: '' }]);
  }

  function startEdit(template: WarmupTemplate) {
    setEditingId(template.id);
    setShowCreate(false);
    setFormName(template.name);
    setFormExercise(template.exercise_name || '');
    setFormSteps(
      template.steps.length > 0
        ? template.steps.map((s) => ({ weight_kg: s.weight_kg, reps: s.reps, notes: s.notes || '' }))
        : [{ weight_kg: 0, reps: 0, notes: '' }]
    );
  }

  function updateStep(index: number, updates: Partial<WarmupStepRow>) {
    setFormSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  function addStep() {
    setFormSteps((prev) => [...prev, { weight_kg: 0, reps: 0, notes: '' }]);
  }

  function removeStep(index: number) {
    if (formSteps.length <= 1) return;
    setFormSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    const payload: CreateWarmupTemplatePayload = {
      name: formName.trim(),
      exercise_name: formExercise.trim() || undefined,
      steps: formSteps.map((s, i) => ({
        step_number: i + 1,
        weight_kg: s.weight_kg,
        reps: s.reps,
        notes: s.notes || undefined,
      })),
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isFormVisible = showCreate || editingId !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Warmup Templates</CardTitle>
          {!isFormVisible && (
            <button
              onClick={() => { resetForm(); setShowCreate(true); }}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
            >
              + New Template
            </button>
          )}
        </div>
      </CardHeader>

      {/* Template Form */}
      {isFormVisible && (
        <form onSubmit={handleSubmit} className="p-4 bg-surface-light/30 rounded-lg space-y-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1">Template Name *</label>
              <input
                type="text"
                placeholder="e.g. Bench Press Warmup"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Exercise (optional)</label>
              <ExerciseAutocomplete
                value={formExercise}
                onChange={setFormExercise}
                placeholder="e.g. Bench Press"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs text-muted font-medium px-1">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Weight (kg)</div>
              <div className="col-span-3">Reps</div>
              <div className="col-span-3">Notes</div>
              <div className="col-span-1"></div>
            </div>
            {formSteps.map((step, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-1 text-sm text-muted text-center">{index + 1}</div>
                <div className="col-span-4">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={step.weight_kg || ''}
                    onChange={(e) => updateStep(index, { weight_kg: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min="0"
                    value={step.reps || ''}
                    onChange={(e) => updateStep(index, { reps: parseInt(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="text"
                    value={step.notes}
                    onChange={(e) => updateStep(index, { notes: e.target.value })}
                    placeholder="—"
                    className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  {formSteps.length > 1 && (
                    <button type="button" onClick={() => removeStep(index)} className="text-muted hover:text-warning text-sm">×</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={addStep} className="px-3 py-1.5 bg-surface-light hover:bg-surface text-muted hover:text-white text-sm font-medium rounded-lg transition-colors border border-surface-light">
              + Add Step
            </button>
            <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="px-4 py-1.5 bg-positive hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
              {editingId ? 'Update Template' : 'Save Template'}
            </button>
            <button type="button" onClick={resetForm} className="px-3 py-1.5 text-muted hover:text-white text-sm transition-colors">
              Cancel
            </button>
          </div>
          {(createMutation.isError || updateMutation.isError) && <p className="text-warning text-sm">Failed to save template</p>}
        </form>
      )}

      {/* Template List */}
      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (<div key={i} className="h-16 bg-surface-light rounded-lg"></div>))}
        </div>
      ) : templates && templates.length > 0 ? (
        <div className="space-y-2">
          {templates.map((template) => (
            <div key={template.id} className="p-3 bg-surface-light/30 rounded-lg border border-surface-light/30">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <p className="text-sm font-medium text-white">{template.name}</p>
                  {template.exercise_name && (
                    <p className="text-xs text-accent">{template.exercise_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(template)} className="text-muted hover:text-accent text-xs transition-colors" title="Edit">✏️</button>
                  {confirmDeleteId === template.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => deleteMutation.mutate(template.id)} disabled={deleteMutation.isPending} className="text-xs text-white bg-warning/80 hover:bg-warning px-2 py-0.5 rounded disabled:opacity-50">Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-muted hover:text-white px-2 py-0.5">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(template.id)} className="text-muted hover:text-warning text-xs transition-colors" title="Delete">🗑️</button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {template.steps.map((step) => (
                  <span key={step.id} className="text-xs bg-surface-light px-2 py-0.5 rounded text-muted">
                    {step.weight_kg}kg × {step.reps}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !isFormVisible && <p className="text-muted text-center py-4">No warmup templates yet. Create one to speed up your session setup.</p>
      )}
    </Card>
  );
}
