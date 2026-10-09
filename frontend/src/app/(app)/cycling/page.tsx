'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  CyclingProfile,
  CyclingProfileUpdate,
  CyclingMetricsSummary,
  Connection,
  CyclingPowerRecord,
  TrainingLoadResponse,
  PowerCurveResponse,
  PowerZonesResponse,
  HrZonesResponse,
  PowerVsHrResponse,
  PowerModelResultsResponse,
  WeatherAnalysisResponse,
  ChartData,
  FtpEstimate,
  LifetimePBsResponse,
  FtpHistoryEntry,
  BackfillFtpResult,
  Vo2maxResponse,
  Vo2maxHistoryResponse,
  DecouplingHistoryResponse,
  WeightHistoryResponse,
} from '@/lib/api';
import { getWeightHistory } from '@/lib/api';
import { type PREvent } from '@/components/ui/PRCelebration';
import { Card } from '@/components/ui/Card';
import { MetricCard } from '@/components/cycling/MetricCard';
import { LoadStrip, SyncBadge, WeightCard } from '@/components/athlete';
import {
  deriveLastSyncedAt,
  deriveLoadTrend,
  deriveStaleProviders,
  deriveWeekTss,
} from '@/lib/athlete';
import { ProfileEditor } from '@/components/cycling/ProfileEditor';
import { TrainingLoadSection } from '@/components/cycling/TrainingLoadSection';
import { NextSessionCardAuto } from '@/components/training/NextSessionCard';
import { PowerCurveSection } from '@/components/cycling/PowerCurveSection';
import { PowerModelSection } from '@/components/cycling/PowerModelSection';
import { WeatherAnalysisSection } from '@/components/cycling/WeatherAnalysisSection';
import { Vo2maxSection } from '@/components/cycling/Vo2maxSection';
import { DecouplingSection } from '@/components/cycling/DecouplingSection';
import { FtpSection } from '@/components/cycling/FtpSection';
import { WeightPanel } from '@/components/cycling/WeightPanel';
import { usePageTitle } from '@/lib/usePageTitle';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TimeRangePicker } from '@/components/dashboard/TimeRangePicker';
import { TimeRangeProvider, timeRangeDays, useTimeRange } from '@/lib/time-range';

export default function CyclingPage() {
  /* The shared REVIEW time-range (ui-redesign-v2 §2.1) must wrap every
     consumer — including the picker itself — so the page body lives in an
     inner component under the provider (dashboard pattern). */
  return (
    <TimeRangeProvider>
      <CyclingPageInner />
    </TimeRangeProvider>
  );
}

