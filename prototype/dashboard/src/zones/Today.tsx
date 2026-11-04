import React from 'react';
import { ArrowRight, Bike, Dumbbell, HeartPulse, Moon, TriangleAlert } from 'lucide-react';
import {
  activityMarks,
  clean,
  contextFor,
  dayWindow,
  daysBetween,
  fmtDate,
  fmtSigned,
  recentRows,
  readEngines,
  readStance,
  weekTotals,
  type DashboardFixture,
  type RecentRow,
} from '@/lab/fixture';
import { Card, Chip, Dot, SectionLabel, Stat } from '@/lab/ui';
import { DomainStrip, FormChart, Sparkline } from '@/lab/charts';

/** Shared by both candidates — the long-form date, used once, never twice. */
export function PageHead({
  now,
  f,
}: {
  now: string;
  f: DashboardFixture;
}) {
  const d = new Date(`${now}T12:00:00Z`);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight">Good afternoon</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          {d.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {f.staleProvider ? (
          <Chip tone="danger">
            <TriangleAlert size={11} /> {f.staleProvider} needs re-auth
          </Chip>
        ) : (
          <Chip tone="neutral">Synced {f.syncedMinutesAgo} min ago</Chip>
        )}
        <Chip tone="neutral">9°C · cloudy</Chip>
      </div>
    </div>
  );
}

function KindGlyph({ kind }: { kind: RecentRow['kind'] }) {
  return kind === 'lift' ? (
    <Dumbbell size={13} className="text-accent" />
  ) : (
    <Bike size={13} className="text-info" />
  );
}

