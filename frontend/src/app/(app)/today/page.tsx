'use client';

// Feature 5 / B-16 — morning brief POC (`/today`). Self-contained: verdict +
// plan + weather + top insight. Zero changes to existing pages — if the POC
// fails, delete this file (plus the Sidebar entry) and nothing else notices.

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, getPlanWeek, getTrainingPlans } from '@/lib/api';
import type {
  ForecastResponse,
  ReadinessResponse,
  SleepDebtResponse,
  TodaySummary,
  TrainingPlanSummary,
  TrainingWeekDay,
} from '@/lib/api';
import { getForecast } from '@/lib/api/weather';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { DomainIcon } from '@/components/ui/DomainIcon';
import { useAthleteState } from '@/lib/athlete';
import { VerdictCard } from '@/components/athlete';
import { ZoneFlow } from '@/components/zoneFlow/ZoneFlow';
import { NextSessionCard } from '@/components/training/NextSessionCard';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { usePageTitle } from '@/lib/usePageTitle';
import { PageHeader } from '@/components/ui/PageHeader';
import { MOTION } from '@/components/motion/tokens';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';
import { sportLabel } from '@/lib/sportUtils';
import {
  insightOneLiner,
  pickTopInsight,
  type BriefInsight,
} from '@/lib/brief';

/* ── Swipeable verdict views (ui-redesign-v2 §3.5 mobile-first) ──────────────
   Small touch-swipe wrapper around the existing VerdictCard slot: a
   horizontal swipe (≥48px, horizontal-dominant) moves between the Today /
   Week / Month verdict views. This page hosts the single Today view, so the
   wrapper is gesture parity with the dashboard slot (swipes clamp in place)
   — the dashboard instance wires the same wrapper to its existing tabs, and
   those tabs stay as the fallback (swipe never replaces them).
   Gated behind prefers-reduced-motion: reduced motion renders the static
   fallback (no slide transform). Dark tokens, 12px floor, 44px dot targets.
   Display only — VerdictCard props and queries untouched. ───────────────── */
const VERDICT_SWIPE_MIN_PX = 48;
const VERDICT_SWIPE_CLAMP_PX = 96;

