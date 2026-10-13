'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';

import type { TrainingPlanSummary } from '@/lib/api';

const STATUS_DOT: Record<string, string> = {
  active: 'bg-positive',
  draft: 'bg-muted',
  completed: 'bg-blue-400',
  archived: 'bg-muted',
};

export interface PlanSwitcherProps {
  plans: TrainingPlanSummary[];
  selectedPlanId: string | null;
  onSelect: (planId: string) => void;
  /** Opens the Plans surface (`?mode=plans`). */
  onManage: () => void;
}

/**
 * PlanSwitcher — dropdown for choosing the active plan and reaching the Plans
 * surface. Presentational: selection + URL state live in `useTrainingShell`.
 */
export function PlanSwitcher({
  plans,
  selectedPlanId,
  onSelect,
  onManage,
}: PlanSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = plans.find((p) => p.id === selectedPlanId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg bg-surface-light/40 border border-surface-light/60 text-sm text-foreground hover:bg-surface-light/60 transition-colors"
      >
        <span className="max-w-[10rem] truncate">{selected?.name ?? 'Select plan'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-surface-light bg-surface p-1 max-h-80 overflow-y-auto"
        >
          {plans.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">No plans yet</p>
          )}
          {plans.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              type="button"
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-md text-left text-sm transition-colors ${
                p.id === selectedPlanId
                  ? 'bg-accent/10 text-foreground'
                  : 'text-muted hover:text-foreground hover:bg-surface-light/40'
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[p.status] ?? 'bg-muted'}`}
              />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-[10px] text-muted shrink-0 capitalize">{p.status}</span>
            </button>
          ))}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onManage();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] mt-1 rounded-md text-left text-sm text-accent hover:bg-surface-light/40 border-t border-surface-light/50 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Manage plans
          </button>
        </div>
      )}
    </div>
  );
}
