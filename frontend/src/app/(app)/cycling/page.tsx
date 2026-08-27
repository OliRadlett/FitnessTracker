'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  CyclingProfile,
  CyclingProfileUpdate,
  CyclingMetricsSummary,
  TrainingLoadResponse,
  PowerCurveResponse,
  PowerZonesResponse,
  HrZonesResponse,
  PowerVsHrResponse,
  ChartData,
  FtpEstimate,
  LifetimePBsResponse,
  FtpHistoryEntry,
  BackfillFtpResult,
  Vo2maxResponse,
  Vo2maxHistoryResponse,
  DecouplingHistoryResponse,
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { MetricCard } from '@/components/cycling/MetricCard';
import { ProfileEditor } from '@/components/cycling/ProfileEditor';
import { TrainingLoadSection } from '@/components/cycling/TrainingLoadSection';
import { PowerCurveSection } from '@/components/cycling/PowerCurveSection';
import { Vo2maxSection } from '@/components/cycling/Vo2maxSection';
import { DecouplingSection } from '@/components/cycling/DecouplingSection';
import { FtpSection } from '@/components/cycling/FtpSection';
import { usePageTitle } from '@/lib/usePageTitle';

export default function CyclingPage() {
  usePageTitle('Cycling');
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [loadDays, setLoadDays] = useState(90);
  const saveTimeoutRef = useRef<NodeJS.Timeout[]>([]);

  // ── Below-the-fold section visibility ───────────────────────────────────
  const powerCurveRef = useRef<HTMLDivElement>(null);
  const vo2maxRef = useRef<HTMLDivElement>(null);
  const decouplingRef = useRef<HTMLDivElement>(null);
  const ftpRef = useRef<HTMLDivElement>(null);
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sections = [
      { ref: powerCurveRef, name: 'powerCurve' },
      { ref: vo2maxRef, name: 'vo2max' },
      { ref: decouplingRef, name: 'decoupling' },
      { ref: ftpRef, name: 'ftp' },
    ];

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleSections((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const section = sections.find((s) => s.ref.current === entry.target);
            if (section) {
              if (entry.isIntersecting) {
                next.add(section.name);
              }
            }
          }
          // Only update if something changed
          if (next.size !== prev.size || [...next].some((s) => !prev.has(s))) {
            return next;
          }
          return prev;
        });
      },
      { rootMargin: '200px' } // Start loading 200px before visible
    );

    for (const { ref } of sections) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  // Cleanup timeouts on unmount (BUG-026)
  useEffect(() => {
    return () => {
      saveTimeoutRef.current.forEach(clearTimeout);
    };
  }, []);

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: profile, isLoading: profileLoading } = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
    staleTime: 300_000,
  });

  const { data: metrics } = useQuery<CyclingMetricsSummary>({
    queryKey: ['cycling-metrics'],
    queryFn: () => authFetch<CyclingMetricsSummary>('/api/v1/cycling/metrics-summary'),
    staleTime: 120_000,
  });

  const { data: trainingLoad, isLoading: loadLoading } = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', loadDays],
    queryFn: () => authFetch<TrainingLoadResponse>(`/api/v1/cycling/training-load?days=${loadDays}`),
    staleTime: 300_000,
  });

  const { data: powerCurve, isLoading: curveLoading } = useQuery<PowerCurveResponse>({
    queryKey: ['power-curve'],
    queryFn: () => authFetch<PowerCurveResponse>('/api/v1/cycling/power-curve?days=90'),
    enabled: visibleSections.has('powerCurve'),
    staleTime: 300_000,
  });

  const { data: powerZones, isLoading: zonesLoading } = useQuery<PowerZonesResponse>({
    queryKey: ['power-zones'],
    queryFn: () => authFetch<PowerZonesResponse>('/api/v1/cycling/power-zones?days=30'),
    enabled: !!profile?.ftp_watts,
    staleTime: 300_000,
  });

  const { data: powerVsHr } = useQuery<PowerVsHrResponse>({
    queryKey: ['power-vs-hr'],
    queryFn: () => authFetch<PowerVsHrResponse>('/api/v1/cycling/power-vs-hr?days=90'),
    enabled: visibleSections.has('powerCurve'),
    staleTime: 300_000,
  });

  const { data: chartTrainingLoad } = useQuery<ChartData>({
    queryKey: ['chart-training-load', loadDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/training_load?days=${loadDays}`),
    staleTime: 300_000,
  });

  const { data: chartPowerCurve } = useQuery<ChartData>({
    queryKey: ['chart-stream-power-curve', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/stream_power_curve?days=90'),
    enabled: visibleSections.has('powerCurve'),
    staleTime: 300_000,
  });

  const [comparisonDays, setComparisonDays] = useState(30);
  const comparisonBaselineDays = comparisonDays * 3;
  const { data: chartPowerComparison } = useQuery<ChartData>({
    queryKey: ['chart-power-comparison', comparisonDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/power_curve_comparison?days=${comparisonDays}&days_b=${comparisonBaselineDays}`),
    enabled: visibleSections.has('powerCurve'),
    staleTime: 300_000,
  });

  const { data: chartPowerZones } = useQuery<ChartData>({
    queryKey: ['chart-power-zones', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/power_zones?days=30'),
    enabled: !!profile?.ftp_watts,
    staleTime: 300_000,
  });

  const { data: chartDailyTss } = useQuery<ChartData>({
    queryKey: ['chart-daily-tss', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/daily_tss?days=30'),
    enabled: visibleSections.has('powerCurve'),
    staleTime: 120_000,
  });

  const { data: lifetimePBs } = useQuery<LifetimePBsResponse>({
    queryKey: ['lifetime-pbs'],
    queryFn: () => authFetch<LifetimePBsResponse>('/api/v1/cycling/lifetime-pbs'),
    enabled: visibleSections.has('ftp'),
    staleTime: 300_000,
  });

  const { data: ftpHistory } = useQuery<FtpHistoryEntry[]>({
    queryKey: ['ftp-history'],
    queryFn: () => authFetch<FtpHistoryEntry[]>('/api/v1/cycling/ftp-history'),
    enabled: visibleSections.has('ftp'),
    staleTime: 300_000,
  });

  const { data: chartFtpHistory } = useQuery<ChartData>({
    queryKey: ['chart-ftp-history'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/ftp_history'),
    enabled: visibleSections.has('ftp'),
    staleTime: 300_000,
  });

  const { data: hrZones } = useQuery<HrZonesResponse>({
    queryKey: ['hr-zones'],
    queryFn: () => authFetch<HrZonesResponse>('/api/v1/cycling/hr-zones?days=30'),
    enabled: !!profile?.lactate_threshold_hr,
    staleTime: 300_000,
  });

  const { data: chartHrZones } = useQuery<ChartData>({
    queryKey: ['chart-hr-zones', 30],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/hr_zone_distribution?days=30'),
    enabled: !!profile?.lactate_threshold_hr,
    staleTime: 300_000,
  });

  const { data: vo2max, isLoading: vo2maxLoading } = useQuery<Vo2maxResponse>({
    queryKey: ['vo2max'],
    queryFn: () => authFetch<Vo2maxResponse>('/api/v1/cycling/vo2max?days=90'),
    enabled: visibleSections.has('vo2max'),
    staleTime: 600_000,
  });

  const { data: vo2maxHistory } = useQuery<Vo2maxHistoryResponse>({
    queryKey: ['vo2max-history'],
    queryFn: () => authFetch<Vo2maxHistoryResponse>('/api/v1/cycling/vo2max-history?months=12'),
    enabled: visibleSections.has('vo2max'),
    staleTime: 600_000,
  });

  const { data: chartVo2maxTrend } = useQuery<ChartData>({
    queryKey: ['chart-vo2max-trend', 12],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/vo2max_trend?months=12'),
    enabled: visibleSections.has('vo2max'),
    staleTime: 600_000,
  });

  const { data: decoupling } = useQuery<DecouplingHistoryResponse>({
    queryKey: ['decoupling-history'],
    queryFn: () => authFetch<DecouplingHistoryResponse>('/api/v1/cycling/decoupling?days=90&min_duration=60'),
    enabled: visibleSections.has('decoupling'),
    staleTime: 600_000,
  });

  const { data: chartDecouplingTrend } = useQuery<ChartData>({
    queryKey: ['chart-decoupling-trend', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/decoupling_trend?days=90'),
    enabled: visibleSections.has('decoupling'),
    staleTime: 600_000,
  });

  const { data: chartWeightTrend } = useQuery<ChartData>({
    queryKey: ['chart-weight-trend', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/weight_trend?days=90'),
    enabled: visibleSections.has('powerCurve'),
    staleTime: 300_000,
  });

  // ── State ───────────────────────────────────────────────────────────────
  const [ftpEstimate, setFtpEstimate] = useState<FtpEstimate | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const [backfillFtpResult, setBackfillFtpResult] = useState<string | null>(null);

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
    onError: (error: Error) => {
      setSaveMessage(`Error: ${error.message}`);
      saveTimeoutRef.current.push(setTimeout(() => setSaveMessage(null), 5000));
    },
  });

  const estimateFtpMutation = useMutation({
    mutationFn: () => authFetch<FtpEstimate>('/api/v1/cycling/estimate-ftp?days=90', { method: 'POST' }),
    onSuccess: (data) => {
      setFtpEstimate(data);
    },
    onError: (error: Error) => {
      setFtpEstimate(null);
      setSaveMessage(`Error: ${error.message}`);
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
    onError: (error: Error) => {
      setSaveMessage(`Error: ${error.message}`);
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
    onError: (error: Error) => {
      setRecalcResult(`Error: ${error.message}`);
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
    },
    onError: (error: Error) => {
      setBackfillResult(`Error: ${error.message}`);
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
    onError: (error: Error) => {
      setBackfillFtpResult(`Error: ${error.message}`);
    },
  });

  // ── Loading state ───────────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Cycling</h1>
          <p className="text-muted">Power analysis, training load, and cycling metrics</p>
        </div>
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

  const currentLoad = trainingLoad?.data?.[trainingLoad.data.length - 1];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Cycling</h1>
        <p className="text-muted">Power analysis, training load, and cycling metrics</p>
      </div>

      {/* Profile Editor */}
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

      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
        <MetricCard
          label="FTP"
          value={metrics?.ftp_watts || metrics?.estimated_ftp}
          unit="W"
          color="text-yellow-400"
          subtext={metrics?.estimated_ftp && metrics?.ftp_watts !== metrics?.estimated_ftp
            ? `Est: ${metrics.estimated_ftp} W`
            : undefined}
          tooltip="Functional Threshold Power — the maximum power you can sustain for ~1 hour. Used to calculate TSS, IF, and power zones."
        />
        <MetricCard
          label="W/kg"
          value={metrics?.power_to_weight}
          unit="W/kg"
          color="text-positive"
          subtext="At FTP"
          benchmark={metrics?.ftp_wkg_benchmark}
          tooltip="Power-to-weight ratio at FTP. Higher is better for climbing. Elite: 5-6 W/kg, Good: 3.5-4.5 W/kg."
        />
        <MetricCard
          label="CTL (Fitness)"
          value={currentLoad?.ctl?.toFixed(0)}
          color="text-positive"
          subtext="42-day EWMA"
          benchmark={metrics?.ctl_benchmark}
          tooltip="Chronic Training Load — your long-term fitness, calculated as a 42-day exponentially weighted moving average of TSS. Higher = fitter. Typical range: 30-150."
        />
        <MetricCard
          label="TSB (Form)"
          value={currentLoad?.tsb?.toFixed(0)}
          color={
            (currentLoad?.tsb ?? 0) > 25
              ? 'text-positive'
              : (currentLoad?.tsb ?? 0) < -30
                ? 'text-warning'
                : 'text-blue-400'
          }
          subtext={
            (currentLoad?.tsb ?? 0) > 25
              ? 'Fresh — ready to race'
              : (currentLoad?.tsb ?? 0) < -30
                ? 'Fatigued — consider rest'
                : 'Neutral'
          }
          tooltip="Training Stress Balance (Form) = CTL − ATL. Positive = fresh/rested (good for racing). Negative = fatigued (good for building fitness). Sweet spot: -10 to +10."
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
      <TrainingLoadSection
        trainingLoad={trainingLoad}
        chartTrainingLoad={chartTrainingLoad}
        isLoading={loadLoading}
        loadDays={loadDays}
        setLoadDays={setLoadDays}
      />

      {/* Recalculate TSS Banner */}
      {profile?.ftp_watts && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">
                {(metrics?.recent_tss ?? 0) === 0 ? 'No TSS data found' : 'Recalculate TSS'}
              </p>
              <p className="text-xs text-muted mt-1">
                {(metrics?.recent_tss ?? 0) === 0
                  ? `You have FTP set (${profile.ftp_watts} W) but no TSS values. Click below to calculate TSS for all rides — needed for CTL/ATL/TSB.`
                  : `Recalculate TSS for all rides using your current FTP (${profile.ftp_watts} W). Use this after changing FTP.`
                }
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => recalculateTssMutation.mutate()}
                disabled={recalculateTssMutation.isPending}
                className="px-4 py-2 text-sm bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50 font-medium"
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white">
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
              className="px-4 py-2 text-sm bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50 font-medium"
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
          curveLoading={curveLoading}
          powerZones={powerZones}
          chartPowerZones={chartPowerZones}
          zonesLoading={zonesLoading}
          chartPowerComparison={chartPowerComparison}
          comparisonDays={comparisonDays}
          setComparisonDays={setComparisonDays}
          hrZones={hrZones}
          chartHrZones={chartHrZones}
          hasLthr={!!profile?.lactate_threshold_hr}
          powerVsHr={powerVsHr}
          chartDailyTss={chartDailyTss}
          chartWeightTrend={chartWeightTrend}
        />
      </div>

      {/* Decoupling Section */}
      <div ref={decouplingRef}>
        <DecouplingSection
          decoupling={decoupling}
          chartDecouplingTrend={chartDecouplingTrend}
        />
      </div>

      {/* FTP Section */}
      <div ref={ftpRef}>
        <FtpSection
          profile={profile}
          ftpHistory={ftpHistory}
          chartFtpHistory={chartFtpHistory}
          lifetimePBs={lifetimePBs}
          ftpEstimate={ftpEstimate}
          backfillFtpResult={backfillFtpResult}
          onBackfillFtp={() => backfillFtpHistoryMutation.mutate()}
          isBackfillingFtp={backfillFtpHistoryMutation.isPending}
        />
      </div>
    </div>
  );
}
