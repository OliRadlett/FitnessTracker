import type {
  ChartData,
  Connection,
  HealthAlert,
  HealthAnalysisResult,
  LlmAnalysis,
  OptimalBedtimeResponse,
  ReadinessResponse,
  RespiratoryRateResponse,
  SleepConsistencyResponse,
  SleepDebtResponse,
  WeightHistoryResponse,
} from '@/lib/api';

export type HealthTab = 'now' | 'trends' | 'history';

export interface HealthCheckResponse {
  checked_at: string;
  analysis_results: HealthAnalysisResult[];
}

export interface HealthViewModel {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  isStale: boolean;
  isAttention: boolean;
  asOf: string;
  syncAt: string | null;
  connectionsLoading: boolean;
  connectionsError: boolean;
  whoopConnected: boolean;
  readiness: ReadinessResponse | null;
  sleep: {
    consistency: SleepConsistencyResponse;
    debt: SleepDebtResponse;
    bedtime: OptimalBedtimeResponse;
  } | null;
  alerts: HealthAlert[];
  analysis: HealthAnalysisResult[] | null;
  analysisDate: string | null;
  checkLoading: boolean;
  respiratory: RespiratoryRateResponse | null;
  ai: LlmAnalysis | null;
  aiLoading: boolean;
  weight: WeightHistoryResponse | null;
  connections: Connection[];
  charts: Record<string, ChartData | undefined>;
}

export const HEALTH_SIGNAL_LABELS: Record<string, string> = {
  overtraining: 'Overtraining risk',
  injury_risk: 'Injury risk',
  illness_risk: 'Illness risk',
  performance_decline: 'Performance decline',
  sleep_consistency: 'Sleep consistency',
  resting_hr_elevation: 'Resting HR elevation',
};

export const EMPTY_CHART: ChartData = {
  chart_type: 'line',
  title: '',
  labels: [],
  series: [],
};

export interface Driver {
  key: string;
  label: string;
  value: string;
  unit: string;
  delta: string;
  deltaLabel: string;
  good: boolean | null;
  tone: 'positive' | 'caution' | 'warning' | 'muted';
  spark: (number | null)[];
  note: string;
}

export function latestSeriesValue(chart: ChartData | undefined, name: string): number | null {
  const series = chart?.series.find((s) => s.name === name);
  if (!series) return null;
  for (let i = series.data.length - 1; i >= 0; i -= 1) {
    if (series.data[i] != null) return series.data[i] as number;
  }
  return null;
}

export function seriesStats(
  chart: ChartData | undefined,
  name: string,
  days = 30,
): { avg: number | null; sd: number | null; last: number | null } {
  if (!chart) return { avg: null, sd: null, last: null };
  const series = chart.series.find((s) => s.name === name);
  if (!series) return { avg: null, sd: null, last: null };
  const values = series.data.filter((v): v is number => v != null).slice(-days);
  if (values.length === 0) return { avg: null, sd: null, last: null };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  return { avg, sd: Math.sqrt(variance), last: values[values.length - 1] ?? null };
}

