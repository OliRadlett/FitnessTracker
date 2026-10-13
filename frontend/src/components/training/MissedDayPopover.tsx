'use client';

/**
 * MissedDayPopover — quick actions for a missed plan day.
 *
 * Opens as a bottom sheet on mobile / centred dialog on desktop (the shared
 * Modal handles both). Offers four actions:
 *   - Move to another date (a real reschedule; 409 when the slot is taken)
 *   - Substitute a lighter session on the same date
 *   - Mark the day as rest
 *   - Dismiss (leave it as-is)
 */

import React from 'react';
import { CalendarClock, ArrowRight, ArrowDownRight, Bed, X } from 'lucide-react';
import { Modal, ModalHeader } from '@/components/ui/Modal';

export interface MissedDayPopoverProps {
  open: boolean;
  onClose: () => void;
  /** Human label of the missed day, e.g. "Mon 6 Oct". */
  dayLabel: string;
  /** Human label of the next day, used in the reschedule action. */
  nextDayLabel: string | null;
  onReschedule: () => void;
  onSubstitute: () => void;
  onMarkRest: () => void;
  busy: boolean;
}

export function MissedDayPopover({
  open,
  onClose,
  dayLabel,
  nextDayLabel,
  onReschedule,
  onSubstitute,
  onMarkRest,
  busy,
}: MissedDayPopoverProps) {
  const canReschedule = !!nextDayLabel;

  return (
    <Modal open={open} onClose={onClose} size="sm" aria-label="Missed day options">
      <ModalHeader
        title={`Missed: ${dayLabel}`}
        onClose={onClose}
        icon={<CalendarClock className="w-5 h-5 text-warning" />}
      />

      <p className="text-sm text-muted mb-4">
        This planned day has passed without a logged session. Move it, swap in a
        lighter session, set it as rest, or leave it as-is.
      </p>

      <div className="space-y-2">
        <button
          onClick={onReschedule}
          disabled={!canReschedule || busy}
          title={canReschedule ? undefined : 'No next day available in this week'}
          className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-surface-light/40 border border-surface-light/50 text-sm text-foreground hover:bg-surface-light/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ArrowRight className="w-4 h-4 text-accent shrink-0" />
          <span className="flex-1 text-left">
            Move to next day
            {nextDayLabel && <span className="text-muted"> · {nextDayLabel}</span>}
          </span>
        </button>

        <button
          onClick={onSubstitute}
          disabled={busy}
          className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-surface-light/40 border border-surface-light/50 text-sm text-foreground hover:bg-surface-light/60 disabled:opacity-40 transition-colors"
        >
          <ArrowDownRight className="w-4 h-4 text-muted shrink-0" />
          <span className="flex-1 text-left">Substitute a lighter session</span>
        </button>

        <button
          onClick={onMarkRest}
          disabled={busy}
          className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-surface-light/40 border border-surface-light/50 text-sm text-foreground hover:bg-surface-light/60 disabled:opacity-40 transition-colors"
        >
          <Bed className="w-4 h-4 text-muted shrink-0" />
          <span className="flex-1 text-left">Mark as rest day</span>
        </button>

        <button
          onClick={onClose}
          disabled={busy}
          className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg text-sm text-muted hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <X className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Dismiss</span>
        </button>
      </div>
    </Modal>
  );
}
