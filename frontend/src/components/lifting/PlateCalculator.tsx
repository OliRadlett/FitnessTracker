'use client';

import { useMemo, useState } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { computePlates } from '@/lib/lifting/plates';

const BAR_WEIGHTS = [20, 15];

interface PlateCalculatorProps {
  open: boolean;
  onClose: () => void;
  weightKg: number;
}

/** Per-side plate loading for a target barbell weight. Suggestion only. */
export function PlateCalculator({ open, onClose, weightKg }: PlateCalculatorProps) {
  const [barWeight, setBarWeight] = useState(20);

  const { counts, leftover, totalPlates } = useMemo(
    () => computePlates(weightKg, barWeight),
    [weightKg, barWeight]
  );

  const achievable = weightKg - leftover * 2;

  return (
    <Modal open={open} onClose={onClose} size="sm" aria-label="Plate calculator">
      <ModalHeader title="Plate calculator" onClose={onClose} />
      <p className="text-sm text-muted mb-3">
        Target <span className="text-foreground font-semibold">{weightKg}kg</span> ·{' '}
        {barWeight}kg bar
      </p>
      <div className="flex gap-2 mb-4">
        {BAR_WEIGHTS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBarWeight(b)}
            className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
              barWeight === b
                ? 'bg-accent text-background'
                : 'bg-surface-light text-foreground'
            }`}
          >
            {b}kg bar
          </button>
        ))}
      </div>

      {weightKg < barWeight ? (
        <p className="text-warning text-sm">Target is lighter than the bar.</p>
      ) : counts.length === 0 ? (
        <p className="text-foreground text-sm">Just the bar — no plates needed.</p>
      ) : (
        <>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Per side
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {counts.map(({ plate, count }) => (
              <span
                key={plate}
                className="px-3 py-2 rounded-lg bg-surface-light text-foreground text-sm font-semibold tabular-nums"
              >
                {plate}kg × {count}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted">
            {totalPlates} plate{totalPlates === 1 ? '' : 's'} per side
          </p>
          {leftover > 0.001 && (
            <p className="text-warning text-xs mt-2">
              Closest exact load is {achievable.toFixed(2)}kg —{' '}
              {leftover.toFixed(2)}kg per side short (no small-enough plates).
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