export function buildDrivers(vm: HealthViewModel): Driver[] {
  const hrv = seriesStats(vm.charts.hrv_trend_detailed, 'Daily HRV', 30);
  const rhr = seriesStats(vm.charts.resting_hr_trend, 'Resting HR', 30);
  const recovery = seriesStats(vm.charts.whoop_recovery_trend, 'Recovery', 7);
  const hrvNow = vm.readiness?.hrv_ms ?? null;
  const rhrNow = vm.readiness?.resting_hr ?? null;
  const sleepNow = latestSeriesValue(vm.charts.sleep_quality_trend, 'Sleep Hours');
  const sleepAvg = vm.sleep?.debt.avg_sleep_hours ?? null;
  const strainNow = latestSeriesValue(vm.charts.whoop_strain_trend, 'Strain');

  const hrvDelta = hrvNow != null && hrv.avg != null ? hrvNow - hrv.avg : null;
  const rhrDelta = rhrNow != null && rhr.avg != null ? rhrNow - rhr.avg : null;
  const sleepDelta = sleepNow != null && sleepAvg != null ? sleepNow - sleepAvg : null;

  return [
    {
      key: 'hrv',
      label: 'HRV',
      value: hrvNow != null ? hrvNow.toFixed(0) : '—',
      unit: 'ms',
      delta: hrvDelta != null ? `${hrvDelta >= 0 ? '+' : ''}${hrvDelta.toFixed(1)} ms` : '—',
      deltaLabel: 'vs 30d avg',
      good: hrvDelta == null ? null : hrvDelta >= 0,
      tone: hrvDelta == null ? 'muted' : hrvDelta < -5 ? 'caution' : 'positive',
      spark: vm.charts.hrv_trend_detailed?.series.find((s) => s.name === 'Daily HRV')?.data.slice(-30) ?? [],
      note: hrv.avg != null ? `30d avg ${hrv.avg.toFixed(0)} ms` : 'No baseline',
    },
    {
      key: 'rhr',
      label: 'Resting HR',
      value: rhrNow != null ? rhrNow.toFixed(0) : '—',
      unit: 'bpm',
      delta: rhrDelta != null ? `${rhrDelta >= 0 ? '+' : ''}${rhrDelta.toFixed(1)} bpm` : '—',
      deltaLabel: 'vs 30d avg',
      good: rhrDelta == null ? null : rhrDelta <= 0,
      tone: rhrDelta == null ? 'muted' : rhrDelta > 4 ? 'caution' : 'positive',
      spark: vm.charts.resting_hr_trend?.series.find((s) => s.name === 'Resting HR')?.data.slice(-30) ?? [],
      note: rhr.avg != null ? `30d avg ${rhr.avg.toFixed(0)} bpm` : 'No baseline',
    },
    {
      key: 'sleep',
      label: 'Sleep',
      value: sleepNow != null ? sleepNow.toFixed(1) : '—',
      unit: 'h',
      delta: sleepDelta != null ? `${sleepDelta >= 0 ? '+' : ''}${sleepDelta.toFixed(1)} h` : '—',
      deltaLabel: 'vs 7d avg',
      good: sleepDelta == null ? null : sleepDelta >= 0,
      tone: sleepDelta == null ? 'muted' : sleepNow != null && sleepNow < 6.5 ? 'warning' : sleepNow != null && sleepNow < 7.5 ? 'caution' : 'positive',
      spark: vm.charts.sleep_quality_trend?.series.find((s) => s.name === 'Sleep Hours')?.data.slice(-7) ?? [],
      note: vm.sleep ? `Target ${vm.sleep.debt.target_hours.toFixed(0)}h · debt ${vm.sleep.debt.debt_hours.toFixed(1)}h` : 'No sleep data',
    },
    {
      key: 'strain',
      label: 'Strain',
      value: strainNow != null ? strainNow.toFixed(1) : '—',
      unit: '',
      delta: '—',
      deltaLabel: '0–21',
      good: null,
      tone: 'muted',
      spark: vm.charts.whoop_strain_trend?.series.find((s) => s.name === 'Strain')?.data.slice(-30) ?? [],
      note: 'Whoop strain',
    },
    {
      key: 'recovery',
      label: '7d recovery',
      value: recovery.avg != null ? recovery.avg.toFixed(0) : '—',
      unit: '%',
      delta: vm.readiness?.recovery_score != null && recovery.avg != null
        ? `${vm.readiness.recovery_score - recovery.avg >= 0 ? '+' : ''}${(vm.readiness.recovery_score - recovery.avg).toFixed(0)} pts`
        : '—',
      deltaLabel: 'today vs 7d',
      good: null,
      tone: 'muted',
      spark: vm.charts.whoop_recovery_trend?.series.find((s) => s.name === 'Recovery')?.data.slice(-30) ?? [],
      note: '7-day average',
    },
  ];
}

export function parseInsight(text: string): { text: string; n: number | null; trusted: boolean } {
  const match = text.match(/n=(\d+)/);
  const n = match ? Number(match[1]) : null;
  return { text, n, trusted: n == null ? true : n >= 10 };
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function ageDays(iso: string | null | undefined, asOf: string): number | null {
  if (!iso) return null;
  const a = new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${asOf.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