function SwipeViews({
  index,
  count,
  onIndex,
  viewsLabel,
  children,
}: {
  index: number;
  count: number;
  onIndex: (next: number) => void;
  viewsLabel: string;
  children: React.ReactNode;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = React.useState(0);

  const go = (dir: 1 | -1) =>
    onIndex(Math.min(count - 1, Math.max(0, index + dir)));

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      startRef.current = null;
      return;
    }
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || e.touches.length !== 1 || reduceMotion) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
      setDragX(0);
      return;
    }
    setDragX(Math.max(-VERDICT_SWIPE_CLAMP_PX, Math.min(VERDICT_SWIPE_CLAMP_PX, dx)));
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    setDragX(0);
    if (!start || count < 2) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= VERDICT_SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={viewsLabel}
      tabIndex={count > 1 ? 0 : undefined}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
    >
      <div
        style={
          reduceMotion || dragX === 0
            ? undefined
            : {
                transform: `translateX(${dragX}px)`,
                transition: `transform ${MOTION.durationFastMs}ms ${MOTION.easeOut}`,
              }
        }
      >
        {children}
      </div>
      {count > 1 && (
        <div className="flex items-center justify-center gap-1 pt-1" aria-hidden={false}>
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onIndex(i)}
              aria-label={`Show verdict view ${i + 1} of ${count}`}
              aria-current={i === index ? 'true' : undefined}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <span
                aria-hidden="true"
                className={`block h-2 w-2 rounded-full ${i === index ? 'bg-accent' : 'bg-surface-light'}`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function weatherNote(day: { temp_max: number; precipitation_probability: number | null; wind_speed_max: number; conditions: string }): string {
  const notes: string[] = [];
  if (day.temp_max >= 30) notes.push('hot — hydrate aggressively');
  else if (day.temp_max <= 3) notes.push('near-freezing — layer up');
  const cond = day.conditions.toLowerCase();
  if ((day.precipitation_probability ?? 0) >= 50) notes.push('rain likely — fenders/form check');
  else if (cond.includes('drizzle')) notes.push('drizzle — damp roads, lights on');
  else if (cond.includes('rain')) notes.push('rain in the forecast — plan shelter or indoor');
  if (day.wind_speed_max >= 30) notes.push('windy — expect a hard return leg');
  // Drizzle/rain is never "good conditions for quality work" (2.2).
  if (notes.length === 0) notes.push('good conditions for quality work');
  return notes.join(' · ');
}

export default function TodayBriefPage() {
  usePageTitle('Today');
  const { authFetch, token } = useAuthFetch();

  const { data: todaySummary, isError: todayError } = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const { data: readiness, isError: readinessError } = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const { data: sleepDebt } = useQuery<SleepDebtResponse>({
    queryKey: ['metrics', 'sleep-debt'],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const { data: insights } = useQuery<BriefInsight[]>({
    queryKey: ['analytics', 'insights'],
    queryFn: () => authFetch<BriefInsight[]>('/api/v1/analytics/insights'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const { data: forecast } = useQuery<ForecastResponse | null>({
    queryKey: ['weather', 'forecast-brief'],
    queryFn: () => getForecast(token, 1),
    staleTime: 30 * 60_000,
    enabled: !!token,
  });

  const { data: activePlans } = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans', 'active'],
    queryFn: () => getTrainingPlans(authFetch, 'active'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const activePlan = activePlans?.[0] ?? null;
  const currentWeek = activePlan ? getCurrentWeek(activePlan.start_date, activePlan.end_date) : 0;
  const { data: planWeek } = useQuery({
    queryKey: ['plan-week', activePlan?.id, currentWeek],
    queryFn: () => getPlanWeek(authFetch, activePlan!.id, currentWeek),
    staleTime: 60_000,
    enabled: !!token && !!activePlan,
  });
  const todayPlanDay: TrainingWeekDay | undefined = (planWeek?.days ?? []).find(
    (d) => d.day_date === toDateStr(new Date()),
  );

  /* ── Phase 1 shared verdict slot (plans/ui-redesign-v2.md §1.3) ──────────
     The VerdictCard props below are IDENTICAL to the dashboard slot (verdict,
     planContext, tsb, sleepDebtHours, isLoading — no per-page forks), so the
     dashboard/TODAY contradiction dies by construction. Plan-relative
     (adjust-or-affirm, never invented workouts); the card's own fallbacks
     cover rest days and the no-plan case. Display only — no computation
     changes (docs/algorithms.md authoritative). */
  const athlete = useAthleteState();
  const verdictTodaySlice = athlete.plan.today;
  const verdictPlanContext = athlete.plan.activePlan
    ? {
        planName: athlete.plan.activePlan.name,
        dayLabel:
          verdictTodaySlice && verdictTodaySlice.sport !== 'rest'
            ? verdictTodaySlice.workout_description || sportLabel(verdictTodaySlice.sport)
            : null,
      }
    : null;
  const verdictIsLoading = athlete.verdict.isLoading || athlete.plan.isLoading;
  const topInsight = pickTopInsight(insights ?? [], sleepDebt?.debt_hours ?? null);
  const todayWx = forecast?.days?.[0];
  const hasQueryError = todayError || readinessError;

  if (!token) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Today's Brief"
        subtitle="One verdict, the plan, the weather, and your sharpest insight. Experimental — tell us if it earns the bookmark."
      />

      <ErrorState variant="inline"
        show={hasQueryError}
        message="Some of today's data failed to load."
      />

      {/* 1 — Verdict. The shared Phase 1 card (same props shape as the
          dashboard slot): server verdict headline + reasons + full consensus
          incl. silent engines, with plan-relative fallbacks. */}
      <SwipeViews index={0} count={1} onIndex={() => {}} viewsLabel="Today verdict">
      <VerdictCard
        verdict={athlete.verdict.verdict}
        planContext={verdictPlanContext}
        tsb={athlete.load.tsb}
        sleepDebtHours={athlete.body.sleepDebtHours}
        isLoading={verdictIsLoading}
      />
      </SwipeViews>

      {/* 2-col on desktop (2.2): action left, context right */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
      {/* 2 — Suggested session (B-17, from the verdict above) */}
      <NextSessionCard
        inputs={{
          recoveryScore: readiness?.recovery_score ?? null,
          tsb: todaySummary?.current_tsb ?? null,
          sleepDebtHours: sleepDebt?.debt_hours ?? null,
          windKmh: todayWx?.wind_speed_max ?? null,
          tempMax: todayWx?.temp_max ?? null,
          plannedSport: todayPlanDay?.sport ?? null,
          plannedTss: todayPlanDay?.planned_tss ?? null,
        }}
      />

      {/* 3 — Today's plan */}
      <Card>
        <CardHeader>
          <CardTitle><span className="inline-flex items-center gap-2"><DomainIcon domain="training" /> Today&apos;s Plan</span></CardTitle>
        </CardHeader>
        {!activePlan ? (
          <EmptyState
            icon="📅"
            title="No active plan"
            description="Training plans turn your goals into scheduled workouts with target TSS. Create one under Training to see today's session here."
            action={{ label: 'Create a training plan', href: '/training' }}
          />
        ) : !todayPlanDay ? (
          <div role="status" className="flex flex-col items-center gap-1 py-4 text-center">
            <p className="text-3xl" aria-hidden="true">😴</p>
            <p className="text-sm font-medium text-foreground">Rest day</p>
            <p className="text-xs text-muted">Recovery is training too — rest lifts freshness for the next hard session.</p>
            <Link href="/training" className="min-h-[44px] inline-flex items-center text-accent hover:text-accent-hover text-xs mt-1">
              Open Training →
            </Link>
          </div>
        ) : (
          <div>
            <p className="text-sm text-foreground font-medium">
              {todayPlanDay.sport === 'rest' ? 'Rest' : todayPlanDay.workout_description || sportLabel(todayPlanDay.sport)}
            </p>
            {todayPlanDay.planned_tss != null && (
              <p className="text-xs text-muted mt-1">Target ~{todayPlanDay.planned_tss} TSS</p>
            )}
            <Link href="/training" className="min-h-[44px] inline-flex items-center text-accent hover:text-accent-hover text-xs mt-2">
              Open Training →
            </Link>
          </div>
        )}
      </Card>
        </div>
        <div className="lg:col-span-2 space-y-6">
      {/* 4 — Weather */}
      <Card>
        <CardHeader>
          <CardTitle><span className="inline-flex items-center gap-2"><DomainIcon domain="health" /> Today&apos;s Weather</span></CardTitle>
        </CardHeader>
        {todayWx ? (
          <div>
            <p className="text-sm text-foreground">
              {Math.round(todayWx.temp_max)}°C max · {todayWx.conditions} · wind {Math.round(todayWx.wind_speed_max)} km/h
            </p>
            <p className="text-xs text-muted mt-1">{weatherNote(todayWx)}</p>
          </div>
        ) : (
          <div role="status" className="flex flex-col items-start gap-1">
            <p className="text-sm font-medium text-foreground">No forecast yet</p>
            <p className="text-xs text-muted">Set a home location in Settings to get the forecast.</p>
            <Link href="/settings" className="min-h-[44px] inline-flex items-center text-accent hover:text-accent-hover text-xs">
              Open Settings →
            </Link>
          </div>
        )}
      </Card>

      {/* 5 — Top insight (hidden until data exists, 1.4) */}
      {topInsight && (
      <Card>
        <CardHeader>
          <CardTitle><span className="inline-flex items-center gap-2"><DomainIcon domain="analytics" /> Insight of the Day</span></CardTitle>
        </CardHeader>
          <div>
            <p className="text-sm text-foreground">{insightOneLiner(topInsight)}</p>
            <p className="text-xs text-muted mt-1">
              {topInsight.insight_type.replace(/_/g, ' ')} · {topInsight.confidence} confidence · n={topInsight.sample_size}
            </p>
            <Link href="/analytics" className="text-accent hover:text-accent-hover text-xs mt-2 inline-block">
              All insights →
            </Link>
          </div>
      </Card>
      )}
        </div>
      </div>
      {/* 6 — "I have 1 hour, Z2" on-demand flow (ui-redesign-v2 §4.3).
          Embedded ZoneFlow section: on-demand only (nothing fires until the
          user taps Find — component behavior, kept). Today's cycle plan day
          is passed as pushDay for one-tap Wahoo push + plan write-back
          context; without a plan the rows degrade to their honest note.
          Display wiring only — no computation changes. */}
      <section aria-label="Find a route for available time">
        <ZoneFlow
          planId={activePlan?.id ?? null}
          planDays={planWeek?.days}
          pushDay={todayPlanDay ?? null}
        />
      </section>
    </div>
  );
}
