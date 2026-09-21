'use client';

// Feature 6 / B-17 — next-session suggestion card. Presentational core +
// self-fetching wrapper (shares React Query keys with /today, so no double
// fetch when both render).

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ForecastResponse, ReadinessResponse, SleepDebtResponse, TodaySummary } from '@/lib/api';
import { getForecast } from '@/lib/api/weather';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { computeVerdict } from '@/lib/brief';
import { nextSessionSuggestion } from '@/lib/prescription';

export interface SessionInputs {
  recoveryScore: number | null;
  tsb: number | null;
  sleepDebtHours: number | null;
  windKmh: number | null;
  tempMax: number | null;
  plannedSport: string | null;
  plannedTss: number | null;
}

export function NextSessionCard({ inputs }: { inputs: SessionInputs }) {
  const verdict = computeVerdict({
    recoveryScore: inputs.recoveryScore,
    tsb: inputs.tsb,
    sleepDebtHours: inputs.sleepDebtHours,
  });
  const suggestion = nextSessionSuggestion({
    verdict,
    sleepDebtHours: inputs.sleepDebtHours,
    windy: (inputs.windKmh ?? 0) >= 30,
    hot: (inputs.tempMax ?? 0) >= 30,
    plannedSport: inputs.plannedSport,
    plannedTss: inputs.plannedTss,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>🧭 Suggested Session</CardTitle>
      </CardHeader>
      <p className="text-sm text-foreground font-medium">{suggestion.title}</p>
      <p className="text-sm text-muted mt-1">{suggestion.detail}</p>
      {suggestion.reasons.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-accent cursor-pointer hover:text-accent-hover">
            Why this suggestion?
          </summary>
          <ul className="mt-1 space-y-1">
            {suggestion.reasons.map((r) => (
              <li key={r} className="text-xs text-muted">• {r}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Self-fetching variant for pages that don't already hold the inputs. */
export function NextSessionCardAuto({ plannedSport = null, plannedTss = null }: { plannedSport?: string | null; plannedTss?: number | null }) {
  const { authFetch, token } = useAuthFetch();
  const { data: readiness } = useQuery<ReadinessResponse>({
    queryKey: ['readiness'],
    queryFn: () => authFetch<ReadinessResponse>('/api/v1/metrics/readiness'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const { data: today } = useQuery<TodaySummary>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => authFetch<TodaySummary>('/api/v1/dashboard/today'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const { data: debt } = useQuery<SleepDebtResponse>({
    queryKey: ['metrics', 'sleep-debt'],
    queryFn: () => authFetch<SleepDebtResponse>('/api/v1/metrics/sleep-debt?days=7'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const { data: forecast } = useQuery<ForecastResponse | null>({
    queryKey: ['weather', 'forecast-brief'],
    queryFn: () => getForecast(token, 1),
    staleTime: 30 * 60_000,
    enabled: !!token,
  });
  const wx = forecast?.days?.[0];

  return (
    <NextSessionCard
      inputs={{
        recoveryScore: readiness?.recovery_score ?? null,
        tsb: today?.current_tsb ?? null,
        sleepDebtHours: debt?.debt_hours ?? null,
        windKmh: wx?.wind_speed_max ?? null,
        tempMax: wx?.temp_max ?? null,
        plannedSport,
        plannedTss,
      }}
    />
  );
}
