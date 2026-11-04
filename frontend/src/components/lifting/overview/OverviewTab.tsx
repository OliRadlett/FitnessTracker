'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, Flame, TrendingUp } from 'lucide-react';
import type { ChartData, LiftingSession, PersonalRecord } from '@/lib/api';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { usePlanWeekOverview } from '@/lib/training/usePlanWeekOverview';
import { toDateStr } from '@/lib/training/week';
import { VolumeTrendChart } from './VolumeTrendChart';
import {
  addDays,
  amount,
  focusOf,
  mondayOf,
  prsInRange,
  recentPrCount,
  sessionsInRange,
  shortWeight,
  sumSets,
  sumTss,
  sumVolume,
  topSet,
  weekBounds,
} from '@/lib/lifting/overview';

const dayShort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const dayLong = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const initials = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1);

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-surface-light/60 bg-surface/50 ${className}`}>{children}</div>;
}

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[12px] font-semibold uppercase tracking-[0.08em] text-muted ${className}`}>{children}</p>;
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'positive' | 'caution' }) {
  const tones = {
    neutral: 'bg-surface-light/70 text-muted',
    accent: 'bg-accent/12 text-accent',
    positive: 'bg-positive/12 text-positive',
    caution: 'bg-caution/12 text-caution',
  } as const;
  return <span className={`inline-flex h-[22px] items-center rounded-md px-1.5 text-[12px] font-medium leading-none ${tones[tone]}`}>{children}</span>;
}

