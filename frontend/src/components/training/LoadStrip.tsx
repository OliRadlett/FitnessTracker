'use client';

/**
 * LoadStrip — the plan spine's read-out: weekly planned load bars, stored block
 * bands, event markers, the linked event's taper window, and today.
 *
 * The bars, markers, taper and today marker are *derived* (see `derivePeaks`).
 * The bands are not: they are the plan's stored blocks (redesign plan §11 C1),
 * so the phase names drawn here are the user's own. A plan with no blocks shows
 * no bands — the strip still invents nothing.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flag, Layers } from 'lucide-react';

import type { Event, TrainingPlan } from '@/lib/api';
import { getPlanBlocks, useAuthFetch } from '@/lib/api';
import { derivePeaks } from '@/lib/training/peaks';
import { BlockEditor } from './plan/BlockEditor';

export interface LoadStripProps {
  plan: TrainingPlan | null;
  events: Event[];
}

export function LoadStrip({ plan, events }: LoadStripProps) {
  const { authFetch, token } = useAuthFetch();
  const [editorOpen, setEditorOpen] = useState(false);

  const blocksQuery = useQuery({
    queryKey: ['plan-blocks', plan?.id],
    queryFn: () => getPlanBlocks(authFetch, plan!.id),
    enabled: !!token && !!plan,
  });

  const { weeks, markers, bands, taperStart, todayIndex } = derivePeaks(
    plan,
    events,
    // The strip sits on the spine, so a malformed payload here would cost the
    // user the whole page via the error boundary. Normalise rather than trust.
    Array.isArray(blocksQuery.data) ? blocksQuery.data : [],
  );

  if (!plan || weeks.length === 0) return null;

  const max = Math.max(...weeks.map((w) => w.totalTss), 1);
  const eventMarkers = markers.filter((m) => m.kind === 'event');
  const bandAt = (weekIndex: number) =>
    bands.find(
      (b) =>
        b.startIndex != null &&
        b.endIndex != null &&
        weekIndex >= b.startIndex &&
        weekIndex <= b.endIndex,
    );

  return (
    <div className="space-y-1">
      {bands.length > 0 && (
        <div className="flex gap-0.5" role="img" aria-label="Plan blocks">
          {weeks.map((w) => {
            const band = bandAt(w.weekIndex);
            return (
              <div
                key={w.weekIndex}
                title={
                  band
                    ? `${band.name}${
                        band.targetTssPerWeek != null
                          ? ` · ${band.targetTssPerWeek} TSS/wk`
                          : ''
                      }`
                    : undefined
                }
                className={`flex-1 h-4 rounded-sm text-[9px] leading-4 px-0.5 truncate ${
                  band ? 'bg-accent/15 text-accent' : ''
                }`}
              >
                {band && w.weekIndex === band.startIndex ? band.name : ''}
              </div>
            );
          })}
        </div>
      )}

      <div
        className="flex items-end gap-0.5 h-10"
        role="img"
        aria-label="Weekly planned load"
      >
        {weeks.map((w) => {
          const h = Math.max(6, Math.round((w.totalTss / max) * 100));
          const inTaper = taperStart != null && w.end >= taperStart;
          return (
            <div
              key={w.weekIndex}
              title={`Week ${w.weekIndex + 1}: ${w.totalTss} TSS${
                inTaper ? ' (taper)' : ''
              }`}
              className={`flex-1 rounded-sm ${inTaper ? 'bg-warning/50' : 'bg-accent/50'} ${
                todayIndex === w.weekIndex ? 'ring-1 ring-accent' : ''
              }`}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-muted flex flex-wrap items-center gap-x-2">
          {eventMarkers.map((m) => (
            <span key={m.date} className="inline-flex items-center gap-0.5">
              <Flag className="w-3 h-3 text-accent" aria-hidden="true" />
              {m.label} ({m.date})
            </span>
          ))}
          {taperStart && <span className="text-warning">taper from {taperStart}</span>}
        </p>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-foreground transition-colors min-h-[24px] shrink-0"
        >
          <Layers className="w-3 h-3" aria-hidden="true" />
          Blocks
        </button>
      </div>

      <BlockEditor plan={plan} open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
