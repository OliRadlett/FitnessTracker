'use client';

import React from 'react';
import { Flame } from 'lucide-react';
import type { LiftingSession, LiftingSet } from '@/lib/api';
import { e1rm } from '@/lib/lifting/overview';

const amount = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: n % 1 ? 1 : 0 });

function group(sets: LiftingSet[]) {
  const order: string[] = [];
  const map = new Map<string, LiftingSet[]>();
  for (const set of sets) {
    if (!map.has(set.exercise_name)) {
      map.set(set.exercise_name, []);
      order.push(set.exercise_name);
    }
    map.get(set.exercise_name)!.push(set);
  }
  return order.map((name) => ({
    name,
    sets: map
      .get(name)!
      .slice()
      .sort((a, b) => {
        const ai = a.order_index ?? a.set_number;
        const bi = b.order_index ?? b.set_number;
        return ai === bi ? a.set_number - b.set_number : ai - bi;
      }),
  }));
}

/**
 * Read-only set ladder: one row per set with weight, reps, RPE and the delta to
 * the same set number in the previous same-focus session. Warm-ups are
 * subordinate; the best working set per exercise is marked once.
 */
export function SetLadder({
  session,
  previous,
}: {
  session: LiftingSession;
  previous: LiftingSession | null;
}) {
  const groups = group(session.sets ?? []);
  if (groups.length === 0) return null;

  const prevByName = new Map<string, LiftingSet[]>();
  for (const set of previous?.sets ?? []) {
    const arr = prevByName.get(set.exercise_name) ?? [];
    arr.push(set);
    prevByName.set(set.exercise_name, arr);
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Set review</p>
          <p className="mt-0.5 text-[12px] text-muted">One row per set; the delta compares the same set number with the last same-focus session.</p>
        </div>
        <span className="text-[12px] text-muted">{session.sets.length} sets</span>
      </div>

      <div className="space-y-4">
        {groups.map((g) => {
          const working = g.sets.filter((s) => !s.is_warmup);
          const top = working.length
            ? working.reduce((a, b) => (e1rm(b.weight_kg, b.reps) > e1rm(a.weight_kg, a.reps) ? b : a))
            : null;
          return (
            <div key={g.name}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                  {g.name}
                  {working.some((s) => s.rpe != null && s.rpe >= 9) && (
                    <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-caution">
                      <Flame className="h-3 w-3" aria-hidden /> hard
                    </span>
                  )}
                </p>
                <span className="text-[12px] text-muted">{top ? `top ${amount(top.weight_kg)} kg × ${top.reps}` : `${g.sets.length} sets`}</span>
              </div>

              <div className="mt-1.5 grid grid-cols-[22px_1fr_44px_34px_40px] items-center gap-x-1.5 border-b border-surface-light/50 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted sm:grid-cols-[24px_120px_56px_44px_52px_56px] sm:gap-x-2">
                <span>#</span>
                <span>Weight</span>
                <span className="text-right">Reps</span>
                <span className="text-right">RPE</span>
                <span className="text-right">Δ</span>
                <span className="hidden sm:block" />
              </div>

              {g.sets.map((set) => {
                const prev = (prevByName.get(g.name) ?? []).find((p) => p.set_number === set.set_number);
                const diff = prev ? set.weight_kg - prev.weight_kg : null;
                const isTop = top?.id === set.id;
                return (
                  <div
                    key={set.id}
                    className={`grid grid-cols-[22px_1fr_44px_34px_40px] items-center gap-x-1.5 border-b border-surface-light/30 py-1.5 text-[12px] last:border-b-0 sm:grid-cols-[24px_120px_56px_44px_52px_56px] sm:gap-x-2 ${
                      isTop ? 'bg-accent/[0.06]' : ''
                    } ${set.is_warmup ? 'opacity-60' : ''}`}
                  >
                    <span className="font-mono text-[12px] text-muted">{set.is_warmup ? 'W' : set.set_number}</span>
                    <span className={`font-mono text-[13px] ${isTop ? 'font-semibold text-accent' : ''}`}>
                      {amount(set.weight_kg)} <span className="font-sans text-[12px] text-muted">kg</span>
                      {isTop && <span className="ml-1 rounded bg-accent/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">top</span>}
                    </span>
                    <span className="text-right font-mono text-[13px]">{set.reps}</span>
                    <span className="text-right font-mono text-[12px] text-muted">{set.rpe ?? '—'}</span>
                    <span
                      className={`text-right font-mono text-[12px] ${
                        diff == null ? 'text-muted/60' : diff > 0 ? 'text-positive' : diff < 0 ? 'text-caution' : 'text-muted'
                      }`}
                    >
                      {diff == null ? '—' : diff === 0 ? 'same' : `${diff > 0 ? '+' : ''}${amount(diff)}`}
                    </span>
                    <span className="hidden sm:block" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
