'use client';

import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthFetch } from '@/lib/api';
import type {
  CreateTrainingPlanPayload,
  GeneratePlanPayload,
  TrainingPlan,
  TrainingPlanSummary,
} from '@/lib/api';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { CreatePlanPanel } from '../plan/CreatePlanPanel';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-surface-light/20 text-muted border-muted/30',
  active: 'bg-green-500/20 text-positive border-green-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  archived: 'bg-surface-light/20 text-muted border-muted/30',
};

/**
 * Plans management, as a modal from the spine.
 *
 * The old page gave this its own mode (`?mode=plans`) — a whole navigation state
 * for a list you visit twice a month. Creating, activating, archiving and deleting
 * are the same actions; they just no longer sit beside the week.
 */
export function PlansModal({
  open,
  onClose,
  plans,
  selectedPlanId,
  plansLoading,
  onSelect,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  plans: TrainingPlanSummary[];
  selectedPlanId: string;
  plansLoading: boolean;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['training-plans'] });
    onChanged();
  };

  const createPlan = useMutation({
    mutationFn: (payload: CreateTrainingPlanPayload) =>
      authFetch<TrainingPlan>('/api/v1/training-plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (plan) => {
      invalidate();
      onSelect(plan.id);
    },
  });

  const generatePlan = useMutation({
    mutationFn: (payload: GeneratePlanPayload) =>
      authFetch<TrainingPlan>('/api/v1/training-plans/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (plan) => {
      invalidate();
      onSelect(plan.id);
    },
  });

  const updatePlan = useMutation({
    mutationFn: ({ planId, status }: { planId: string; status: string }) =>
      authFetch<TrainingPlan>(`/api/v1/training-plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidate,
  });

  const deletePlan = useMutation({
    mutationFn: (planId: string) =>
      authFetch<void>(`/api/v1/training-plans/${planId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  if (!open) return null;

  return (
    <Modal open onClose={onClose} size="xl" aria-label="Plans">
      <ModalHeader title="Plans" onClose={onClose} />

      <CreatePlanPanel
        events={[]}
        onCreatePlan={(payload) => createPlan.mutate(payload)}
        onGeneratePlan={(payload) => generatePlan.mutate(payload)}
        isCreating={createPlan.isPending}
        isGenerating={generatePlan.isPending}
      />

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">All plans</p>
        {plansLoading && <div className="h-16 animate-pulse rounded-lg bg-surface-light/30" />}
        {plans.map((p) => {
          // Coverage, not completion: `completed_days / day_count` measures authored
          // days, so it reported 96% for a plan that had run dry. These fields come
          // from the summary, so listing plans never has to load every plan's days.
          const written = p.weeks_written ?? null;
          const total = p.total_weeks ?? null;
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-3 ${
                selectedPlanId === p.id
                  ? 'border-accent/30 bg-accent/10'
                  : 'border-surface-light/50 bg-surface-light/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    STATUS_STYLE[p.status] ?? STATUS_STYLE.draft
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {p.plan_type} · {p.start_date} → {p.end_date}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {written != null && total != null ? (
                  <>
                    <span className="text-foreground">
                      {written} of {total} weeks written
                    </span>
                    {p.uncovered_weeks ? ` · ${p.uncovered_weeks} empty` : ''}
                    {p.last_planned_date ? ` · written to ${p.last_planned_date}` : ''}
                  </>
                ) : (
                  `${p.day_count} authored days`
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="min-h-[44px] text-xs font-medium text-accent hover:underline"
                >
                  Open
                </button>
                {p.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => updatePlan.mutate({ planId: p.id, status: 'active' })}
                    className="min-h-[44px] text-xs font-medium text-positive hover:underline"
                  >
                    Activate
                  </button>
                )}
                {p.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => updatePlan.mutate({ planId: p.id, status: 'archived' })}
                    className="min-h-[44px] text-xs text-muted hover:text-foreground"
                  >
                    Archive
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete plan "${p.name}"? This cannot be undone.`)) {
                      deletePlan.mutate(p.id);
                    }
                  }}
                  className="ml-auto min-h-[44px] text-xs text-warning hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
