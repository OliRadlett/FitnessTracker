'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  CyclingProfile,
  CyclingProfileUpdate,
  CyclingMetricsSummary,
  TrainingLoadResponse,
  PowerCurveResponse,
  PowerZonesResponse,
  PowerVsHrResponse,
  ChartData,
  FtpEstimate,
  LifetimePBsResponse,
  FtpHistoryEntry,
  BackfillFtpResult,
} from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';

// ── Helper ──────────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  unit,
  color,
  subtext,
  tooltip,
}: {
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  color: string;
  subtext?: string;
  tooltip?: string;
}) {
  return (
    <Card className="group relative">
      <div className="flex items-center gap-1">
        <p className="text-sm text-muted mb-1">{label}</p>
        {tooltip && (
          <span className="text-muted/50 text-xs cursor-help mb-1" title={tooltip}>ⓘ</span>
        )}
      </div>
      <p className={`text-2xl font-bold ${color}`}>
        {value !== undefined && value !== null ? value : '—'}
        {unit && <span className="text-sm font-normal text-muted ml-1">{unit}</span>}
      </p>
      {subtext && <p className="text-xs text-muted mt-1">{subtext}</p>}
      {tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-xs text-slate-200 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-normal w-56 z-50 border border-surface-light/50">
          {tooltip}
        </div>
      )}
    </Card>
  );
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── Power Curve Component ───────────────────────────────────────────────────

