'use client';

import React from 'react';
import { CalendarRange, LineChart, Flag } from 'lucide-react';

import {
  TRAINING_MODES,
  type TrainingMode,
} from '@/lib/training/trainingModes';

const MODE_META: Record<
  'plan' | 'review' | 'peaks',
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  plan: { label: 'Plan', Icon: CalendarRange },
  review: { label: 'Review', Icon: LineChart },
  peaks: { label: 'Peaks', Icon: Flag },
};

export interface ModeSwitchProps {
  mode: TrainingMode;
  onChange: (mode: TrainingMode) => void;
}

/**
 * ModeSwitch — the Plan / Review / Peaks segmented control that frames the
 * training page. Selection is URL-backed (`?mode=`) via `useTrainingShell`;
 * this component is presentational.
 */
export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div
      role="tablist"
      aria-label="Training mode"
      className="flex items-center gap-1 p-1 rounded-lg bg-surface-light/30 w-fit"
    >
      {TRAINING_MODES.filter(
        (m): m is 'plan' | 'review' | 'peaks' => m !== 'plans',
      ).map((m) => {
        const { label, Icon } = MODE_META[m];
        // The Plans surface (`?mode=plans`) is reached from the spine — keep
        // Plan highlighted rather than leaving no tab active.
        const selected = mode === m || (mode === 'plans' && m === 'plan');
        return (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(m)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-md transition-colors ${
              selected ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
