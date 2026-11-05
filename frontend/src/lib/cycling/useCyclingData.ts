'use client';

/**
 * One data layer for the cycling page, split by mode so a tab mounts only its
 * own queries. The shared pieces (profile, activities) are read on every mode,
 * so they live here rather than in each component.
 *
 * Cache keys are the app's existing ones where they exist (`cycling-profile`,
 * `cycling-metrics`, `power-curve`, `power-zones`, `vo2max`) so this page and
 * `/dashboard` / `/analytics` share entries instead of duplicating fetches.
 */
import { useQuery } from '@tanstack/react-query';
import type {
  Activity,
  ChartData,
  CyclingMetricsSummary,
  CyclingProfile,
  DecouplingHistoryResponse,
  PowerCurveResponse,
  PowerModelResultsResponse,
  PowerZonesResponse,
  TrainingLoadResponse,
  Vo2maxResponse,
  WeatherAnalysisResponse,
} from '@/lib/api';
import { useAuthFetch } from '@/lib/api';

export type CyclingMode = 'form' | 'rides' | 'power';

const STALE = 300_000;

function useCyclingFetch() {
  const { authFetch, token } = useAuthFetch();
  return { authFetch, enabled: !!token };
}

/** Profile + the raw activity index — needed by all three modes. */
function useShared() {
  const { authFetch, enabled } = useCyclingFetch();

  const profile = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    staleTime: STALE,
    enabled,
  });

  const activities = useQuery<Activity[]>({
    queryKey: ['activities', 'cycling-index'],
    queryFn: () =>
      authFetch<Activity[]>(
        '/api/v1/activities?limit=200&include_context=true&sort_by=start_date&sort_order=desc',
      ),
    staleTime: 120_000,
    enabled,
  });

  return { profile, activities };
}

function useFormQueries(enabled: boolean) {
  const { authFetch } = useCyclingFetch();

  const metrics = useQuery<CyclingMetricsSummary>({
    queryKey: ['cycling-metrics'],
    queryFn: () => authFetch<CyclingMetricsSummary>('/api/v1/cycling/metrics-summary'),
    staleTime: 120_000,
    enabled,
  });

  const load = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', 90],
    queryFn: () => authFetch<TrainingLoadResponse>('/api/v1/cycling/training-load?days=90'),
    staleTime: STALE,
    enabled,
  });

  const ramp = useQuery<ChartData>({
    queryKey: ['chart-ramp-rate', 13],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/ramp_rate?weeks=13'),
    staleTime: STALE,
    enabled,
  });

  return { metrics, load, ramp };
}

function usePowerQueries(enabled: boolean) {
  const { authFetch } = useCyclingFetch();

  const curveWindow = useQuery<PowerCurveResponse>({
    queryKey: ['power-curve', 90],
    queryFn: () => authFetch<PowerCurveResponse>('/api/v1/cycling/power-curve?days=90'),
    staleTime: STALE,
    enabled,
  });

  const curveYear = useQuery<PowerCurveResponse>({
    queryKey: ['power-curve', 365],
    queryFn: () => authFetch<PowerCurveResponse>('/api/v1/cycling/power-curve?days=365'),
    staleTime: STALE,
    enabled,
  });

  const percentile = useQuery<ChartData>({
    queryKey: ['chart-power-duration-percentile', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/power_duration_percentile?days=90'),
    staleTime: STALE,
    enabled,
  });

  const zones = useQuery<PowerZonesResponse>({
    queryKey: ['power-zones', 90],
    queryFn: () => authFetch<PowerZonesResponse>('/api/v1/cycling/power-zones?days=90'),
    staleTime: STALE,
    enabled,
  });

  const decoupling = useQuery<DecouplingHistoryResponse>({
    queryKey: ['decoupling-history', 90],
    queryFn: () => authFetch<DecouplingHistoryResponse>('/api/v1/cycling/decoupling?days=90&min_duration=60'),
    staleTime: STALE,
    enabled,
  });

  const model = useQuery<PowerModelResultsResponse>({
    queryKey: ['power-model'],
    queryFn: () => authFetch<PowerModelResultsResponse>('/api/v1/cycling/power-model'),
    staleTime: 600_000,
    enabled,
  });

  const vo2max = useQuery<Vo2maxResponse>({
    queryKey: ['vo2max', 90],
    queryFn: () => authFetch<Vo2maxResponse>('/api/v1/cycling/vo2max?days=90'),
    staleTime: 600_000,
    enabled,
  });

  const weather = useQuery<WeatherAnalysisResponse>({
    queryKey: ['weather-analysis'],
    queryFn: () => authFetch<WeatherAnalysisResponse>('/api/v1/cycling/weather-analysis'),
    staleTime: 600_000,
    enabled,
  });

  return { curveWindow, curveYear, percentile, zones, decoupling, model, vo2max, weather };
}

/**
 * Mounts only what the active mode needs. Deliberately not gated on visibility
 * (IntersectionObserver) — that bug is why the old page sometimes rendered no
 * power data at all; tab gating is user intent, not layout.
 */
export function useCyclingData(mode: CyclingMode) {
  const shared = useShared();
  const form = useFormQueries(mode === 'form');
  const power = usePowerQueries(mode === 'power');

  const isLoading =
    shared.profile.isLoading ||
    shared.activities.isLoading ||
    (mode === 'form' && (form.metrics.isLoading || form.load.isLoading)) ||
    (mode === 'power' && power.curveWindow.isLoading);

  return {
    ...shared,
    ...form,
    ...power,
    isLoading,
  };
}