function CyclingPageInner() {
  usePageTitle('Cycling');
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const saveTimeoutRef = useRef<NodeJS.Timeout[]>([]);

  /* ── Shared REVIEW time-range (ui-redesign-v2 §2.1): one picker drives every
     cycling chart together. Day spans are clamped to the backend `?days=` cap
     (≤365) inside timeRangeDays; months are derived for the `?months=`
     endpoints (cap 12). Display only — no computation changes
     (docs/algorithms.md authoritative). ─────────────────────────────────── */
  const { start: rangeStart, end: rangeEnd, setCustom: setRangeCustom } = useTimeRange();
  const chartDays = timeRangeDays(rangeStart, rangeEnd);
  const chartMonths = Math.min(12, Math.max(1, Math.round(chartDays / 30)));
  // The day selectors inside TrainingLoadSection + PowerCurveSection write
  // into the shared context (custom window ending today), so every chart on
  // the page re-cuts together. Only the window source changes — every chart,
  // table, and card stays (data maximalism).
  const writeRangeDays = (d: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (d - 1));
    setRangeCustom(start, end);
  };

  // Section anchor refs (used as scroll-to anchors in the JSX below).
  // Core power queries (FTP / VO2max / decoupling) now fire eagerly on mount —
  // the IntersectionObserver visibility gate was removed so core data can no
  // longer fail to load (AGATES #12). powerCurveRef was already a plain anchor.
  const powerCurveRef = useRef<HTMLDivElement>(null);
  const vo2maxRef = useRef<HTMLDivElement>(null);
  const decouplingRef = useRef<HTMLDivElement>(null);
  const ftpRef = useRef<HTMLDivElement>(null);

  // Cleanup timeouts on unmount (BUG-026)
  useEffect(() => {
    return () => {
      saveTimeoutRef.current.forEach(clearTimeout);
    };
  }, []);

  // ── Queries ─────────────────────────────────────────────────────────────
  const {
    data: profile,
    isLoading: profileLoading,
    isError: profileError,
  } = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: metrics, isError: metricsError } = useQuery<CyclingMetricsSummary>({
    queryKey: ['cycling-metrics'],
    queryFn: () => authFetch<CyclingMetricsSummary>('/api/v1/cycling/metrics-summary'),
    staleTime: 120_000,
    enabled: !!token,
  });

  const { data: trainingLoad, isLoading: loadLoading } = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', chartDays],
    queryFn: () => authFetch<TrainingLoadResponse>(`/api/v1/cycling/training-load?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: powerCurve, isLoading: curveLoading } = useQuery<PowerCurveResponse>({
    queryKey: ['power-curve', chartDays],
    queryFn: () => authFetch<PowerCurveResponse>(`/api/v1/cycling/power-curve?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: powerModel, isLoading: powerModelLoading } = useQuery<PowerModelResultsResponse>({
    queryKey: ['power-model'],
    queryFn: () => authFetch<PowerModelResultsResponse>('/api/v1/cycling/power-model'),
    staleTime: 600_000,
    enabled: !!token,
  });

  const { data: weatherAnalysis, isLoading: weatherLoading } = useQuery<WeatherAnalysisResponse>({
    queryKey: ['weather-analysis'],
    queryFn: () => authFetch<WeatherAnalysisResponse>('/api/v1/cycling/weather-analysis'),
    staleTime: 600_000,
    enabled: !!token,
  });

  const { data: powerZones, isLoading: zonesLoading } = useQuery<PowerZonesResponse>({
    queryKey: ['power-zones', chartDays],
    queryFn: () => authFetch<PowerZonesResponse>(`/api/v1/cycling/power-zones?days=${chartDays}`),
    enabled: !!token && !!profile?.ftp_watts,
    staleTime: 300_000,
  });

  const { data: powerVsHr } = useQuery<PowerVsHrResponse>({
    queryKey: ['power-vs-hr', chartDays],
    queryFn: () => authFetch<PowerVsHrResponse>(`/api/v1/cycling/power-vs-hr?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: chartTrainingLoad } = useQuery<ChartData>({
    queryKey: ['chart-training-load', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/training_load?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: chartPowerCurve } = useQuery<ChartData>({
    queryKey: ['chart-stream-power-curve', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/stream_power_curve?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  // Merge the Morton 3-param fitted curve (keyed by duration seconds) into the
  // stream power-curve chart as a second series overlay.
  const fittedCurveData = useMemo<ChartData | undefined>(() => {
    if (!chartPowerCurve || !powerCurve?.fitted_curve) return undefined;
    const labelToSeconds = new Map(
      (powerCurve.data ?? []).map((p) => [p.duration_label, p.duration_seconds])
    );
    const fittedValues = (chartPowerCurve.labels ?? []).map((label) => {
      const secs = labelToSeconds.get(label);
      if (secs == null) return null;
      const v = powerCurve.fitted_curve?.[String(secs)];
      return typeof v === 'number' ? v : null;
    });
    if (fittedValues.every((v) => v == null)) return undefined;
    return {
      ...chartPowerCurve,
      series: [
        ...chartPowerCurve.series,
        { name: 'Fitted (CP model)', data: fittedValues, color: '#22d3ee' },
      ],
    };
  }, [chartPowerCurve, powerCurve]);

  const comparisonBaselineDays = Math.min(365, chartDays * 3);
  const { data: chartPowerComparison } = useQuery<ChartData>({
    queryKey: ['chart-power-comparison', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/power_curve_comparison?days=${chartDays}&days_b=${comparisonBaselineDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: chartPowerZones } = useQuery<ChartData>({
    queryKey: ['chart-power-zones', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/power_zones?days=${chartDays}`),
    enabled: !!token && !!profile?.ftp_watts,
    staleTime: 300_000,
  });

  const { data: chartDailyTss } = useQuery<ChartData>({
    queryKey: ['chart-daily-tss', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/daily_tss?days=${chartDays}`),
    staleTime: 120_000,
    enabled: !!token,
  });

  const { data: lifetimePBs } = useQuery<LifetimePBsResponse>({
    queryKey: ['lifetime-pbs'],
    queryFn: () => authFetch<LifetimePBsResponse>('/api/v1/cycling/lifetime-pbs'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: ftpHistory } = useQuery<FtpHistoryEntry[]>({
    queryKey: ['ftp-history'],
    queryFn: () => authFetch<FtpHistoryEntry[]>('/api/v1/cycling/ftp-history'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: chartFtpHistory } = useQuery<ChartData>({
    queryKey: ['chart-ftp-history'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/ftp_history'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const { data: hrZones } = useQuery<HrZonesResponse>({
    queryKey: ['hr-zones', chartDays],
    queryFn: () => authFetch<HrZonesResponse>(`/api/v1/cycling/hr-zones?days=${chartDays}`),
    enabled: !!token && !!profile?.lactate_threshold_hr,
    staleTime: 300_000,
  });

  const { data: chartHrZones } = useQuery<ChartData>({
    queryKey: ['chart-hr-zones', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/hr_zone_distribution?days=${chartDays}`),
    enabled: !!token && !!profile?.lactate_threshold_hr,
    staleTime: 300_000,
  });

  const { data: vo2max, isLoading: vo2maxLoading } = useQuery<Vo2maxResponse>({
    queryKey: ['vo2max', chartDays],
    queryFn: () => authFetch<Vo2maxResponse>(`/api/v1/cycling/vo2max?days=${chartDays}`),
    enabled: !!token,
    staleTime: 600_000,
  });

  const { data: vo2maxHistory } = useQuery<Vo2maxHistoryResponse>({
    queryKey: ['vo2max-history', chartMonths],
    queryFn: () => authFetch<Vo2maxHistoryResponse>(`/api/v1/cycling/vo2max-history?months=${chartMonths}`),
    enabled: !!token,
    staleTime: 600_000,
  });

  const { data: chartVo2maxTrend } = useQuery<ChartData>({
    queryKey: ['chart-vo2max-trend', chartMonths],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/vo2max_trend?months=${chartMonths}`),
    enabled: !!token,
    staleTime: 600_000,
  });

  const { data: decoupling } = useQuery<DecouplingHistoryResponse>({
    queryKey: ['decoupling-history', chartDays],
    queryFn: () => authFetch<DecouplingHistoryResponse>(`/api/v1/cycling/decoupling?days=${chartDays}&min_duration=60`),
    enabled: !!token,
    staleTime: 600_000,
  });

  const { data: chartDecouplingTrend } = useQuery<ChartData>({
    queryKey: ['chart-decoupling-trend', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/decoupling_trend?days=${chartDays}`),
    enabled: !!token,
    staleTime: 600_000,
  });

  const { data: chartWeightTrend } = useQuery<ChartData>({
    queryKey: ['chart-weight-trend', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/weight_trend?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  // ── Phase 1 shared header (plans/ui-redesign-v2.md §1) ──────────────────
  // `LoadStrip` is the single home for CTL/ATL/TSB/FTP display; `SyncBadge`
  // shows degradation (never averaged away). Props here are identical to the
  // training-page slot (guardrail §1.3) — same component, same derivation
  // from the server-computed training-load series. No computation changes.
  const { data: connections } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 300_000,
    enabled: !!token,
  });

  // Shared cache key with `WeightPanel` (days=90) — the read-only `WeightCard`
  // below renders from the same entry, logging stays in `WeightPanel`.
  const {
    data: weightHistory,
    isLoading: weightLoading,
    isError: weightError,
  } = useQuery<WeightHistoryResponse>({
    queryKey: ['weight-history'],
    queryFn: () => getWeightHistory(authFetch, 90),
    staleTime: 300_000,
    enabled: !!token,
  });

  // ── Cycling Power PRs ───────────────────────────────────────────────────
  const { data: cyclingPRs, isLoading: cyclingPRsLoading, refetch: refetchPRs } = useQuery<CyclingPowerRecord[]>({
    queryKey: ['cycling-prs'],
    queryFn: () => authFetch<CyclingPowerRecord[]>('/api/v1/cycling/prs'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const [celebrationPR, setCelebrationPR] = useState<PREvent | null>(null);

  const checkPRsMutation = useMutation({
    mutationFn: () => authFetch<{ checked: number; new_prs: number; updated_prs: number; prs: CyclingPowerRecord[] }>(
      '/api/v1/cycling/prs/check',
      { method: 'POST', body: JSON.stringify({}) }
    ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cycling-prs'] });
      if (data.prs && data.prs.length > 0) {
        // Celebrate the first new PR (improvement_pct > 0 or null = new)
        const newPR = data.prs.find(p => p.improvement_pct === null || (p.improvement_pct ?? 0) > 0);
        if (newPR) {
          setCelebrationPR({
            type: 'cycling',
            duration_label: newPR.duration_label,
            new_power: newPR.power_watts,
            previous_power: null,
            improvement_pct: newPR.improvement_pct ?? null,
            w_per_kg: newPR.w_per_kg,
          });
        }
      }
    },
    onError: (error: Error) => {
      console.error('PR check failed:', error.message);
    },
  });

  // ── State ───────────────────────────────────────────────────────────────
  const [ftpEstimate, setFtpEstimate] = useState<FtpEstimate | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const [backfillFtpResult, setBackfillFtpResult] = useState<string | null>(null);
  // Profile editor collapsible (1.8) — settings live behind a summary row.
  const [showProfile, setShowProfile] = useState(false);

  // ── Mutations ───────────────────────────────────────────────────────────
  const updateProfileMutation = useMutation({
    mutationFn: (data: CyclingProfileUpdate) =>
      authFetch<CyclingProfile>('/api/v1/cycling/profile', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycling-profile'] });
      queryClient.invalidateQueries({ queryKey: ['cycling-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['power-zones'] });
      queryClient.invalidateQueries({ queryKey: ['chart-power-zones'] });
      queryClient.invalidateQueries({ queryKey: ['ftp-history'] });
      queryClient.invalidateQueries({ queryKey: ['chart-ftp-history'] });
      setSaveMessage('Profile saved!');
      saveTimeoutRef.current.push(setTimeout(() => setSaveMessage(null), 3000));
    },
    onError: () => {
      setSaveMessage('Couldn\'t save — check your connection and try again.');
      saveTimeoutRef.current.push(setTimeout(() => setSaveMessage(null), 5000));
    },
  });

  const estimateFtpMutation = useMutation({
    mutationFn: () => authFetch<FtpEstimate>('/api/v1/cycling/estimate-ftp?days=90', { method: 'POST' }),
    onSuccess: (data) => {
      setFtpEstimate(data);
    },
    onError: () => {
      setFtpEstimate(null);
      setSaveMessage('Couldn\'t save — check your connection and try again.');
      saveTimeoutRef.current.push(setTimeout(() => setSaveMessage(null), 5000));
    },
  });

  const acceptEstimateMutation = useMutation({
    mutationFn: () => authFetch<FtpEstimate>('/api/v1/cycling/estimate-ftp?days=90&accept=true', { method: 'POST' }),
    onSuccess: (data) => {
      setFtpEstimate(data);
      queryClient.invalidateQueries({ queryKey: ['cycling-profile'] });
      queryClient.invalidateQueries({ queryKey: ['cycling-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['power-zones'] });
      queryClient.invalidateQueries({ queryKey: ['chart-power-zones'] });
      queryClient.invalidateQueries({ queryKey: ['training-load'] });
      queryClient.invalidateQueries({ queryKey: ['lifetime-pbs'] });
      queryClient.invalidateQueries({ queryKey: ['ftp-history'] });
      queryClient.invalidateQueries({ queryKey: ['chart-ftp-history'] });
      setSaveMessage('FTP estimated and saved!');
      saveTimeoutRef.current.push(setTimeout(() => setSaveMessage(null), 3000));
    },
    onError: () => {
      setSaveMessage('Couldn\'t save — check your connection and try again.');
      saveTimeoutRef.current.push(setTimeout(() => setSaveMessage(null), 5000));
    },
  });

  const recalculateTssMutation = useMutation({
    mutationFn: () => authFetch<{ updated: number; total_checked: number }>(
      '/api/v1/cycling/recalculate-tss?days=365&force=true',
      { method: 'POST' }
    ),
    onSuccess: (data) => {
      setRecalcResult(`Recalculated TSS for ${data.updated} of ${data.total_checked} activities`);
      queryClient.invalidateQueries({ queryKey: ['cycling-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['training-load'] });
      queryClient.invalidateQueries({ queryKey: ['chart-training-load'] });
      queryClient.invalidateQueries({ queryKey: ['chart-daily-tss'] });
    },
    onError: () => {
      setRecalcResult('Couldn\'t recalculate TSS — try again.');
    },
  });

  const backfillStreamsMutation = useMutation({
    mutationFn: () => authFetch<{ backfilled: number; total_checked: number; message?: string }>(
      '/api/v1/cycling/backfill-streams?days=90&limit=50',
      { method: 'POST' }
    ),
    onSuccess: (data) => {
      setBackfillResult(
        data.message || `Backfilled streams for ${data.backfilled} of ${data.total_checked} activities`
      );
      queryClient.invalidateQueries({ queryKey: ['power-curve'] });
      queryClient.invalidateQueries({ queryKey: ['chart-stream-power-curve'] });
      queryClient.invalidateQueries({ queryKey: ['power-zones'] });
      queryClient.invalidateQueries({ queryKey: ['chart-power-zones'] });
      queryClient.invalidateQueries({ queryKey: ['cycling-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['chart-wkg-power-curve'] });
      queryClient.invalidateQueries({ queryKey: ['chart-power-duration-percentile'] });
      queryClient.invalidateQueries({ queryKey: ['power-vs-hr'] });
      queryClient.invalidateQueries({ queryKey: ['vo2max'] });
      queryClient.invalidateQueries({ queryKey: ['vo2max-history'] });
      queryClient.invalidateQueries({ queryKey: ['chart-vo2max-trend'] });
      queryClient.invalidateQueries({ queryKey: ['decoupling-history'] });
      queryClient.invalidateQueries({ queryKey: ['chart-decoupling-trend'] });
      queryClient.invalidateQueries({ queryKey: ['cycling-prs'] });
      queryClient.invalidateQueries({ queryKey: ['activity-streams'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
    onError: () => {
      setBackfillResult('Couldn\'t backfill streams — try again.');
    },
  });

  const backfillFtpHistoryMutation = useMutation({
    mutationFn: () => authFetch<BackfillFtpResult>(
      '/api/v1/cycling/backfill-ftp-history?months=12',
      { method: 'POST' }
    ),
    onSuccess: (data) => {
      setBackfillFtpResult(
        `Backfilled ${data.created} FTP history entries over ${data.months_analyzed} months`
      );
      queryClient.invalidateQueries({ queryKey: ['ftp-history'] });
      queryClient.invalidateQueries({ queryKey: ['chart-ftp-history'] });
      queryClient.invalidateQueries({ queryKey: ['cycling-profile'] });
      queryClient.invalidateQueries({ queryKey: ['cycling-metrics'] });
    },
    onError: () => {
      setBackfillFtpResult('Couldn\'t backfill FTP history — try again.');
    },
  });

  // ── Loading state ───────────────────────────────────────────────────────
  if (profileLoading) {    return (
      <div className="space-y-6">
        <PageHeader title="Cycling" subtitle="Power analysis, training load, and cycling metrics" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <div className="animate-pulse">
                <div className="h-4 bg-surface-light rounded w-24 mb-3"></div>
                <div className="h-8 bg-surface-light rounded w-16"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const hasQueryError = profileError || metricsError;

  // Phase 1 header derivation — presentational reads of the server-computed
  // series only (docs/algorithms.md authoritative; same selectors as every
  // other LoadStrip slot, guardrail §1.3).
  const loadTrend = deriveLoadTrend(trainingLoad?.data ?? null);
  const stripWeekTss = deriveWeekTss(trainingLoad?.data ?? null);
  const staleProviders = deriveStaleProviders(connections);
  const lastSyncedAt = deriveLastSyncedAt(connections);

  // State-aware TSS banner (Phase 0 hygiene): the old `metrics.recent_tss === 0`
  // check fired on any rest week (7d window), even with healthy CTL/ATL history.
  // Display logic only — no CTL/ATL/TSB computation changes (docs/algorithms.md).
  // Show the banner only when the training-load series itself is missing/empty:
  // query settled, FTP set, and no day in the window carries TSS. Otherwise
  // render nothing (the manual "Recalculate TSS" affordance is dropped).
  const trainingLoadMissing =
    !loadLoading &&
    profile?.ftp_watts != null &&
    (!trainingLoad?.data ||
      trainingLoad.data.length === 0 ||
      trainingLoad.data.every((d) => (d.tss ?? 0) === 0));

  return (
    <div className="space-y-8">
      <PageHeader title="Cycling" subtitle="Power analysis, training load, and cycling metrics" />

      {/* Shared REVIEW chart range (ui-redesign-v2 §2.1) — one picker drives
          every cycling chart together via TimeRangeProvider. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <TimeRangePicker />
      </div>

      {/* ── Core query error banner ─────────────────────────────────────────── */}
      <ErrorState variant="inline"
        show={hasQueryError}
        message="Some cycling data failed to load."
      />

      {/* Profile Editor (collapsible — summary row, 1.8) */}
      <Card>
        <button
          onClick={() => setShowProfile((v) => !v)}
          aria-expanded={showProfile}
          className="w-full flex items-center justify-between gap-3 text-left min-h-[44px]"
        >
          <span className="text-sm font-medium text-foreground">
            Profile Settings
            <span className="text-muted font-normal">
              {' '}· FTP {profile?.ftp_watts != null ? `${Math.round(profile.ftp_watts)}W` : '—'}
              {' '}· {profile?.weight_kg != null ? `${profile.weight_kg.toFixed(1)}kg` : '—'}
            </span>
          </span>
          <span className="text-muted" aria-hidden>{showProfile ? '▾' : '▸'}</span>
        </button>
        {showProfile && (
          <div className="mt-4">
            <ProfileEditor
              profile={profile}
              onSave={(data) => updateProfileMutation.mutate(data)}
              isSaving={updateProfileMutation.isPending}
              onEstimateFtp={() => estimateFtpMutation.mutate()}
              ftpEstimate={ftpEstimate}
              isEstimating={estimateFtpMutation.isPending}
              onAcceptEstimate={() => acceptEstimateMutation.mutate()}
              saveMessage={saveMessage}
            />
          </div>
        )}
      </Card>

      {/* Shared load header (Phase 1) — the single home for CTL/ATL/TSB,
          7d TSS, and FTP display. Labs below keep their full depth; the FTP
          lab links back here. Tapping a chip jumps to its home chart. */}
      <div id="load-strip" className="scroll-mt-4">
        <LoadStrip
          ctl={trainingLoad?.current_ctl ?? null}
          atl={trainingLoad?.current_atl ?? null}
          tsb={trainingLoad?.current_tsb ?? null}
          weekTss={stripWeekTss}
          ftpWatts={profile?.ftp_watts ?? null}
          trend={loadTrend.direction}
          isLoading={loadLoading || profileLoading}
          syncBadge={
            <SyncBadge
              lastSyncedAt={lastSyncedAt}
              stale={staleProviders.length > 0}
              provider={staleProviders[0]?.provider ?? null}
            />
          }
        />
        {/* CTL benchmark classification previously rode on the CTL card —
            kept as a caption so the merge cuts no data. */}
        {metrics?.ctl_benchmark && (
          <p className="mt-1 text-xs tabular-nums text-muted">
            Fitness level: {metrics.ctl_benchmark.label}
            <span className="text-muted/70"> ({metrics.ctl_benchmark.range})</span>
          </p>
        )}
      </div>

      {/* W/kg lives outside the strip (benchmark + tooltip depth kept). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="W/kg"
          value={metrics?.power_to_weight}
          unit="W/kg"
          color="text-positive"
          subtext="At FTP"
          benchmark={metrics?.ftp_wkg_benchmark}
          tooltip="Power-to-weight ratio at FTP. Higher is better for climbing. Elite: 5-6 W/kg, Good: 3.5-4.5 W/kg."
        />
      </div>

      {/* VO2max Section */}
      <div ref={vo2maxRef}>
        <Vo2maxSection
          vo2max={vo2max}
          vo2maxHistory={vo2maxHistory}
          chartVo2maxTrend={chartVo2maxTrend}
          loading={vo2maxLoading}
        />
      </div>

      {/* Recent Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="7d TSS" value={metrics?.recent_tss?.toFixed(0)} color="text-blue-400" trend={metrics?.tss_trend} tooltip="Training Stress Score — a composite measure of ride difficulty based on intensity and duration. 100 TSS = 1 hour at FTP." />
        <MetricCard label="7d Rides" value={metrics?.recent_rides} color="text-purple-400" trend={metrics?.rides_trend} tooltip="Number of cycling activities in the last 7 days." />
        <MetricCard label="7d Distance" value={metrics?.recent_distance_km} unit="km" color="text-muted" trend={metrics?.distance_trend} tooltip="Total distance covered in the last 7 days." />
        <MetricCard label="7d Time" value={metrics?.recent_time_hours} unit="hrs" color="text-muted" trend={metrics?.time_trend} tooltip="Total time on the bike in the last 7 days." />
        <MetricCard label="7d Elevation" value={metrics?.recent_elevation_m?.toFixed(0)} unit="m" color="text-muted" trend={metrics?.elevation_trend} tooltip="Total elevation gain in the last 7 days." />
      </div>

      {/* IF & VI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Intensity Factor"
          value={metrics?.avg_intensity_factor?.toFixed(3)}
          color="text-yellow-400"
          trend={metrics?.if_trend}
          subtext="IF = NP / FTP (7d avg)"
          tooltip="Intensity Factor = Normalized Power ÷ FTP. Measures how hard a ride was relative to your max. 0.75 = endurance, 0.85 = tempo, 0.95 = threshold, 1.05+ = VO2max."
        />
        <MetricCard
          label="Avg Variability Index"
          value={metrics?.avg_variability_index?.toFixed(3)}
          color="text-blue-400"
          trend={metrics?.vi_trend}
          benchmark={metrics?.vi_benchmark}
          subtext="VI = NP / AP (7d avg, lower = steadier)"
          tooltip="Variability Index = Normalized Power ÷ Average Power. Measures how steady your power output was. 1.0 = perfectly steady. >1.2 = very variable (e.g. criteriums). Road: aim for <1.1."
        />
        <MetricCard
          label="Best 20min Power"
          value={metrics?.best_20min_power}
          unit="W"
          color="text-orange-400"
          subtext="Last 90 days"
          tooltip="Your best average power over a 20-minute window in the last 90 days. Multiply by 0.95 to estimate FTP. Key benchmark for threshold fitness."
        />
      </div>

      {/* Training Load Section */}
      <NextSessionCardAuto />
      <TrainingLoadSection
        trainingLoad={trainingLoad}
        chartTrainingLoad={chartTrainingLoad}
        isLoading={loadLoading}
        loadDays={chartDays}
        setLoadDays={writeRangeDays}
      />

      {/* Recalculate TSS Banner (state-aware: only when CTL/ATL source data is missing) */}
      {trainingLoadMissing && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                No TSS data found
              </p>
              <p className="text-xs text-muted mt-1">
                {`You have FTP set (${profile?.ftp_watts} W) but no TSS values. Click below to calculate TSS for all rides — needed for CTL/ATL/TSB.`}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => recalculateTssMutation.mutate()}
                disabled={recalculateTssMutation.isPending}
                className="min-h-[44px] px-4 py-2 text-sm bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50 font-medium whitespace-nowrap"
              >
                {recalculateTssMutation.isPending ? 'Calculating...' : '⚡ (Re)calculate TSS'}
              </button>
            </div>
          </div>
          {recalcResult && (
            <p className="text-xs text-positive mt-2">{recalcResult}</p>
          )}
        </Card>
      )}

      {/* Fetch Streams Banner */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {powerCurve?.data?.some(p => p.best_power_watts != null)
                ? 'Fetch stream data for all cycling activities'
                : 'No power stream data found'}
            </p>
            <p className="text-xs text-muted mt-1">
              Per-second power data is needed for power curves, zones, VO2max, and FTP estimation.
              Fetches streams for ALL your cycling activities (up to 500 at a time).
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => backfillStreamsMutation.mutate()}
              disabled={backfillStreamsMutation.isPending}
              className="min-h-[44px] px-4 py-2 text-sm bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50 font-medium whitespace-nowrap"
            >
              {backfillStreamsMutation.isPending ? 'Fetching...' : '📡 Fetch Streams from Strava'}
            </button>
          </div>
        </div>
        {backfillResult && (
          <p className="text-xs text-positive mt-2">{backfillResult}</p>
        )}
      </Card>

      {/* Power Curve Section */}
      <div ref={powerCurveRef}>
        <PowerCurveSection
          powerCurve={powerCurve}
          chartPowerCurve={chartPowerCurve}
          fittedCurveData={fittedCurveData}
          curveLoading={curveLoading}
          powerZones={powerZones}
          chartPowerZones={chartPowerZones}
          zonesLoading={zonesLoading}
          chartPowerComparison={chartPowerComparison}
          comparisonDays={chartDays}
          setComparisonDays={writeRangeDays}
          hrZones={hrZones}
          chartHrZones={chartHrZones}
          hasLthr={!!profile?.lactate_threshold_hr}
          powerVsHr={powerVsHr}
          chartDailyTss={chartDailyTss}
          chartWeightTrend={chartWeightTrend}
        />
      </div>

      {/* Personalized Power Model + Weather-Performance Analysis */}
      <PowerModelSection powerModel={powerModel} isLoading={powerModelLoading} />
      <WeatherAnalysisSection weatherAnalysis={weatherAnalysis} isLoading={weatherLoading} />

      {/* Weight Management — read-only shared card up top, logging stays
          in the panel below (Phase 1: one WeightCard, identical props). */}
      <div className="max-w-2xl space-y-4">
        <WeightCard
          history={weightHistory ?? null}
          isLoading={weightLoading}
          isError={weightError}
        />
        <WeightPanel />
      </div>

      {/* Decoupling Section */}
      <div ref={decouplingRef}>
        <DecouplingSection
          decoupling={decoupling}
          chartDecouplingTrend={chartDecouplingTrend}
        />
      </div>

      {/* FTP Section — the lab keeps full depth (history, estimate, PRs);
          current FTP itself lives in the load strip above. */}
      <div ref={ftpRef} className="scroll-mt-4 space-y-2">
        <p className="text-xs text-muted">
          Current FTP is shown in the{' '}
          <a href="#load-strip" className="text-accent hover:text-accent/80 underline underline-offset-2">
            load strip above
          </a>
          {' '}— below is the full history, estimation, and records lab.
        </p>
        <FtpSection
          profile={profile}
          ftpHistory={ftpHistory}
          chartFtpHistory={chartFtpHistory}
          lifetimePBs={lifetimePBs}
          ftpEstimate={ftpEstimate}
          backfillFtpResult={backfillFtpResult}
          onBackfillFtp={() => backfillFtpHistoryMutation.mutate()}
          isBackfillingFtp={backfillFtpHistoryMutation.isPending}
          cyclingPRs={cyclingPRs}
          cyclingPRsLoading={cyclingPRsLoading}
          celebrationPR={celebrationPR}
          onDismissCelebration={() => setCelebrationPR(null)}
          onCheckPRs={() => checkPRsMutation.mutate()}
          isCheckingPRs={checkPRsMutation.isPending}
          onInvalidatePRs={() => { void refetchPRs(); }}
        />
      </div>
    </div>
  );
}
