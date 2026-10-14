'use client';

/**
 * LoadStrip — the plan spine's derived peaks read-out: weekly planned load
 * bars, event markers, the linked event's taper window, and today.
 *
 * Derived client-side (see `derivePeaks`) because there is no stored
 * block/phase model; it invents no phase names. When the block model lands
 * (redesign plan §11 C1) this becomes the interactive macrocycle canvas.
 */

import React from 'react';
import { Flag } from 'lucide-react';

import type { Event, TrainingPlan } from '@/lib/api';
import { derivePeaks } from '@/lib/training/peaks';

export interface LoadStripProps {
  plan: TrainingPlan | null;
  events: Event[];
}

export function LoadStrip({ plan, events }: LoadStripProps) {
  const { weeks, markers, taperStart, todayIndex } = derivePeaks(plan, events);
  if (weeks.length === 0) return null;

  const max = Math.max(...weeks.map((w) => w.totalTss), 1);
  const eventMarkers = markers.filter((m) => m.kind === 'event');

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-0.5 h-10" role="img" aria-label="Weekly planned load">
        {weeks.map((w) => {
          const h = Math.max(6, Math.round((w.totalTss / max) * 100));
          const inTaper = taperStart != null && w.end >= taperStart;
          return (
            <div
              key={w.weekIndex}
              title={`Week ${w.weekIndex + 1}: ${w.totalTss} TSS${inTaper ? ' (taper)' : ''}`}
              className={`flex-1 rounded-sm ${inTaper ? 'bg-warning/50' : 'bg-accent/50'} ${
                todayIndex === w.weekIndex ? 'ring-1 ring-accent' : ''
              }`}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>

      {(eventMarkers.length > 0 || taperStart) && (
        <p className="text-[10px] text-muted flex flex-wrap items-center gap-x-2">
          {eventMarkers.map((m) => (
            <span key={m.date} className="inline-flex items-center gap-0.5">
              <Flag className="w-3 h-3 text-accent" />
              {m.label} ({m.date})
            </span>
          ))}
          {taperStart && <span className="text-warning">taper from {taperStart}</span>}
        </p>
      )}
    </div>
  );
}
