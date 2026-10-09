'use client';

/**
 * Phase 1 (plans/ui-redesign-v2.md §1 + §4 moment 1) — `VerdictCard`.
 *
 * One card, one sentence, always plan-relative (adjust-or-affirm). Rendered
 * with identical props in every slot (dashboard banner position + TODAY —
 * guardrail §1.3); the dashboard/TODAY contradiction dies by construction.
 *
 * Verdict philosophy (binding): the card affirms or adjusts the current
 * training plan's session — it NEVER invents standalone workouts. With no
 * plan or on a rest day it says so without prescribing. The `Why` expands
 * Wave-4 engine rows INCLUDING silent ones (pitfall 42).
 */

import React from 'react';
import Link from 'next/link';
import type { TodayVerdict } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { formatTSB } from '@/lib/utils';

export interface VerdictPlanContext {
  planName: string;
  /** Human label for today's planned session, or null on rest days. */
  dayLabel: string | null;
}

export interface VerdictCardProps {
  /** Wave-4 unified verdict (five engines + silence reporting). */
  verdict?: TodayVerdict | null;
  /** Active plan + today's slice, for plan-relative fallback copy. */
  planContext?: VerdictPlanContext | null;
  /** Server-computed TSB for the rest-day fallback line. Display only. */
  tsb?: number | null;
  /** Hours of sleep debt owed (>=0). >=2h downgrades to caution. */
  sleepDebtHours?: number | null;
  isLoading?: boolean;
  /** Optional action row (e.g. Swap/Keep, Train) — owned by the call site. */
  actionSlot?: React.ReactNode;
}

/** Engine key → legible label, so a vote reads without a lookup. */
const ENGINE_LABELS: Record<string, string> = {
  rest_day_suggestion: 'Load & recovery',
  tsb: 'Form (TSB)',
  adaptive: 'Adaptive plan',
  deficiency: 'Weakness scan',
  cross_domain: 'Sleep & cross-sport',
  projection: 'Week ahead',
};

const STANCE_LABELS: Record<string, string> = {
  train: 'train',
  cut: 'cut back',
  rest: 'rest',
  add: 'add load',
};

const STANCE_STYLES: Record<string, string> = {
  train: 'text-positive',
  cut: 'text-amber-400',
  rest: 'text-warning',
  add: 'text-blue-400',
};

function VerdictWhy({ verdict }: { verdict: TodayVerdict }) {
  if (verdict.consensus.length === 0) return null;
  const available = verdict.consensus.filter((c) => c.available).length;
  return (
    <details className="mt-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-xs text-muted transition-colors hover:text-foreground">
        Why — {available} of {verdict.consensus.length} signals
      </summary>
      <ul className="mt-1.5 space-y-1">
        {verdict.consensus.map((row) => (
          <li key={row.engine} className="flex items-start justify-between gap-3 text-xs">
            <span className="text-muted">{ENGINE_LABELS[row.engine] ?? row.engine}</span>
            {row.available && row.stance ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={`font-medium ${STANCE_STYLES[row.stance] ?? 'text-muted'}`}>
                  {STANCE_LABELS[row.stance] ?? row.stance}
                </span>
                {row.confidence && row.confidence !== 'low' && (
                  <span className="text-muted">{row.confidence}</span>
                )}
              </span>
            ) : (
              <span className="shrink-0 italic text-muted">{row.reason ?? 'no signal'}</span>
            )}
          </li>
        ))}
      </ul>
      {verdict.consensus.some((c) => c.available && c.note) && (
        <ul className="mt-1.5 space-y-0.5">
          {verdict.consensus
            .filter((c) => c.available && c.note)
            .map((c) => (
              <li key={`${c.engine}-note`} className="text-xs text-muted">
                {ENGINE_LABELS[c.engine] ?? c.engine}: {c.note}
              </li>
            ))}
        </ul>
      )}
    </details>
  );
}

function ProjectedWeek({ verdict }: { verdict: TodayVerdict }) {
  if (verdict.projected_load.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs uppercase tracking-wider text-muted">Week ahead</p>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {verdict.projected_load.map((p) => (
          <li
            key={p.date}
            className="shrink-0 rounded border border-surface-light/50 px-2 py-1 text-center"
          >
            <span className="block text-xs text-muted">
              {new Date(p.date).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
              })}
            </span>
            <span
              className={`block font-mono text-xs font-bold tabular-nums ${
                (p.tsb ?? 0) < -20
                  ? 'text-warning'
                  : (p.tsb ?? 0) > 10
                    ? 'text-positive'
                    : 'text-foreground'
              }`}
            >
              <AnimatedNumber
                value={p.tsb ?? 0}
                format={(v) => (p.tsb == null ? '—' : String(Math.round(v)))}
                ariaLabel={p.tsb == null ? 'no projection' : `projected TSB ${Math.round(p.tsb)}`}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VerdictCard({
  verdict,
  planContext,
  tsb,
  sleepDebtHours,
  isLoading,
  actionSlot,
}: VerdictCardProps) {
  if (isLoading) {
    return (
      <Card>
        <div role="status" aria-label="Loading today's verdict">
          <SkeletonMetric />
        </div>
      </Card>
    );
  }

  // ── Server verdict: plan-aware headline + reasons + full consensus ──────
  if (verdict) {
    const isWarning = verdict.should_rest;
    const hasSleepDebt = (sleepDebtHours ?? 0) >= 2;
    const isCaution = !isWarning && hasSleepDebt;
    return (
      <Card
        className={
          isWarning || isCaution ? 'border-amber-500/30 bg-amber-900/30' : undefined
        }
      >
        <p
          key={verdict.headline}
          className={`ft-value-swap text-lg font-bold ${
            isWarning || isCaution ? 'text-amber-200' : 'text-green-300'
          }`}
        >
          {verdict.headline}
        </p>
        {verdict.reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {verdict.reasons.map((reason, i) => (
              <li
                key={i}
                className={`text-sm ${isWarning || isCaution ? 'text-amber-300/80' : 'text-muted'}`}
              >
                • {reason}
              </li>
            ))}
          </ul>
        )}
        <VerdictWhy verdict={verdict} />
        <ProjectedWeek verdict={verdict} />
        {actionSlot}
      </Card>
    );
  }

  // ── Fallbacks (verdict unavailable): plan-relative, never prescriptive ──
  if (!planContext) {
    return (
      <Card>
        <p className="text-lg font-bold text-foreground">
          No active plan — log anything and I&apos;ll start building your baseline.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/routes"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-accent/20 px-4 text-sm font-medium text-accent transition-colors hover:bg-accent/30"
          >
            Browse routes
          </Link>
          <Link
            href="/lifting/live"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-surface-light px-4 text-sm font-medium text-foreground transition-colors hover:border-accent/40"
          >
            Start live lift
          </Link>
        </div>
        {actionSlot}
      </Card>
    );
  }

  if (!planContext.dayLabel) {
    return (
      <Card>
        <p className="text-lg font-bold text-foreground">
          Rest day{planContext.planName ? ` in ${planContext.planName}` : ''}
          {tsb != null && Number.isFinite(tsb) ? (
            <>
              {' — TSB '}
              <AnimatedNumber
                value={tsb}
                format={(v) => formatTSB(v)}
                className="tabular-nums"
              />
            </>
          ) : (
            ''
          )}
          . Freshness is the work today.
        </p>
        {actionSlot}
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-lg font-bold text-foreground">
        Today&apos;s plan: {planContext.dayLabel}
        {planContext.planName ? ` (${planContext.planName})` : ''}. Verdict
        unavailable — train by feel.
      </p>
      {actionSlot}
    </Card>
  );
}