function RecentList({ rows, now }: { rows: RecentRow[]; now: string }) {
  return (
    <ul className="divide-y divide-surface-light/40">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-2.5">
          <KindGlyph kind={r.kind} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-foreground">{clean(r.title)}</div>
            <div className="text-[11px] text-muted">
              {daysBetween(r.date, now) === 0 ? 'today' : fmtDate(r.date)} · {r.secondary}
            </div>
          </div>
          <span className="text-[13px] tabular-nums text-foreground">{r.primary}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── Candidate A — "The Answer" ───────────────────────────────────────────────
   The page opens with the decision. Evidence is beside it, not behind a click.
   Charts do not appear above the act zone at all. */

export function TodayA({ f, now }: { f: DashboardFixture; now: string }) {
  const ctx = contextFor(f, now);
  const reading = readStance(f, ctx);
  const engines = readEngines(f);
  const cells = dayWindow(f, now, 14);
  const week = weekTotals(f, now);
  const rows = recentRows(f, now, 3);
  const last = rows[0];
  const topWeakness = f.deficiency.weaknesses.find((w) => w.severity === 'high');

  const stanceTone =
    reading.stance === 'rest' ? 'text-warning' : reading.stance === 'easy' ? 'text-caution' : 'text-accent';

  return (
    <div className="space-y-4">
      {/* Hero: the answer, then its evidence. */}
      <Card className="p-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-baseline gap-3">
              <span className={`text-[46px] font-semibold leading-none tracking-tight ${stanceTone}`}>
                {reading.stance.toUpperCase()}
              </span>
              <span className="text-[12px] text-muted">today</span>
            </div>
            <p className="mt-2.5 max-w-[46ch] text-[14px] leading-relaxed text-foreground/90">
              {reading.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {reading.basis.map((b) => (
                <Chip key={b} tone="neutral">
                  {b}
                </Chip>
              ))}
            </div>
          </div>

          <div className="lg:border-l lg:border-surface-light/50 lg:pl-6">
            <SectionLabel right={<span className="text-[11px] text-muted">6 engines</span>}>
              Why
            </SectionLabel>
            <ul className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-2">
              {engines.map((e) => (
                <li key={e.key} className="flex items-start gap-1.5 text-[12px] leading-snug">
                  <span className="mt-[6px]">
                    <Dot
                      tone={
                        e.state === 'contributing' ? 'accent' : e.state === 'broken' ? 'danger' : 'muted'
                      }
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-foreground/90">{e.label}</span>
                    <span
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
          </div>
        </div>
      </Card>

      {/* The day: no plan, so say the true thing instead. */}
      <Card className="p-5">
        <SectionLabel right={<Chip tone="neutral">no plan running</Chip>}>Today</SectionLabel>
        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-[13px] leading-relaxed text-foreground/90">
              Nothing is scheduled, so today is yours to choose. The record points one way:
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-foreground">
              {topWeakness
                ? clean(topWeakness.recommendation ?? topWeakness.detail)
                : 'No weakness flagged this week.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-background hover:bg-accent-hover">
                Log a session <ArrowRight size={13} />
              </button>
              <button className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-surface-light px-3 text-[12px] text-muted hover:text-foreground">
                Plan this week
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 self-start">
            <Fact
              icon={<Dumbbell size={12} />}
              label="Last session"
              value={last ? (daysBetween(last.date, now) === 0 ? 'today' : `${daysBetween(last.date, now)} d ago`) : '—'}
              sub={last ? `${clean(last.title)} · ${last.primary}` : undefined}
            />
            <Fact
              icon={<Bike size={12} />}
              label="7-day load"
              value={`${Math.round(week.tss)} TSS`}
              sub={`${week.sessions} training ${week.sessions === 1 ? 'day' : 'days'}`}
            />
            <Fact
              icon={<HeartPulse size={12} />}
              label="Recovery"
              value={ctx.isToday ? `${Math.round(f.readiness.recovery_score ?? 0)}%` : 'not scored'}
              sub={
                ctx.hrv !== null
                  ? `HRV ${Math.round(ctx.hrv)} ms · RHR ${f.readiness.resting_hr} bpm`
                  : 'no HRV for this day'
              }
            />
            <Fact
              icon={<Moon size={12} />}
              label="Sleep"
              value={`${f.sleepDebt.avg_sleep_hours.toFixed(1)} h`}
              sub={`${f.sleepDebt.debt_hours.toFixed(1)} h short over 7 days`}
            />
          </dl>
        </div>
      </Card>

      {/* The join — the thing no other page can show. */}
      <Card className="p-5">
        <SectionLabel
          right={
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-accent" /> cycling load
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-[2px] w-3 rounded-full bg-info" /> HRV
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-1 rounded-[1px] bg-[rgb(167_139_250)]" /> lift
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-1 rounded-[1px] bg-info" /> ride
              </span>
            </div>
          }
        >
          Last 14 days
        </SectionLabel>
        <div className="mt-3">
          <DomainStrip cells={cells} showLabels height={46} marks={activityMarks(f, now, 14)} />
        </div>
        <p className="mt-3 text-[12px] text-muted">
          {cells.filter((c) => c.tss > 0).length} cycling{' '}
          {cells.filter((c) => c.tss > 0).length === 1 ? 'day' : 'days'},{' '}
          {Math.round(cells.reduce((s, c) => s + c.tss, 0))} TSS.{' '}
          {Object.values(activityMarks(f, now, 14)).filter((m) => m === 'lift').length} lift{' '}
          {Object.values(activityMarks(f, now, 14)).filter((m) => m === 'lift').length === 1
            ? 'session'
            : 'sessions'}{' '}
          in the window — strength carries no TSS in the record, so it is ticked, not stacked.{' '}
          {hrvNote(cells)}
        </p>
      </Card>

      <Card className="p-5">
        <SectionLabel right={<span className="text-[11px] text-muted">last 3</span>}>Recent</SectionLabel>
        <div className="mt-1">
          <RecentList rows={rows} now={now} />
        </div>
      </Card>
    </div>
  );
}

function hrvNote(cells: { hrv: number | null; date: string }[]): string {
  const withHrv = cells.filter((c) => typeof c.hrv === 'number');
  if (withHrv.length < 4) return 'HRV too sparse in this window to compare.';
  const first = withHrv.slice(0, Math.floor(withHrv.length / 2));
  const lastHalf = withHrv.slice(Math.floor(withHrv.length / 2));
  const avg = (xs: typeof withHrv) => xs.reduce((s, c) => s + (c.hrv ?? 0), 0) / xs.length;
  const delta = avg(lastHalf) - avg(first);
  return `HRV is ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(0)} ms across the window.`;
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
      <dt className="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-[15px] font-medium tabular-nums text-foreground">{value}</dd>
      {sub && <dd className="text-[11px] text-muted">{sub}</dd>}
    </div>
  );
}

/* ── Candidate B — "The Console" ──────────────────────────────────────────────
   The page opens with the instrument panel: every domain on one shared x-axis,
   full width, with visible axes. The verdict is a strip inside the instrument
   card rather than a hero above it. Charts are the navigation. */

export function TodayB({ f, now }: { f: DashboardFixture; now: string }) {
  const ctx = contextFor(f, now);
  const reading = readStance(f, ctx);
  const engines = readEngines(f);
  const cells = dayWindow(f, now, 14);
  const week = weekTotals(f, now);
  const rows = recentRows(f, now, 5);
  const loadTail = f.load.slice(-30);
  const alive = engines.filter((e) => e.state === 'contributing').length;
  const broken = engines.filter((e) => e.state === 'broken');

  const stanceTone =
    reading.stance === 'rest' ? 'text-warning' : reading.stance === 'easy' ? 'text-caution' : 'text-accent';

  return (
    <div className="space-y-4">
      {/* The instrument band. */}
      <Card className="p-5">
        <SectionLabel
          right={
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span>14 days</span>
              <span className="text-muted/50">·</span>
              <span>shared x</span>
            </div>
          }
        >
          Training record
        </SectionLabel>

        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Fitness · CTL"
            value={(ctx.ctl ?? 0).toFixed(1)}
            sub={<Sparkline values={loadTail.map((p) => p.ctl)} />}
          />
          <Stat
            label="Fatigue · ATL"
            value={(ctx.atl ?? 0).toFixed(1)}
            sub={<Sparkline values={loadTail.map((p) => p.atl)} color="rgb(239 68 68)" />}
          />
          <Stat
            label="Form · TSB"
            value={fmtSigned(ctx.tsb ?? 0)}
            tone={(ctx.tsb ?? 0) < -10 ? 'caution' : 'accent'}
            sub={<Sparkline values={loadTail.map((p) => p.tsb)} color="rgb(56 189 248)" />}
          />
          <Stat
            label="Week TSS"
            value={Math.round(week.tss).toString()}
            sub={`${week.sessions} training ${week.sessions === 1 ? 'day' : 'days'}`}
          />
        </div>

        <div className="mt-5 rounded-lg border border-surface-light/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Load & recovery</span>
            <span className="hidden text-[11px] text-muted sm:inline">
              bars = cycling TSS · line = HRV · ticks = session
            </span>
          </div>
          <div className="mt-2">
            <DomainStrip cells={cells} showLabels height={64} marks={activityMarks(f, now, 14)} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted">
            <span>max {Math.round(Math.max(...cells.map((c) => c.tss)))} TSS</span>
            <span>{cells[0].date.slice(5)} → {cells[cells.length - 1].date.slice(5)}</span>
          </div>
        </div>

        {/* The verdict, as a row inside the instruments. */}
        <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          <span className={`text-[15px] font-semibold tracking-tight ${stanceTone}`}>
            {reading.stance.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 text-[12px] text-foreground/85">{reading.reason}</span>
          <span className="text-[11px] text-muted">
            {alive} of {engines.length} engines
          </span>
        </div>
        {broken.length > 0 && (
          <p className="mt-2 text-[11px] text-warning/90">
            {broken.length} engine {broken.length === 1 ? 'is' : 'are'} failing:{' '}
            {broken.map((b) => b.label).join(', ')} — reported here rather than hidden.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <SectionLabel right={<span className="text-[11px] text-muted">90 days</span>}>
            Form over time
          </SectionLabel>
          <div className="mt-2">
            <FormChart points={f.load} days={90} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-[2px] w-4 bg-accent" /> fitness
            </span>
            <span className="flex items-center gap-1">
              <span className="h-[2px] w-4 bg-warning" /> fatigue
            </span>
            <span className="flex items-center gap-1">
              <span className="h-[2px] w-4 bg-info" /> form
            </span>
          </div>
        </Card>

        <Card className="p-5">
          <SectionLabel>Recent</SectionLabel>
          <RecentList rows={rows} now={now} />
        </Card>
      </div>

      <Card className="p-5">
        <SectionLabel>Recovery & sleep</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Recovery"
            value={ctx.isToday ? `${Math.round(f.readiness.recovery_score ?? 0)}%` : 'not scored'}
            tone={ctx.isToday ? 'accent' : 'muted'}
            sub={ctx.isToday ? 'today' : `no score for ${ctx.date.slice(5)}`}
          />
          <Stat label="HRV" value={ctx.hrv !== null ? Math.round(ctx.hrv).toString() : '—'} unit="ms" sub={`RHR ${f.readiness.resting_hr} bpm`} />
          <Stat label="Sleep" value={f.sleepDebt.avg_sleep_hours.toFixed(1)} unit="h" sub={`${f.sleepDebt.debt_hours.toFixed(1)} h short`} />
          <Stat label="Strain" value={(f.today.latest_strain ?? 0).toFixed(1)} sub="WHOOP 0–21" />
        </div>
      </Card>
    </div>
  );
}