function TodayCard({
  sessions,
  plan,
  today,
  onOpenSession,
  onLogSession,
}: {
  sessions: LiftingSession[];
  plan: ReturnType<typeof usePlanWeekOverview>['data'];
  today: string;
  onOpenSession: (id: string) => void;
  onLogSession: () => void;
}) {
  const planDay = plan?.week.days.find((d) => d.day_date === today) ?? null;
  const logged = sessions.find((s) => s.session_date === today) ?? null;
  const latest = sessions[0] ?? null;
  const isStrength = planDay?.sport === 'strength';
  const focus = isStrength ? initials((planDay?.planned_focus ?? 'strength').trim()) : null;
  const steps = planDay?.warmup_template?.steps ?? [];
  const nextStrength = plan?.week.days.find((d) => d.sport === 'strength' && d.day_date > today) ?? null;
  const working = logged?.sets?.filter((s) => !s.is_warmup).length ?? 0;
  const heroSession = logged ?? latest;
  const isToday = !!logged;
  const week = weekBounds(today);
  const thisWeek = sessionsInRange(sessions, week.start, week.end);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>Today · {dayLong(today)}</Label>
          <h2 className="mt-2 text-[24px] font-semibold leading-none tracking-[-0.03em]">
            {isStrength ? `${focus} day` : heroSession ? 'Rest day' : 'No sessions yet'}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isStrength && planDay?.planned_type ? <Badge>{initials(planDay.planned_type)}</Badge> : null}
            {plan?.week.week_number ? <Badge>Week {plan.week.week_number}</Badge> : null}
            {logged?.duration_seconds ? <Badge>{Math.round(logged.duration_seconds / 60)} min</Badge> : null}
            {logged?.whoop_strain != null ? <Badge tone="accent">Strain {logged.whoop_strain.toFixed(1)}</Badge> : null}
          </div>
          <p className="mt-2 text-[12px] text-muted sm:hidden">
            This week <span className="font-medium text-foreground">{shortWeight(sumVolume(thisWeek))}</span> · {thisWeek.length}{' '}
            {thisWeek.length === 1 ? 'session' : 'sessions'}
          </p>
          <p className="mt-2 text-[12px] text-muted">
            {logged
              ? `Logged today · ${shortWeight(logged.total_volume_kg)} · ${logged.sets.length} sets`
              : latest
                ? `Last session ${dayShort(latest.session_date)} · ${focusOf(latest)} · `
                : 'Start with a session; the page fills in from there.'}
              {latest && !logged ? <span className="whitespace-nowrap">{shortWeight(latest.total_volume_kg)}</span> : null}
          </p>
        </div>
        <Badge tone={logged ? 'positive' : 'neutral'}>{logged ? 'Completed' : isStrength ? 'Planned' : 'Rest'}</Badge>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[1.15fr_0.85fr]">
        <div>
          {isStrength ? (
            <>
              <Label>Warm-up</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {steps.slice(0, 6).map((s) => (
                  <span key={s.step_number} className="rounded-md border border-surface-light/70 bg-surface-light/30 px-2 py-1 font-mono text-[12px] text-muted">
                    {s.weight_kg}×{s.reps}
                  </span>
                ))}
                {steps.length === 0 && <span className="text-[12px] text-muted">No warm-up prescribed</span>}
              </div>
            </>
          ) : (
            <>
              <Label>Today</Label>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                No strength day planned.
                {nextStrength
                  ? ` Next: ${initials(nextStrength.planned_focus ?? 'strength')} on ${dayShort(nextStrength.day_date)}.`
                  : ' The current plan week has no strength days.'}
              </p>
            </>
          )}
          <p className="mt-3 text-[12px] text-muted">
            {heroSession ? (
              <>
                {isToday ? 'Top set' : 'Latest top set'}{' '}
                <span className="font-medium text-foreground">{topSet(heroSession)?.weight_kg ?? '—'} kg</span>
                {working ? ` · ${working} working sets` : null}
              </>
            ) : (
              'No working sets logged yet'
            )}
          </p>
        </div>
        <div className="border-t border-surface-light/50 pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <Label>{isToday ? 'Logged' : 'Last session'}</Label>
          {heroSession ? (
            <>
              <p className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.03em]">{shortWeight(heroSession.total_volume_kg)}</p>
              <p className="mt-1 text-[12px] text-muted">
                {heroSession.sets.length} sets · {amount(heroSession.estimated_tss ?? 0)} TSS
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-muted">Log the first session to establish a baseline.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {heroSession ? (
              <>
                <button
                  type="button"
                  onClick={() => onOpenSession(heroSession.id)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-background hover:bg-accent-hover"
                >
                  View session <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
                <Link
                  href={`/lifting?tab=sessions&session=${heroSession.id}`}
                  className="inline-flex h-11 items-center rounded-lg border border-surface-light px-3 text-[13px] font-medium text-foreground hover:bg-surface-light/40"
                >
                  Repeat
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={onLogSession}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-background hover:bg-accent-hover"
              >
                Log session
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function WeekCard({
  sessions,
  prs,
  week,
  prev,
  today,
  label,
  emptyCurrentWeek,
}: {
  sessions: LiftingSession[];
  prs: PersonalRecord[];
  week: string[];
  prev: LiftingSession[];
  today: string;
  label: string;
  emptyCurrentWeek: boolean;
}) {
  const volume = sumVolume(sessions);
  const prevVolume = sumVolume(prev);
  const delta = prevVolume ? ((volume - prevVolume) / prevVolume) * 100 : null;
  const prsThisWeek = prsInRange(prs, week[0], week[6]);
  const maxDay = Math.max(1, ...week.map((d) => sumVolume(sessions.filter((s) => s.session_date === d))));

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <Label>{label}</Label>
          <p className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.03em]">{shortWeight(volume)}</p>
          <p className="mt-1 text-[12px] text-muted">
            {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
            {emptyCurrentWeek
              ? ' · latest training week'
              : delta != null
                ? ` · ${delta >= 0 ? '+' : ''}${Math.round(delta)}% vs last week`
                : ' · no prior week'}
          </p>
        </div>
        <Badge tone="accent">
          <TrendingUp className="mr-1 h-3 w-3" aria-hidden />
          {sumSets(sessions)} sets
        </Badge>
      </div>

      <div className="mt-4 flex h-14 items-end gap-1.5">
        {week.map((date) => {
          const v = sumVolume(sessions.filter((s) => s.session_date === date));
          return (
            <div key={date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-10 w-full items-end">
                <div
                  className={`w-full rounded-sm ${date === today ? 'bg-accent' : 'bg-accent/35'}`}
                  style={{ height: `${Math.max(3, (v / maxDay) * 40)}px` }}
                  title={`${dayShort(date)}: ${shortWeight(v)}`}
                />
              </div>
              <span className={`text-[12px] ${date === today ? 'text-foreground' : 'text-muted/80'}`}>
                {new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-surface-light/50 pt-3">
        <div>
          <Label>PRs</Label>
          <p className="mt-1 text-[20px] font-semibold leading-none">{prsThisWeek.length}</p>
        </div>
        <div>
          <Label>TSS</Label>
          <p className="mt-1 text-[20px] font-semibold leading-none">{amount(sumTss(sessions))}</p>
        </div>
      </div>
    </Card>
  );
}

function SessionRow({ session, prs, onClick }: { session: LiftingSession; prs: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[52px_1fr_auto] items-center gap-2 border-b border-surface-light/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-light/20 sm:grid-cols-[52px_1fr_58px_86px_18px] sm:px-4"
    >
      <div className="flex flex-col items-center rounded-md bg-surface-light/25 py-0.5">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
          {new Date(`${session.session_date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}
        </span>
        <span className="text-[16px] font-semibold leading-none">{new Date(`${session.session_date}T12:00:00`).getDate()}</span>
        <span className="text-[12px] uppercase tracking-wide text-muted">
          {new Date(`${session.session_date}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })}
        </span>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
          {focusOf(session)}
          {prs > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-positive">
              <Flame className="h-3 w-3" aria-hidden />
              {prs}
            </span>
          )}
        </p>
        <p className="truncate text-[12px] text-muted">{session.sets.length} sets</p>
      </div>
      <span className="text-right text-[12px] font-medium">{shortWeight(session.total_volume_kg)}</span>
      <span className="hidden text-right text-[12px] text-muted sm:block">{amount(session.estimated_tss ?? 0)} TSS</span>
      <ChevronRight className="hidden h-4 w-4 text-muted/60 sm:block" aria-hidden />
    </button>
  );
}

function RecentCard({ sessions, prs, onOpen, onAll }: { sessions: LiftingSession[]; prs: PersonalRecord[]; onOpen: (id: string) => void; onAll: () => void }) {
  const rows = sessions.slice(0, 5);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-[15px] font-semibold">Recent sessions</h3>
        <button type="button" onClick={onAll} className="inline-flex h-11 items-center gap-1 px-1 text-[12px] font-medium text-muted hover:text-foreground">
          All {sessions.length} <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="border-t border-surface-light/40">
        {rows.map((s) => (
          <SessionRow key={s.id} session={s} prs={recentPrCount(prs, s.id)} onClick={() => onOpen(s.id)} />
        ))}
        {rows.length === 0 && <p className="px-4 py-8 text-center text-[12px] text-muted">No sessions logged yet.</p>}
      </div>
    </Card>
  );
}

function TrendCard({ chart, onAnalytics }: { chart?: ChartData; onAnalytics: () => void }) {
  const values = (chart?.series[0]?.data ?? []).slice(-10).map((v) => Number(v ?? 0));
  const labels = (chart?.labels ?? []).slice(-10).map(shortDate);
  const avg = values.length >= 4 ? values.slice(-5, -1).reduce((a, b) => a + b, 0) / 4 : undefined;
  const last = values[values.length - 1] ?? 0;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Volume trend</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {shortWeight(last)} latest week{avg ? ` · ${last >= avg ? '+' : ''}${Math.round(((last - avg) / avg) * 100)}% vs the 4-week average` : ''}
          </p>
        </div>
        <button type="button" onClick={onAnalytics} className="inline-flex h-11 items-center gap-1 px-1 text-[12px] font-medium text-muted hover:text-foreground">
          Analytics <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {values.length > 0 ? (
        <div className="mt-2">
          <VolumeTrendChart labels={labels} values={values} average={avg} height={160} />
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted">No volume history yet.</p>
      )}
      <p className="mt-1 text-[12px] text-muted">10 weeks · dashed = 4-week average</p>
    </Card>
  );
}

function PlanCard({ plan }: { plan: ReturnType<typeof usePlanWeekOverview>['data'] }) {
  const days = plan?.week.days.filter((d) => d.sport === 'strength') ?? [];
  const done = days.filter((d) => d.day_status === 'completed').length;
  if (!plan) return null;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label>Plan</Label>
          <p className="mt-1 text-[13px] font-semibold">{plan.plan.name}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            Week {plan.week.week_number} · {days.length ? `${days.length} strength days` : 'rest block'}
          </p>
        </div>
        {days.length > 0 && <Badge tone="accent">{done}/{days.length}</Badge>}
      </div>
      {days.length > 0 ? (
        <>
          <div className="mt-3 flex gap-1">
            {days.map((d) => (
              <span
                key={d.day_date}
                className={`h-1 flex-1 rounded-full ${
                  d.day_status === 'completed' ? 'bg-accent' : d.day_status === 'partial' ? 'bg-caution/70' : 'bg-surface-light'
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">{days.map((d) => initials(d.planned_focus ?? 'session')).join(' · ')}</p>
        </>
      ) : (
        <p className="mt-3 text-[12px] text-muted">No strength days scheduled this week.</p>
      )}
    </Card>
  );
}

export function OverviewTab({
  sessions,
  prs,
  weeklyVolumeChart,
  isLoading = false,
  onOpenSession,
  onOpenSessions,
  onLogSession,
  onAnalytics,
}: {
  sessions: LiftingSession[];
  prs: PersonalRecord[];
  weeklyVolumeChart?: ChartData;
  isLoading?: boolean;
  onOpenSession: (id: string) => void;
  onOpenSessions: () => void;
  onLogSession: () => void;
  onAnalytics: () => void;
}) {
  const planQuery = usePlanWeekOverview();

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card className="p-5">
            <SkeletonLine className="h-3 w-32" />
            <SkeletonLine className="mt-3 h-7 w-40" />
            <SkeletonLine className="mt-3 h-4 w-64" />
            <SkeletonLine className="mt-6 h-20 w-full" />
          </Card>
          <Card className="p-5">
            <SkeletonLine className="h-3 w-20" />
            <SkeletonLine className="mt-3 h-7 w-28" />
            <SkeletonLine className="mt-6 h-16 w-full" />
          </Card>
        </div>
        <Card className="p-4">
          <SkeletonLine className="h-4 w-40" />
          <SkeletonLine className="mt-4 h-12 w-full" />
          <SkeletonLine className="mt-3 h-12 w-full" />
          <SkeletonLine className="mt-3 h-12 w-full" />
        </Card>
      </div>
    );
  }

  const today = toDateStr(new Date());
  const { start } = weekBounds(today);
  const ordered = [...sessions].sort((a, b) => (a.session_date < b.session_date ? 1 : -1));
  const currentWeekSessions = sessionsInRange(ordered, start, addDays(start, 6));
  // A rest week must not turn the landing into "0 kg". If nothing is logged this
  // week, show the most recent training week and label it as such.
  const usingLatestWeek = currentWeekSessions.length === 0 && ordered.length > 0;
  const activeStart = usingLatestWeek ? mondayOf(ordered[0].session_date) : start;
  const week = [activeStart];
  for (let i = 1; i < 7; i++) week.push(addDays(activeStart, i));
  const weekSessions = sessionsInRange(ordered, activeStart, addDays(activeStart, 6));
  const prev = sessions.filter((s) => s.session_date >= addDays(activeStart, -7) && s.session_date < activeStart);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <TodayCard
          sessions={ordered}
          plan={planQuery.data}
          today={today}
          onOpenSession={onOpenSession}
          onLogSession={onLogSession}
        />
        <WeekCard
          sessions={weekSessions}
          prs={prs}
          week={week}
          prev={prev}
          today={today}
          label={usingLatestWeek ? `Latest training week · ${shortDate(activeStart)}` : 'This week'}
          emptyCurrentWeek={usingLatestWeek}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.5fr_1fr]">
        <RecentCard sessions={ordered} prs={prs} onOpen={onOpenSession} onAll={onOpenSessions} />
        <div className="space-y-3">
          <TrendCard chart={weeklyVolumeChart} onAnalytics={onAnalytics} />
          <PlanCard plan={planQuery.data} />
        </div>
      </div>
    </div>
  );
}
