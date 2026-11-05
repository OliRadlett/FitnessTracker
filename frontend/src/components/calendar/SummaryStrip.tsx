'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Info } from 'lucide-react';
import type { CalendarResponse } from '@/lib/api';
import type { MonthSummary } from '@/lib/calendar';
import { fmtLoad, fmtPercent, fmtSigned } from '@/lib/calendarFormat';
import { cx, toneText } from './calendarUi';

function MetricCard({
  label,
  value,
  unit,
  children,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  children?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-surface-light/50 bg-surface px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <p className={cx('mt-1 flex items-baseline gap-1.5 text-2xl font-semibold leading-none', tone ? toneText(tone) : 'text-foreground')}>
        {value}
        {unit && <span className="text-xs font-medium text-muted">{unit}</span>}
      </p>
      <div className="mt-2 min-h-[16px] text-[11px] leading-4 text-muted">{children}</div>
    </div>
  );
}

export function SummaryStrip({
  fixture,
  month,
  summary,
  compact = false,
}: {
  fixture: CalendarResponse;
  month: Date;
  summary: MonthSummary;
  compact?: boolean;
}) {
  const compliance = summary.compliance;
  const coverage = summary.targetCoverage;
  const monthName = month.toLocaleDateString('en-GB', { month: 'long' });
  const current = fixture.current ?? {
    ctl: null,
    atl: null,
    tsb: null,
    recovery: null,
    strain: null,
    sleep_hours: null,
  };

  if (compact) {
    return (
      <div className="space-y-1">
        <div className="rounded-xl border border-surface-light/50 bg-surface px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                {monthName} · {fixture.plan?.name ?? 'No active plan'}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-semibold leading-none text-foreground">
                  {summary.plannedSessions}
                  <span className="ml-1 text-[10px] font-medium text-muted">planned</span>
                </span>
                <span
                  className={cx(
                    'text-sm font-semibold',
                    compliance == null
                      ? 'text-muted'
                      : compliance >= 0.8
                        ? 'text-positive'
                        : compliance >= 0.5
                          ? 'text-caution'
                          : 'text-warning',
                  )}
                >
                  {summary.completedSessions} done
                </span>
                <span className="text-sm font-semibold text-foreground/80">
                  {fmtLoad(summary.actualTss)}
                  <span className="ml-1 text-[10px] font-medium text-muted">TSS</span>
                </span>
                {summary.unplannedActuals > 0 && (
                  <span className="text-[11px] font-medium text-info">
                    {summary.unplannedActuals} unplanned
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
                <span className={coverage != null && coverage < 0.5 ? 'text-caution' : undefined}>
                  {summary.targetSessions} of {summary.plannedSessions} with targets
                </span>
                <span>TSB {current.tsb == null ? '—' : fmtSigned(current.tsb)}</span>
                {current.recovery != null && <span>{Math.round(current.recovery)}% recovery</span>}
              </div>
            </div>
            <Link
              href={fixture.plan ? `/training?plan=${fixture.plan.id}` : '/training'}
              className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-[10px] font-semibold text-accent/90 hover:text-accent"
            >
              Open plan
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
        </div>
        <p className="px-1 text-[9px] leading-3 text-muted">
          Planned load is cycling-only; strength days carry no TSS target. Missed and unconfirmed
          days appear in the agenda.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <MetricCard
          label={`${monthName} plan`}
          value={String(summary.plannedSessions)}
          unit="sessions"
        >
          {summary.hasPlan ? (
            <span>
              {summary.restDays} rest days ·{' '}
              <span className={coverage != null && coverage < 0.5 ? 'text-caution' : undefined}>
                {summary.targetSessions} with TSS targets
              </span>
            </span>
          ) : (
            <span className="text-caution">No plan covers this month</span>
          )}
        </MetricCard>

        <MetricCard
          label="Completed"
          value={compliance == null ? '—' : fmtPercent(compliance * 100)}
          tone={
            compliance == null
              ? undefined
              : compliance >= 0.8
                ? 'good'
                : compliance >= 0.5
                  ? 'caution'
                  : 'bad'
          }
        >
          {summary.completedSessions} of {summary.plannedSessions} marked done ·{' '}
          <span className={summary.missed > 0 ? 'text-warning' : undefined}>
            {summary.missed} missed
          </span>
          {summary.mismatch > 0 && (
            <>
              {' · '}
              <span className="text-caution">{summary.mismatch} unconfirmed</span>
            </>
          )}
          {summary.doneUnlogged > 0 && (
            <>
              {' · '}
              <span className="text-caution">{summary.doneUnlogged} without evidence</span>
            </>
          )}
        </MetricCard>

        <MetricCard label="Actual load" value={fmtLoad(summary.actualTss)} unit="TSS">
          {summary.activityCount} activities · {summary.liftCount} lifts
          {summary.unplannedActuals > 0 && (
            <>
              {' · '}
              <span className="text-info">{summary.unplannedActuals} unplanned</span>
            </>
          )}
        </MetricCard>

        <MetricCard
          label="Form today"
          value={current.tsb == null ? '—' : fmtSigned(current.tsb)}
          unit="TSB"
        >
          CTL {current.ctl ?? '—'} · ATL {current.atl ?? '—'}
          {current.recovery != null && (
            <>
              {' · '}
              <span className="inline-flex items-center gap-1">
                <span
                  className={cx(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    current.recovery >= 67
                      ? 'bg-positive'
                      : current.recovery >= 34
                        ? 'bg-caution'
                        : 'bg-warning',
                  )}
                />
                {Math.round(current.recovery)}% recovery
              </span>
            </>
          )}
        </MetricCard>
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-surface-light/50 bg-surface-light/20 px-3 py-2 text-[11px] leading-4 text-muted sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-start gap-1.5">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted" aria-hidden />
          <span>
            Planned load covers {summary.targetSessions} of {summary.plannedSessions} sessions
            {coverage != null && coverage < 1
              ? ` (${Math.round(coverage * 100)}%) — strength days carry no planned TSS, so the two bars are not like-for-like.`
              : '.'}
          </span>
        </span>
        <Link
          href={fixture.plan ? `/training?plan=${fixture.plan.id}` : '/training'}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent/90 hover:text-accent"
        >
          Open plan
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
