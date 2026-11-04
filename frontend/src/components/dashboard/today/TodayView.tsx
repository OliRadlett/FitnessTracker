'use client';

/**
 * Today — the act zone.
 *
 * The decision first, its evidence beside it, then the day, then the join. No chart
 * above the fold: charts live in Trends, per docs/review-vs-act.md.
 */

import { ArrowRight, Bike, Dumbbell, HeartPulse, Moon } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { DashboardRefresh } from '@/components/dashboard/DashboardRefresh';
import { WeatherWidget } from '@/components/dashboard/WeatherWidget';
import { deriveLastSyncedAt } from '@/lib/athlete/selectors';
import { readDayContext, readStance, readEngines, engineTally, type Stance } from '@/lib/dashboard/stance';
import type { DashboardPageData } from '@/lib/dashboard/useDashboardPage';
import { getGreeting } from '@/lib/utils';
import { DomainStrip } from './DomainStrip';

const STANCE_CLASS: Record<Stance, string> = {
  train: 'text-accent',
  easy: 'text-caution',
  rest: 'text-warning',
};

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function compactDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function TodayView({ page }: { page: DashboardPageData }) {
  const today = page.today.data;
  const readiness = page.readiness.data;
  const connections = page.connections.data ?? [];

  const context = readDayContext({
    date: page.todayIso,
    load: page.dayLoads,
    hrvPoints: page.dayLoads.map((d) => ({ date: d.date, hrv: d.hrv })),
    readiness:
      readiness?.date
        ? { date: readiness.date, recovery_score: readiness.recovery_score, hrv_ms: readiness.hrv_ms }
        : undefined,
  });

  const reading = readStance({ verdict: today?.verdict, context });
  const engines = readEngines(today?.verdict);
  const tally = engineTally(engines);
  const planActive = engines.some((e) => e.key === 'projection' && e.state === 'contributing');

  const lastSynced = deriveLastSyncedAt(connections);

  const recent = [
    ...(page.activities.data ?? []).map((a) => ({
      id: a.id,
      kind: a.sport_type === 'strength' ? ('lift' as const) : ('ride' as const),
      title: a.name,
      date: a.start_date.slice(0, 10),
      primary:
        a.sport_type === 'strength'
          ? compactDuration(a.duration_seconds ?? 0)
          : `${((a.distance_meters ?? 0) / 1000).toFixed(1)} km`,
      secondary:
        a.sport_type === 'strength' ? 'strength' : compactDuration(a.duration_seconds ?? 0),
    })),
    ...(page.sessions.data ?? []).map((s) => ({
      id: s.id,
      kind: 'lift' as const,
      title: s.focus ?? 'Lifting',
      date: s.session_date,
      primary: s.total_volume_kg ? `${Math.round(s.total_volume_kg).toLocaleString()} kg` : '—',
      secondary: s.duration_seconds ? compactDuration(s.duration_seconds) : 'lifting',
    })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 3);

  const week = page.dayLoads.slice(-7);
  const weekTss = Math.round(week.reduce((s, d) => s + d.tss, 0));
  const weekDays = week.filter((d) => d.tss > 0).length;

  const topWeakness = page.deficiency.data?.weaknesses?.find((w) => w.severity === 'high');

  return (
    <div className="space-y-4">
      <PageHeader
        title={getGreeting()}
        subtitle={new Date().toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        actions={
          <>
            <DashboardRefresh />
            <WeatherWidget />
          </>
        }
        status={
          // Freshness only. The app shell's AuthStaleBanner already owns "why is it
          // stale and what do I do" — repeating it here put two red re-auth alerts on
          // one screen (fetch.ts: the banner is the single source of truth).
          <span className="text-[11px] text-muted">
            {lastSynced
              ? `synced ${new Date(lastSynced).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'sync unknown'}
          </span>
        }
      />

      {/* Hero — the answer, then its evidence. */}
      <Card className="p-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-baseline gap-3">
              <span
                className={`text-[42px] font-semibold leading-none tracking-tight ${STANCE_CLASS[reading.stance]}`}
              >
                {reading.stance.toUpperCase()}
              </span>
              <span className="text-[12px] text-muted">today</span>
            </div>
            <p className="mt-2.5 max-w-[48ch] text-[14px] leading-relaxed text-foreground/90">
              {reading.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {reading.basis.map((b) => (
                <span
                  key={b}
                  className="inline-flex rounded-md border border-surface-light px-1.5 py-0.5 text-[11px] text-muted"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>

          <div className="lg:border-l lg:border-surface-light/50 lg:pl-6">
            <SectionLabel count={tally.total} action={<span className="text-[11px] text-muted">engines</span>}>
              Why
            </SectionLabel>
            {engines.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted">
                No verdict was composed for today, so this page is not making a recommendation.
              </p>
            ) : (
              <ul aria-label="Verdict engines" className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                {engines.map((e) => (
                  <li key={e.key} className="flex items-start gap-1.5 text-[12px] leading-snug">
                    <span
                      aria-hidden
                      className={`mt-[6px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        e.state === 'contributing'
                          ? 'bg-accent'
                          : e.state === 'broken'
                            ? 'bg-warning'
                            : 'bg-muted/40'
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] text-foreground/90">{e.label}</span>
                      <span
                        title={e.raw}
                        className={`line-clamp-2 block text-[11px] ${
                          e.state === 'broken' ? 'text-warning/90' : 'text-muted'
                        }`}
                      >
                        {e.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* The day. */}
      <Card className="p-5">
        <SectionLabel
          action={
            <span className="rounded-md border border-surface-light px-1.5 py-0.5 text-[11px] text-muted">
              {planActive ? 'plan active' : 'no plan running'}
            </span>
          }
        >
          Today
        </SectionLabel>

        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            {planActive ? (
              <p className="text-[13px] leading-relaxed text-foreground/90">
                A training plan is running. Today&apos;s session lives on{' '}
                <Link href="/training" className="text-accent hover:underline">
                  Training
                </Link>
                , where you can start it or move it.
              </p>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-foreground/90">
                  Nothing is scheduled, so today is yours to choose. The record points one way:
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-foreground">
                  {topWeakness?.recommendation ?? topWeakness?.detail ?? 'No weakness flagged this week.'}
                </p>
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/lifting"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-background hover:bg-accent-hover"
              >
                Log a session <ArrowRight size={13} />
              </Link>
              <Link
                href="/training"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-surface-light px-3 text-[12px] text-muted hover:text-foreground"
              >
                Plan this week
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 self-start">
            <Fact
              icon={<Dumbbell size={12} />}
              label="Last session"
              value={
                recent[0]
                  ? daysBetween(recent[0].date, page.todayIso) === 0
                    ? 'today'
                    : `${daysBetween(recent[0].date, page.todayIso)} d ago`
                  : '—'
              }
              sub={recent[0] ? `${recent[0].title} · ${recent[0].primary}` : undefined}
            />
            <Fact
              icon={<Bike size={12} />}
              label="7-day load"
              value={`${weekTss} TSS`}
              sub={`${weekDays} training ${weekDays === 1 ? 'day' : 'days'}`}
            />
            <Fact
              icon={<HeartPulse size={12} />}
              label="Recovery"
              value={context.isScored ? `${Math.round(readiness?.recovery_score ?? 0)}%` : 'not scored'}
              sub={
                context.hrvMs !== null
                  ? `HRV ${Math.round(context.hrvMs)} ms`
                  : 'no HRV for today'
              }
            />
            <Fact
              icon={<Moon size={12} />}
              label="Sleep"
              value={
                page.sleepDebt.data ? `${page.sleepDebt.data.avg_sleep_hours.toFixed(1)} h` : '—'
              }
              sub={
                page.sleepDebt.data
                  ? `${page.sleepDebt.data.debt_hours.toFixed(1)} h short over 7 days`
                  : 'sleep not tracked'
              }
            />
          </div>
        </div>
      </Card>

      {/* The join. */}
      <Card className="p-5">
        <SectionLabel
          action={
            <span className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <span aria-hidden className="inline-block h-2 w-2 rounded-sm bg-accent" /> cycling load
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="inline-block h-[2px] w-3 rounded-full bg-info" /> HRV
              </span>
            </span>
          }
        >
          Last 14 days
        </SectionLabel>
        <div className="mt-3">
          <DomainStrip days={page.dayLoads.slice(-14)} />
        </div>
        <p className="mt-3 text-[12px] text-muted">
          {page.dayLoads.slice(-14).filter((d) => d.tss > 0).length} cycling days,{' '}
          {Math.round(page.dayLoads.slice(-14).reduce((s, d) => s + d.tss, 0))} TSS in the window.
          Strength carries no TSS in this record yet, so it is not stacked here.
        </p>
      </Card>

      {/* Recent. */}
      <Card className="p-5">
        <SectionLabel action={<span className="text-[11px] text-muted">last 3</span>}>Recent</SectionLabel>
        {recent.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">
            Nothing recorded yet. A ride or a lifting session will show up here.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-surface-light/40">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                {r.kind === 'lift' ? (
                  <Dumbbell size={13} className="shrink-0 text-accent" />
                ) : (
                  <Bike size={13} className="shrink-0 text-info" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{r.title}</div>
                  <div className="text-[11px] text-muted">
                    {daysBetween(r.date, page.todayIso) === 0 ? 'today' : fmtDate(r.date)} · {r.secondary}
                  </div>
                </div>
                <span className="text-[13px] tabular-nums">{r.primary}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-[15px] font-medium tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
