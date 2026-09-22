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
import { NextSessionCard } from '@/components/training/NextSessionCard';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { usePageTitle } from '@/lib/usePageTitle';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';
import {
  computeVerdict,
  insightOneLiner,
  pickTopInsight,
  type BriefInsight,
  type Verdict,
} from '@/lib/brief';

const VERDICT_STYLE: Record<Verdict, { ring: string; dot: string; label: string }> = {
  green: { ring: 'border-green-500/40', dot: 'bg-green-500', label: 'Train' },
  yellow: { ring: 'border-yellow-500/40', dot: 'bg-yellow-500', label: 'Careful' },
  red: { ring: 'border-red-500/40', dot: 'bg-red-500', label: 'Easy' },
};

function weatherNote(day: { temp_max: number; precipitation_probability: number | null; wind_speed_max: number; conditions: string }): string {
  const notes: string[] = [];
  if (day.temp_max >= 30) notes.push('hot — hydrate aggressively');
  else if (day.temp_max <= 3) notes.push('near-freezing — layer up');
  if ((day.precipitation_probability ?? 0) >= 50) notes.push('rain likely — fenders/form check');
  if (day.wind_speed_max >= 30) notes.push('windy — expect a hard return leg');
  if (notes.length === 0) notes.push('good conditions for quality work');
  return notes.join(' · ');
}

export default function TodayBriefPage() {
  usePageTitle('Today');
  const { authFetch, token } = useAuthFetch();

  const { data: todaySummary } = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const { data: readiness } = useQuery<ReadinessResponse>({
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

  const verdict = computeVerdict({
    recoveryScore: readiness?.recovery_score ?? null,
    tsb: todaySummary?.current_tsb ?? null,
    sleepDebtHours: sleepDebt?.debt_hours ?? null,
  });
  const style = VERDICT_STYLE[verdict.verdict];
  const topInsight = pickTopInsight(insights ?? [], sleepDebt?.debt_hours ?? null);
  const todayWx = forecast?.days?.[0];

  if (!token) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonMetric key={i} />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">Today&apos;s Brief</h1>
        <p className="text-xs text-muted mt-0.5">
          One verdict, the plan, the weather, and your sharpest insight. Experimental — tell us if it earns the bookmark.
        </p>
      </div>

      {/* 1 — Verdict */}
      <Card className={`border ${style.ring}`}>
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 rounded-full ${style.dot}`} aria-hidden />
          <p className="text-lg font-bold text-foreground">{verdict.headline}</p>
          <Badge>{style.label}</Badge>
        </div>
        {verdict.signals.length > 0 && (
          <div className="mt-3 space-y-2">
            {verdict.signals.map((s) => (
              <div key={s.label} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <span className="text-foreground font-medium">{s.label}: </span>
                  <span className="text-muted">{s.reasoning}</span>
                </div>
                <span className="text-foreground font-mono shrink-0">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

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
          <CardTitle>📋 Today&apos;s Plan</CardTitle>
        </CardHeader>
        {!activePlan ? (
          <EmptyState icon="📅" title="No active plan" description="Create one under Training." />
        ) : !todayPlanDay ? (
          <p className="text-sm text-muted">😴 Nothing planned — rest day.</p>
        ) : (
          <div>
            <p className="text-sm text-foreground font-medium">
              {todayPlanDay.sport === 'rest' ? '😴 Rest' : todayPlanDay.workout_description || todayPlanDay.sport}
            </p>
            {todayPlanDay.planned_tss != null && (
              <p className="text-xs text-muted mt-1">Target ~{todayPlanDay.planned_tss} TSS</p>
            )}
            <Link href="/training" className="text-accent hover:text-accent-hover text-xs mt-2 inline-block">
              Open Training →
            </Link>
          </div>
        )}
      </Card>

      {/* 4 — Weather */}
      <Card>
        <CardHeader>
          <CardTitle>🌤️ Today&apos;s Weather</CardTitle>
        </CardHeader>
        {todayWx ? (
          <div>
            <p className="text-sm text-foreground">
              {Math.round(todayWx.temp_max)}°C max · {todayWx.conditions} · wind {Math.round(todayWx.wind_speed_max)} km/h
            </p>
            <p className="text-xs text-muted mt-1">{weatherNote(todayWx)}</p>
          </div>
        ) : (
          <p className="text-xs text-muted">Set a home location in Settings to get the forecast.</p>
        )}
      </Card>

      {/* 5 — Top insight (hidden until data exists, 1.4) */}
      {topInsight && (
      <Card>
        <CardHeader>
          <CardTitle>💡 Insight of the Day</CardTitle>
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
  );
}
