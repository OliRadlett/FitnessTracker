'use client';

/**
 * BlockEditor — create, edit and delete a plan's stored blocks (C1).
 *
 * The load strip draws blocks; this is where they come from. Containment and
 * non-overlap are enforced by the block endpoints, so an overlap comes back as
 * a 409 and is shown as the server's own words rather than being pre-empted by
 * a client-side guess at the same rule.
 *
 * Blocks are labels on a date range. Nothing here changes or deletes days.
 */

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';

import {
  createPlanBlock,
  deletePlanBlock,
  getPlanBlocks,
  updatePlanBlock,
  useAuthFetch,
} from '@/lib/api';
import type { TrainingPlan, TrainingPlanBlock } from '@/lib/api';
import { Modal, ModalHeader } from '@/components/ui/Modal';

/** Suggestions only — the backend stores any string. */
const FOCUS_OPTIONS = ['base', 'build', 'peak', 'taper', 'recovery', 'race'];

interface Draft {
  name: string;
  focus: string;
  start_date: string;
  end_date: string;
  target_tss_per_week: string;
}

function draftFrom(block: TrainingPlanBlock): Draft {
  return {
    name: block.name,
    focus: block.focus ?? '',
    start_date: block.start_date.slice(0, 10),
    end_date: block.end_date.slice(0, 10),
    target_tss_per_week:
      block.target_tss_per_week == null ? '' : String(block.target_tss_per_week),
  };
}

function payloadFrom(draft: Draft) {
  return {
    name: draft.name.trim(),
    focus: draft.focus.trim() || null,
    start_date: draft.start_date,
    end_date: draft.end_date,
    // An empty box means "no target", not 0.
    target_tss_per_week:
      draft.target_tss_per_week.trim() === ''
        ? null
        : Number(draft.target_tss_per_week),
  };
}

function emptyDraft(plan: TrainingPlan): Draft {
  // A week from today, clamped inside the plan: the common case is "the next
  // phase", and a default that already fits saves the two date edits.
  const today = new Date().toISOString().slice(0, 10);
  const start = today > plan.start_date.slice(0, 10) ? today : plan.start_date.slice(0, 10);
  const end = new Date(new Date(start).getTime() + 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const planEnd = plan.end_date.slice(0, 10);
  return {
    name: '',
    focus: '',
    start_date: start,
    end_date: end > planEnd ? planEnd : end,
    target_tss_per_week: '',
  };
}

export interface BlockEditorProps {
  plan: TrainingPlan;
  open: boolean;
  onClose: () => void;
}

export function BlockEditor({ plan, open, onClose }: BlockEditorProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(() => emptyDraft(plan));

  const blocksQuery = useQuery({
    queryKey: ['plan-blocks', plan.id],
    queryFn: () => getPlanBlocks(authFetch, plan.id),
    enabled: !!token && open,
  });
  const blocks = blocksQuery.data ?? [];

  // Re-seed the drafts from the server value whenever it changes, so a save
  // shows what was stored rather than what was typed.
  useEffect(() => {
    const data = blocksQuery.data ?? [];
    setEdits(Object.fromEntries(data.map((b) => [b.id, draftFrom(b)])));
  }, [blocksQuery.data]);

  const done = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ['plan-blocks', plan.id] });
  };
  const fail = (e: Error) => setError(e.message);

  const createMutation = useMutation({
    mutationFn: (draft: Draft) => createPlanBlock(authFetch, plan.id, payloadFrom(draft)),
    onSuccess: () => {
      setNewDraft(emptyDraft(plan));
      done();
    },
    onError: fail,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: Draft }) =>
      updatePlanBlock(authFetch, plan.id, id, payloadFrom(draft)),
    onSuccess: done,
    onError: fail,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlanBlock(authFetch, plan.id, id),
    onSuccess: done,
    onError: fail,
  });

  const setField = (id: string, patch: Partial<Draft>) =>
    setEdits((s) => (s[id] ? { ...s, [id]: { ...s[id], ...patch } } : s));

  const inputClass =
    'bg-surface-light rounded px-2 py-1.5 text-sm min-h-[36px] focus:outline-none focus:ring-1 focus:ring-accent';

  const fields = (
    draft: Draft,
    onPatch: (patch: Partial<Draft>) => void,
    idPrefix: string,
  ) => (
    <>
      <div className="flex gap-2">
        <input
          aria-label="Block name"
          placeholder="Base 1"
          className={`flex-1 min-w-0 ${inputClass}`}
          value={draft.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <select
          aria-label="Block focus"
          className={`${inputClass} w-28`}
          value={draft.focus}
          onChange={(e) => onPatch({ focus: e.target.value })}
        >
          <option value="">focus…</option>
          {FOCUS_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-muted">from</span>
          <input
            id={`${idPrefix}-start`}
            type="date"
            aria-label="Block start"
            className={inputClass}
            value={draft.start_date}
            onChange={(e) => onPatch({ start_date: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">to</span>
          <input
            id={`${idPrefix}-end`}
            type="date"
            aria-label="Block end"
            className={inputClass}
            value={draft.end_date}
            onChange={(e) => onPatch({ end_date: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">TSS/wk</span>
          <input
            id={`${idPrefix}-tss`}
            type="number"
            min={0}
            aria-label="Target TSS per week"
            className={`${inputClass} w-20`}
            value={draft.target_tss_per_week}
            onChange={(e) => onPatch({ target_tss_per_week: e.target.value })}
          />
        </label>
      </div>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} size="lg" aria-label="Plan blocks">
      <ModalHeader title="Blocks" onClose={onClose} />
      <p className="text-xs text-muted mb-3">
        Name the phases of this plan. A block labels a date range — it never
        changes or deletes the days inside it.
      </p>

      {error && (
        <p className="mb-3 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {blocksQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!blocksQuery.isLoading && blocks.length === 0 && (
          <p className="text-sm text-muted">No blocks yet.</p>
        )}

        {blocks.map((b) => {
          const draft = edits[b.id] ?? draftFrom(b);
          const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(b));
          return (
            <div
              key={b.id}
              className="rounded-lg border border-surface-light p-3 space-y-2"
            >
              {fields(draft, (patch) => setField(b.id, patch), b.id)}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(b.id)}
                  disabled={deleteMutation.isPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors min-h-[36px]"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => updateMutation.mutate({ id: b.id, draft })}
                  disabled={!dirty || updateMutation.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors min-h-[36px]"
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-surface-light pt-3 space-y-2">
        <p className="text-xs font-medium text-muted">Add a block</p>
        {fields(newDraft, (patch) => setNewDraft((d) => ({ ...d, ...patch })), 'new')}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => createMutation.mutate(newDraft)}
            disabled={!newDraft.name.trim() || createMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors min-h-[36px]"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add block
          </button>
        </div>
      </div>
    </Modal>
  );
}
