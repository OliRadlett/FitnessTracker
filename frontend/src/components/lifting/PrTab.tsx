'use client';

import React, { useEffect, useState } from 'react';
import { ChevronRight, Plus, Trophy } from 'lucide-react';
import type { DeficiencyResponse, PersonalRecord } from '@/lib/api';
import { bestPr } from '@/lib/lifting/overview';
import {
  dots,
  levelForRatio,
  nextLevelTarget,
  ratioToBodyweight,
  standardKeyFor,
} from '@/lib/lifting/standards';
import { Card } from '@/components/ui/Card';
import { DeficiencyCard } from '@/components/ui/DeficiencyCard';

const NAMES = ['Back Squat', 'Bench Press', 'Deadlift'] as const;

const amount = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: n % 1 ? 1 : 0 });

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const levelLabel = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

/**
 * PRs tab: three competition-lift cards with standards progress, one summary
 * strip, one history table and the lifting weakness analysis. The manual PR
 * form stays a page-level modal.
 */
export function PrTab({
  prs,
  bodyweightKg,
  isLoading,
  selectedPRId,
  onAddPR,
  onOpenSession,
  deficiency,
  deficiencyLoading,
}: {
  prs: PersonalRecord[];
  bodyweightKg: number | null;
  isLoading: boolean;
  selectedPRId: string | null;
  onAddPR: () => void;
  onOpenSession: (id: string) => void;
  deficiency?: DeficiencyResponse;
  deficiencyLoading?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const cards = NAMES.map((name) => ({ name, pr: bestPr(prs, name) }));
  const total = cards.reduce((sum, c) => sum + (c.pr?.estimated_1rm ?? 0), 0);
  const dotsScore = dots(total, bodyweightKg);
  const sorted = [...prs].sort((a, b) => (a.achieved_date < b.achieved_date ? 1 : -1));
  const rows = showAll ? sorted : sorted.slice(0, 10);

  useEffect(() => {
    if (!selectedPRId) return;
    const el = document.getElementById(`pr-${selectedPRId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedPRId, rows.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Personal records</h2>
          <p className="mt-1 text-[12px] text-muted">Best e1RM per competition lift, with the session it came from.</p>
        </div>
        <button
          type="button"
          onClick={onAddPR}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-surface-light px-3 text-[13px] font-medium text-foreground hover:bg-surface-light/40"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add PR
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map(({ name, pr }) => {
          const value = pr ? (pr.estimated_1rm ?? pr.weight_kg) : null;
          const key = standardKeyFor(name);
          const ratio = value != null ? ratioToBodyweight(value, bodyweightKg) : null;
          const level = key && ratio != null ? levelForRatio(key, ratio) : null;
          const next = key && level ? nextLevelTarget(key, level) : null;
          const selected = pr != null && pr.id === selectedPRId;
          return (
            <div
              key={name}
              id={pr ? `pr-${pr.id}` : undefined}
              className={`rounded-xl border p-4 transition-colors ${
                selected ? 'border-accent/60 bg-accent/[0.05]' : 'border-surface-light/60 bg-surface/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{name}</p>
                  <p className="mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.03em]">
                    {value != null ? `${amount(value)} kg` : '—'}
                  </p>
                  <p className="mt-1.5 text-[12px] text-muted">
                    {pr ? `${amount(pr.weight_kg)} kg × ${pr.reps} · ${shortDate(pr.achieved_date)}` : 'No record'}
                  </p>
                </div>
                {level && (
                  <span
                    className={`rounded-md px-1.5 py-1 text-[12px] font-medium ${
                      level === 'elite' ? 'bg-positive/15 text-positive' : level === 'advanced' ? 'bg-accent/15 text-accent' : 'bg-surface-light/70 text-muted'
                    }`}
                  >
                    {levelLabel(level)}
                  </span>
                )}
              </div>

              <div className="mt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-muted">{ratio != null ? `${ratio.toFixed(2)}× BW` : '—'}</span>
                  <span className="text-[12px] text-muted">
                    {next != null && ratio != null ? `${(next - ratio).toFixed(2)}× to next` : level ? 'Top band' : ''}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-light/70">
                  {ratio != null && (
                    <div className="h-full rounded-full bg-accent/80" style={{ width: `${Math.min(100, Math.max(3, (ratio / 2.5) * 100))}%` }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Big-3 total</p>
            <p className="mt-1 text-[22px] font-semibold leading-none">{total ? `${amount(total)} kg` : '—'}</p>
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Dots</p>
            <p className="mt-1 text-[22px] font-semibold leading-none">{dotsScore ? dotsScore.toFixed(1) : '—'}</p>
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Bodyweight</p>
            <p className="mt-1 text-[22px] font-semibold leading-none">{bodyweightKg ? `${bodyweightKg.toFixed(1)} kg` : '—'}</p>
          </div>
        </div>
        <p className="text-[12px] text-muted">{isLoading ? 'Loading…' : `${prs.length} records`}</p>
      </Card>

      <section className="overflow-hidden rounded-xl border border-surface-light/60 bg-surface/50">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <h3 className="text-[14px] font-semibold">PR history</h3>
            <p className="text-[12px] text-muted">{sorted.length} records · e1RM via Brzycki</p>
          </div>
          <Trophy className="h-4 w-4 text-muted" aria-hidden />
        </div>
        <div className="grid grid-cols-[70px_1fr_92px_64px_18px] gap-2 border-y border-surface-light/50 bg-surface/30 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
          <span>Date</span>
          <span>Exercise</span>
          <span className="text-right">Weight × reps</span>
          <span className="text-right">e1RM</span>
          <span />
        </div>
        {rows.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => p.session_id && onOpenSession(p.session_id)}
            className={`grid min-h-[44px] w-full grid-cols-[70px_1fr_92px_64px_18px] items-center gap-2 border-b border-surface-light/35 px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-light/20 ${
              p.id === selectedPRId ? 'bg-accent/[0.06]' : ''
            }`}
          >
            <span className="text-[12px] text-muted">{shortDate(p.achieved_date)}</span>
            <span className="truncate text-[12px] font-medium">{p.exercise_name}</span>
            <span className="text-right font-mono text-[12px]">{amount(p.weight_kg)} × {p.reps}</span>
            <span className="text-right font-mono text-[12px] text-muted">{amount(p.estimated_1rm ?? p.weight_kg)}</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted/60" aria-hidden />
          </button>
        ))}
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-[12px] text-muted">{sorted.length - 10 > 0 ? `${sorted.length - 10} more` : ''}</span>
          {sorted.length > 10 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="inline-flex h-11 items-center gap-1 text-[12px] font-medium text-accent hover:text-accent-hover">
              {showAll ? 'Show latest 10' : `Show all ${sorted.length}`}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </section>

      <DeficiencyCard data={deficiency} isLoading={deficiencyLoading} category="lifting" />
    </div>
  );
}
