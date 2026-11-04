'use client';

import React from 'react';
import { Bike, Dumbbell, Moon } from 'lucide-react';

import { Modal, ModalHeader } from '@/components/ui/Modal';

export type PickedSport = 'cycle' | 'strength' | 'rest';

const CHOICES: { sport: PickedSport; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    sport: 'strength',
    label: 'Strength',
    hint: 'A lifting session',
    icon: <Dumbbell className="h-5 w-5" />,
  },
  { sport: 'cycle', label: 'Ride', hint: 'A bike session', icon: <Bike className="h-5 w-5" /> },
  { sport: 'rest', label: 'Rest', hint: 'A planned rest day', icon: <Moon className="h-5 w-5" /> },
];

const fmt = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getDay() + 6) % 7]} ${d.getDate()} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
  }`;
};

/**
 * Add a session to one date.
 *
 * This is the only "write" affordance the production surface offers, and that is
 * deliberate: `POST /training-plans/{id}/days` exists, while "write a whole week"
 * and "extend the plan" do not (see `PRODUCTION.md` §2). A button that cannot
 * keep its promise is worse than no button.
 */
export function PickActiveSport({
  date,
  busy,
  onPick,
  onCancel,
}: {
  date: string;
  busy: boolean;
  onPick: (sport: PickedSport) => void;
  onCancel: () => void;
}) {
  return (
    <Modal open onClose={onCancel} size="sm" aria-label={`Add a session on ${fmt(date)}`}>
      <ModalHeader title={`Add to ${fmt(date)}`} onClose={onCancel} />
      <div className="space-y-2">
        {CHOICES.map((c) => (
          <button
            key={c.sport}
            type="button"
            disabled={busy}
            onClick={() => onPick(c.sport)}
            className="flex w-full min-h-[56px] items-center gap-3 rounded-lg border border-white/10 px-3 text-left transition-colors hover:border-accent/40 hover:bg-white/[0.04] disabled:opacity-40"
          >
            <span className="text-muted">{c.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{c.label}</span>
              <span className="block text-xs text-muted">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        A second session of the same sport on one date is refused by the server — pick a different
        sport, or add it to another day.
      </p>
    </Modal>
  );
}