function PowerCurveTable({ data, ftpWatts }: { data: PowerCurveResponse['data']; ftpWatts?: number | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-light/50">
            <th className="text-left py-2 text-muted font-medium">Duration</th>
            <th className="text-right py-2 text-muted font-medium">Best Power</th>
            <th className="text-right py-2 text-muted font-medium">% FTP</th>
            <th className="text-right py-2 text-muted font-medium">W/kg</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => {
            const power = point.best_power_watts;
            const pctFtp = power && ftpWatts ? ((power / ftpWatts) * 100).toFixed(0) : '—';
            // W/kg not applicable to power curve (no weight at that moment)
            return (
              <tr key={point.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                <td className="py-2 text-white font-medium">{point.duration_label}</td>
                <td className="py-2 text-right text-yellow-400 font-mono">
                  {power ? `${power} W` : '—'}
                </td>
                <td className="py-2 text-right text-muted font-mono">
                  {pctFtp !== '—' ? `${pctFtp}%` : '—'}
                </td>
                <td className="py-2 text-right text-muted font-mono">—</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Power Zones Component ───────────────────────────────────────────────────

function PowerZonesDisplay({ zones }: { zones: PowerZonesResponse['zones'] }) {
  const zoneColors: Record<string, string> = {
    Z1: '#94a3b8',
    Z2: '#3b82f6',
    Z3: '#22c55e',
    Z4: '#f59e0b',
    Z5: '#ef4444',
    Z6: '#dc2626',
    Z7: '#7c3aed',
  };

  return (
    <div className="space-y-2">
      {zones.map((zone) => (
        <div key={zone.zone} className="flex items-center gap-3">
          <div className="w-8 text-xs font-mono text-muted">{zone.zone}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm text-white">{zone.zone_name}</span>
              <span className="text-xs text-muted">
                {zone.lower_bound_watts}–{zone.upper_bound_watts} W
              </span>
            </div>
            <div className="h-5 bg-surface-light/30 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(zone.percentage, 1)}%`,
                  backgroundColor: zoneColors[zone.zone] || '#94a3b8',
                }}
              />
            </div>
          </div>
          <div className="w-16 text-right">
            <span className="text-sm font-mono text-white">{zone.percentage}%</span>
          </div>
          <div className="w-20 text-right">
            <span className="text-xs font-mono text-muted">{formatDuration(zone.time_seconds)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── FTP / Profile Editor ────────────────────────────────────────────────────

function ProfileEditor({
  profile,
  onSave,
  isSaving,
  onEstimateFtp,
  ftpEstimate,
  isEstimating,
  onAcceptEstimate,
  saveMessage,
}: {
  profile: CyclingProfile | undefined;
  onSave: (data: CyclingProfileUpdate) => void;
  isSaving: boolean;
  onEstimateFtp: () => void;
  ftpEstimate: FtpEstimate | null;
  isEstimating: boolean;
  onAcceptEstimate: () => void;
  saveMessage: string | null;
}) {
  const [ftp, setFtp] = useState('');
  const [weight, setWeight] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Sync local state when profile loads (once)
  React.useEffect(() => {
    if (profile && !initialized) {
      if (profile.ftp_watts) setFtp(profile.ftp_watts.toString());
      if (profile.weight_kg) setWeight(profile.weight_kg.toString());
      setInitialized(true);
    }
  }, [profile, initialized]);

  const handleAutoEstimateToggle = () => {
    if (!profile) return;
    onSave({ auto_estimate_ftp: !profile.auto_estimate_ftp });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycling Profile</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-xs text-muted mb-1">FTP (watts)</label>
          <input
            type="number"
            value={ftp}
            onChange={(e) => setFtp(e.target.value)}
            placeholder="e.g. 250"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Weight (kg)</label>
          <input
            type="number"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="e.g. 75"
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          onClick={() => {
            const payload: CyclingProfileUpdate = {};
            if (ftp) payload.ftp_watts = parseFloat(ftp);
            if (weight) payload.weight_kg = parseFloat(weight);
            onSave(payload);
          }}
          disabled={isSaving}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {saveMessage && (
        <p className={`text-xs mt-2 ${saveMessage.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
          {saveMessage}
        </p>
      )}

      {/* Auto FTP Estimation Toggle */}
      <div className="mt-4 pt-4 border-t border-surface-light/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Weekly Auto FTP Estimation</p>
            <p className="text-xs text-muted mt-0.5">
              Automatically estimates and updates your FTP every week from power data
            </p>
          </div>
          <button
            onClick={handleAutoEstimateToggle}
            disabled={isSaving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              profile?.auto_estimate_ftp ? 'bg-accent' : 'bg-surface-light'
            } ${isSaving ? 'opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                profile?.auto_estimate_ftp ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Manual Auto-estimate FTP */}
      <div className="mt-4 pt-4 border-t border-surface-light/30">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onAcceptEstimate}
            disabled={isEstimating}
            className="px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
          >
            {isEstimating ? 'Calculating...' : '⚡ Auto-Estimate & Save FTP'}
          </button>
          <span className="text-xs text-muted">
            Estimates from best 20-min power (×0.95) and saves automatically
          </span>
        </div>

        {/* Estimate result */}
        {ftpEstimate && (
          <div className={`p-3 rounded-lg border ${
            ftpEstimate.accepted
              ? 'bg-green-500/10 border-green-500/20'
              : 'bg-yellow-500/10 border-yellow-500/20'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-white">
                  Estimated FTP: <span className="text-yellow-400 font-mono text-lg">{ftpEstimate.estimated_ftp} W</span>
                </p>
                {ftpEstimate.source_method && (
                  <p className="text-xs text-muted mt-0.5">Method: {ftpEstimate.source_method}</p>
                )}
              </div>
              {!ftpEstimate.accepted && (
                <button
                  onClick={onAcceptEstimate}
                  className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors"
                >
                  ✓ Accept & Save
                </button>
              )}
              {ftpEstimate.accepted && (
                <span className="text-xs text-green-400 font-medium">✓ Saved as FTP</span>
              )}
            </div>

            {/* Best power breakdown */}
            {ftpEstimate.best_power_available && (
              <div className="flex flex-wrap gap-3 mt-2">
                {Object.entries(ftpEstimate.best_power_available).map(([duration, power]) => (
                  power ? (
                    <div key={duration} className="text-xs">
                      <span className="text-muted">{duration}: </span>
                      <span className="font-mono text-white">{power} W</span>
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function CyclingPage() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [loadDays, setLoadDays] = useState(90);

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: profile, isLoading: profileLoading } = useQuery<CyclingProfile>({
    queryKey: ['cycling-profile'],
    queryFn: () => authFetch<CyclingProfile>('/api/v1/cycling/profile'),
  });

  const { data: metrics } = useQuery<CyclingMetricsSummary>({
    queryKey: ['cycling-metrics'],
    queryFn: () => authFetch<CyclingMetricsSummary>('/api/v1/cycling/metrics-summary'),
  });

  const { data: trainingLoad, isLoading: loadLoading } = useQuery<TrainingLoadResponse>({
    queryKey: ['training-load', loadDays],
    queryFn: () => authFetch<TrainingLoadResponse>(`/api/v1/cycling/training-load?days=${loadDays}`),
  });

  const { data: powerCurve, isLoading: curveLoading } = useQuery<PowerCurveResponse>({
    queryKey: ['power-curve'],
    queryFn: () => authFetch<PowerCurveResponse>('/api/v1/cycling/power-curve?days=90'),
  });

  const { data: powerZones, isLoading: zonesLoading } = useQuery<PowerZonesResponse>({
    queryKey: ['power-zones'],
    queryFn: () => authFetch<PowerZonesResponse>('/api/v1/cycling/power-zones?days=30'),
    enabled: !!profile?.ftp_watts,
  });

  const { data: powerVsHr } = useQuery<PowerVsHrResponse>({
    queryKey: ['power-vs-hr'],
    queryFn: () => authFetch<PowerVsHrResponse>('/api/v1/cycling/power-vs-hr?days=90'),
  });

  const { data: chartTrainingLoad } = useQuery<ChartData>({
    queryKey: ['chart-training-load', loadDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/training_load?days=${loadDays}`),
  });

  const { data: chartPowerCurve } = useQuery<ChartData>({
    queryKey: ['chart-stream-power-curve'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/stream_power_curve?days=90'),
  });

  const { data: chartPowerZones } = useQuery<ChartData>({
    queryKey: ['chart-power-zones'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/power_zones?days=30'),
    enabled: !!profile?.ftp_watts,
  });

  const { data: chartDailyTss } = useQuery<ChartData>({
    queryKey: ['chart-daily-tss'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/daily_tss?days=30'),
  });

  const { data: lifetimePBs } = useQuery<LifetimePBsResponse>({
    queryKey: ['lifetime-pbs'],
    queryFn: () => authFetch<LifetimePBsResponse>('/api/v1/cycling/lifetime-pbs'),
  });

  const { data: ftpHistory } = useQuery<FtpHistoryEntry[]>({
    queryKey: ['ftp-history'],
    queryFn: () => authFetch<FtpHistoryEntry[]>('/api/v1/cycling/ftp-history'),
  });

  const { data: chartFtpHistory } = useQuery<ChartData>({
    queryKey: ['chart-ftp-history'],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/ftp_history'),
  });

  // ── FTP Estimate state ──────────────────────────────────────────────────
  const [ftpEstimate, setFtpEstimate] = useState<FtpEstimate | null>(null);

  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage(`Error: ${error.message}`);
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  const estimateFtpMutation = useMutation({
    mutationFn: () => authFetch<FtpEstimate>('/api/v1/cycling/estimate-ftp?days=90', { method: 'POST' }),
    onSuccess: (data) => {
      setFtpEstimate(data);
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
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage(`Error: ${error.message}`);
      setTimeout(() => setSaveMessage(null), 5000);
    },
  });

  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const [backfillFtpResult, setBackfillFtpResult] = useState<string | null>(null);

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
      '/api/v1/cycling/backfill-streams?days=90&limit=30',
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

  // ── Power vs HR chart data ──────────────────────────────────────────────
  const powerVsHrChart: ChartData | null = powerVsHr?.data?.length
    ? {
        chart_type: 'scatter',
        title: 'Power vs Heart Rate',
        labels: powerVsHr.data.map((p) => String(p.power)),
        series: [
          {
            name: 'Rides',
            data: powerVsHr.data.map((p) => p.heart_rate),
          },
        ],
        x_label: 'Power (W)',
        y_label: 'Heart Rate (bpm)',
      }
    : null;

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
          color="text-green-400"
          subtext="At FTP"
          tooltip="Power-to-weight ratio at FTP. Higher is better for climbing. Elite: 5-6 W/kg, Good: 3.5-4.5 W/kg."
        />
        <MetricCard
          label="CTL (Fitness)"
          value={currentLoad?.ctl?.toFixed(0)}
          color="text-positive"
          subtext="42-day EWMA"
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

      {/* Recent Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="7d TSS" value={metrics?.recent_tss?.toFixed(0)} color="text-blue-400" tooltip="Training Stress Score — a composite measure of ride difficulty based on intensity and duration. 100 TSS = 1 hour at FTP." />
        <MetricCard label="7d Rides" value={metrics?.recent_rides} color="text-purple-400" tooltip="Number of cycling activities in the last 7 days." />
        <MetricCard label="7d Distance" value={metrics?.recent_distance_km} unit="km" color="text-slate-300" tooltip="Total distance covered in the last 7 days." />
        <MetricCard label="7d Time" value={metrics?.recent_time_hours} unit="hrs" color="text-slate-300" tooltip="Total time on the bike in the last 7 days." />
        <MetricCard label="7d Elevation" value={metrics?.recent_elevation_m?.toFixed(0)} unit="m" color="text-slate-300" tooltip="Total elevation gain in the last 7 days." />
      </div>

      {/* IF & VI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Intensity Factor"
          value={metrics?.avg_intensity_factor?.toFixed(3)}
          color="text-yellow-400"
          subtext="IF = NP / FTP (7d avg)"
          tooltip="Intensity Factor = Normalized Power ÷ FTP. Measures how hard a ride was relative to your max. 0.75 = endurance, 0.85 = tempo, 0.95 = threshold, 1.05+ = VO2max."
        />
        <MetricCard
          label="Avg Variability Index"
          value={metrics?.avg_variability_index?.toFixed(3)}
          color="text-blue-400"
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

      {/* Training Load Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>Training Load — CTL / ATL / TSB</CardTitle>
            <div className="flex gap-2">
              {[30, 60, 90, 180].map((d) => (
                <button
                  key={d}
                  onClick={() => setLoadDays(d)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    loadDays === d
                      ? 'bg-accent/20 text-accent border-accent/30'
                      : 'text-muted border-surface-light hover:border-accent/30'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        {loadLoading ? (
          <div className="h-80 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
          </div>
        ) : chartTrainingLoad ? (
          <Chart data={chartTrainingLoad} height={320} />
        ) : (
          <div className="h-80 flex items-center justify-center text-muted">
            No training load data available. Set your FTP and sync activities.
          </div>
        )}
      </Card>

      {/* Recalculate TSS Banner — shown when FTP is set */}
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
            <p className="text-xs text-green-400 mt-2">{recalcResult}</p>
          )}
        </Card>
      )}

      {/* Fetch Streams Banner — shown when no stream data exists */}
      {(() => {
        const hasStreamData = powerCurve?.data?.some(p => p.best_power_watts != null);
        return !hasStreamData && !curveLoading;
      })() && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">No power stream data found</p>
              <p className="text-xs text-muted mt-1">
                Your cycling activities need per-second power data from Strava for power curves, zones, and FTP estimation.
                Click below to fetch streams for your last 90 days of rides.
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
            <p className="text-xs text-green-400 mt-2">{backfillResult}</p>
          )}
        </Card>
      )}

      {/* Power Curve + Power Zones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Power Curve */}
        <Card>
          <CardHeader>
            <CardTitle>Power Curve (90 days)</CardTitle>
          </CardHeader>
          {curveLoading ? (
            <div className="h-60 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
            </div>
          ) : powerCurve?.data?.some(p => p.best_power_watts != null) ? (
            <>
              {chartPowerCurve && <Chart data={chartPowerCurve} height={280} />}
              <div className="mt-4">
                <PowerCurveTable data={powerCurve.data} ftpWatts={powerCurve.ftp_watts} />
              </div>
            </>
          ) : (
            <div className="h-60 flex flex-col items-center justify-center text-muted text-sm">
              <p>No power data yet</p>
              <p className="text-xs mt-1">Fetch streams above to populate this chart</p>
            </div>
          )}
        </Card>

        {/* Power Zones */}
        <Card>
          <CardHeader>
            <CardTitle>Power Zones (30 days)</CardTitle>
          </CardHeader>
          {zonesLoading ? (
            <div className="h-60 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
            </div>
          ) : powerZones?.zones?.length ? (
            <>
              <div className="mb-4">
                <p className="text-sm text-muted">
                  Based on FTP: <span className="text-yellow-400 font-mono">{powerZones.ftp_watts} W</span>
                </p>
              </div>
              <PowerZonesDisplay zones={powerZones.zones} />
              {chartPowerZones && <div className="mt-4"><Chart data={chartPowerZones} height={220} /></div>}
            </>
          ) : (
            <div className="h-60 flex items-center justify-center text-muted">
              Set your FTP and sync activities with power stream data to see zone distribution.
            </div>
          )}
        </Card>
      </div>

      {/* Daily TSS + Power vs HR */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily TSS */}
        <Card>
          <CardHeader>
            <CardTitle>Daily TSS (30 days)</CardTitle>
          </CardHeader>
          {chartDailyTss ? (
            <Chart data={chartDailyTss} height={280} />
          ) : (
            <div className="h-60 flex items-center justify-center text-muted">
              No TSS data available
            </div>
          )}
        </Card>

        {/* Power vs HR */}
        <Card>
          <CardHeader>
            <CardTitle>Power vs Heart Rate (90 days)</CardTitle>
          </CardHeader>
          {powerVsHrChart ? (
            <Chart data={powerVsHrChart} height={280} />
          ) : (
            <div className="h-60 flex items-center justify-center text-muted">
              No power/HR data available
            </div>
          )}
        </Card>
      </div>

      {/* FTP History Chart + Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>📈 FTP Progression</CardTitle>
            <button
              onClick={() => backfillFtpHistoryMutation.mutate()}
              disabled={backfillFtpHistoryMutation.isPending}
              className="px-3 py-1.5 text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/30 transition-colors disabled:opacity-50 font-medium"
            >
              {backfillFtpHistoryMutation.isPending ? 'Backfilling...' : '📊 Backfill FTP History'}
            </button>
          </div>
        </CardHeader>
        {backfillFtpResult && (
          <p className={`text-xs mb-3 ${backfillFtpResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {backfillFtpResult}
          </p>
        )}
        <div className="mb-4 text-sm text-muted">
          Current FTP: <span className="text-yellow-400 font-mono font-bold">{profile?.ftp_watts ?? '—'} W</span>
          {profile?.weight_kg && profile?.ftp_watts && (
            <span className="ml-4">
              W/kg: <span className="text-green-400 font-mono font-bold">
                {(profile.ftp_watts / profile.weight_kg).toFixed(2)}
              </span>
            </span>
          )}
        </div>
        {chartFtpHistory && chartFtpHistory.labels.length > 0 ? (
          <Chart data={chartFtpHistory} height={250} />
        ) : (
          <div className="h-40 flex items-center justify-center text-muted text-sm">
            No FTP history yet. Use "Auto-Estimate & Save FTP" or manually set your FTP to start tracking.
          </div>
        )}
        {ftpHistory && ftpHistory.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-light/50">
                  <th className="text-left py-2 text-muted font-medium">Date</th>
                  <th className="text-right py-2 text-muted font-medium">FTP (W)</th>
                  <th className="text-left py-2 text-muted font-medium">Source</th>
                  <th className="text-left py-2 text-muted font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ftpHistory.map((entry) => (
                  <tr key={entry.id} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                    <td className="py-2 text-white">{new Date(entry.effective_date).toLocaleDateString()}</td>
                    <td className="py-2 text-right text-yellow-400 font-mono">{entry.ftp_watts} W</td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        entry.source === 'estimated' ? 'bg-blue-500/20 text-blue-400' : 'bg-surface-light text-muted'
                      }`}>
                        {entry.source}
                      </span>
                    </td>
                    <td className="py-2 text-muted text-xs">{entry.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lifetime Power PBs */}
      {lifetimePBs && lifetimePBs.pbs.some(p => p.best_power_watts != null) && (
        <Card>
          <CardHeader>
            <CardTitle>🏆 Lifetime Power PBs</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-light/50">
                  <th className="text-left py-2 text-muted font-medium">Duration</th>
                  <th className="text-right py-2 text-muted font-medium">Best Power</th>
                  {profile?.weight_kg && (
                    <th className="text-right py-2 text-muted font-medium">W/kg</th>
                  )}
                  {lifetimePBs.ftp_watts && (
                    <th className="text-right py-2 text-muted font-medium">% FTP</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {lifetimePBs.pbs.filter(p => p.best_power_watts != null).map((pb) => (
                  <tr key={pb.duration_label} className="border-b border-surface-light/20 hover:bg-surface-light/20">
                    <td className="py-2 text-white font-medium">{pb.duration_label}</td>
                    <td className="py-2 text-right text-yellow-400 font-mono">
                      {pb.best_power_watts} W
                    </td>
                    {profile?.weight_kg && (
                      <td className="py-2 text-right text-green-400 font-mono">
                        {(pb.best_power_watts! / profile.weight_kg).toFixed(2)}
                      </td>
                    )}
                    {lifetimePBs.ftp_watts && (
                      <td className="py-2 text-right text-muted font-mono">
                        {pb.pct_ftp ?? '—'}%
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
