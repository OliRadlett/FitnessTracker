'use client';

// Feature 3 / B-15 — Analytics page: deterministic observed coefficients
// from the user's own history (associations, never causation). Data comes
// from the nightly compute (AthleteInsight rows); Recompute forces a refresh.

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CombinedLoadChart } from '@/components/charts/CombinedLoadChart';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { usePageTitle } from '@/lib/usePageTitle';
import { PageHeader } from '@/components/ui/PageHeader';
import { TimeRangePicker } from '@/components/dashboard/TimeRangePicker';
import { TimeRangeProvider, timeRangeDays, useTimeRange } from '@/lib/time-range';
import { MOTION } from '@/components/motion/tokens';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
import { relativeTime } from '@/lib/analysisRenderer';
import { useMetricProjection } from '@/lib/projection';
import { whatIfWeeks } from '@/lib/prescription';
import type { LlmAnalysis, Connection } from '@/lib/api';
import { deriveStaleProviders } from '@/lib/athlete';
import { getActiveLocale } from '@/lib/utils';

interface AthleteInsight {
  id: string;
  insight_type: string;
  period: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null;
  sample_size: number;
  confidence: 'collecting' | 'low' | 'medium' | 'high';
}

const META: Record<string, { title: string; icon: string; blurb: string }> = {
  recovery_cost: {
    title: 'Recovery Cost per Session',
    icon: '💸',
    blurb: 'HRV / recovery change in the 48h after each session vs your 14-day baseline.',
  },
  sleep_performance: {
    title: 'Sleep → Performance',
    icon: '😴',
    blurb: 'Power output (NP/FTP) and RPE by prior-night sleep band.',
  },
  load_readiness: {
    title: 'Load Split vs Readiness',
    icon: '⚖️',
    blurb: 'Weekly strength-vs-endurance share against that week’s recovery.',
  },
  power_norms: {
    title: 'Context Power Norms',
    icon: '🌡️',
    blurb: 'Your NP/FTP by temperature band, from weather-tagged rides.',
  },
  pr_clustering: {
    title: 'PR Conditions',
    icon: '🏅',
    blurb: 'Share of PRs set after above-baseline recovery markers.',
  },
  tsb_peak: {
    title: 'Personal TSB Peak Band',
    icon: '📈',
    blurb: 'Where your best relative power shows up on the freshness scale.',
  },
};

const CONFIDENCE_VARIANT: Record<AthleteInsight['confidence'], 'positive' | 'warning' | undefined> = {
  high: 'positive',
  medium: 'positive',
  low: 'warning',
  collecting: undefined,
};

function KVTable({ rows, columns }: { rows: Record<string, React.ReactNode>[]; columns: string[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-light/50">
            {columns.map((c) => (
              <th key={c} className="text-left py-1.5 pr-3 text-muted font-medium text-xs">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-surface-light/20">
              {columns.map((c) => (
                <td key={c} className="py-1.5 pr-3 text-foreground text-xs">{r[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsightBody({ insight }: { insight: AthleteInsight }) {
  const d = insight.data ?? {};
  switch (insight.insight_type) {
    case 'recovery_cost':
      return (
        <KVTable
          columns={['Bucket', 'n', 'ΔHRV', 'ΔRecovery']}
          rows={(d.buckets ?? []).map((b: { bucket: string; n: number; avg_hrv_delta: number | null; avg_recovery_delta: number | null }) => ({
            Bucket: b.bucket,
            n: b.n,
            'ΔHRV': b.avg_hrv_delta != null ? `${b.avg_hrv_delta > 0 ? '+' : ''}${b.avg_hrv_delta}` : '—',
            'ΔRecovery': b.avg_recovery_delta != null ? `${b.avg_recovery_delta > 0 ? '+' : ''}${b.avg_recovery_delta}` : '—',
          }))}
        />
      );
    case 'sleep_performance':
      return (
        <>
          <KVTable
            columns={['Sleep', 'n', 'NP/FTP', 'RPE']}
            rows={(d.bands ?? []).map((b: { band: string; n: number; avg_np_ftp: number | null; avg_rpe: number | null }) => ({
              Sleep: b.band,
              n: b.n,
              'NP/FTP': b.avg_np_ftp?.toFixed(3) ?? '—',
              RPE: b.avg_rpe?.toFixed(1) ?? '—',
            }))}
          />
          {d.pearson_sleep_np_ftp != null && (
            <p className="text-xs text-muted mt-2">Sleep↔power correlation r = {d.pearson_sleep_np_ftp}</p>
          )}
        </>
      );
    case 'load_readiness':
      return (
        <>
          <KVTable
            columns={['Week', 'Strength %', 'Recovery']}
            rows={(d.weeks ?? []).slice(-8).map((w: { week_start: string; strength_share: number; avg_recovery: number | null }) => ({
              Week: w.week_start,
              'Strength %': `${Math.round(w.strength_share * 100)}%`,
              Recovery: w.avg_recovery?.toFixed(0) ?? '—',
            }))}
          />
          {d.pearson_strength_share_recovery != null && (
            <p className="text-xs text-muted mt-2">Strength-share↔recovery r = {d.pearson_strength_share_recovery}</p>
          )}
        </>
      );
    case 'power_norms':
      return (
        <KVTable
          columns={['Temp', 'n', 'NP/FTP']}
          rows={(d.bands ?? []).map((b: { band: string; n: number; avg_np_ftp: number }) => ({
            Temp: `${b.band}${d.best_band === b.band ? ' ⭐' : ''}`,
            n: b.n,
            'NP/FTP': b.avg_np_ftp.toFixed(3),
          }))}
        />
      );
    case 'pr_clustering': {
      const ab = d.above_baseline ?? {};
      const order = ['hrv', 'recovery', 'sleep', 'tsb'];
      return (
        <>
          <p className="text-sm text-foreground mb-2">{d.n_prs ?? 0} PRs analyzed</p>
          <KVTable
            columns={['Marker', 'Above baseline']}
            rows={order
              .filter((k) => ab[k])
              .map((k) => ({
                Marker: k.toUpperCase(),
                'Above baseline': ab[k].of ? `${ab[k].n}/${ab[k].of}` : '—',
              }))}
          />
        </>
      );
    }
    case 'tsb_peak':
      return (
        <KVTable
          columns={['TSB band', 'n', 'NP/FTP']}
          rows={(d.bands ?? []).map((b: { band: string; n: number; avg_np_ftp: number }) => ({
            'TSB band': `${b.band}${d.peak_band === b.band ? ' ⭐' : ''}`,
            n: b.n,
            'NP/FTP': b.avg_np_ftp.toFixed(3),
          }))}
        />
      );
    default:
      return null;
  }
}

export default function AnalyticsPage() {
  /* The shared REVIEW time-range (ui-redesign-v2 §2.1) must wrap every
     consumer — including the picker itself — so the page body lives in an
     inner component under the provider (dashboard pattern). */
  return (
    <TimeRangeProvider>
      <AnalyticsPageInner />
    </TimeRangeProvider>
  );
}

/* Pull-to-sync (ui-redesign-v2 section 3.5 REVIEW signature). A touch
   pull-down from the very top of the page (scrollY at 0, 64px+) refetches
   the page queries through the SAME React Query keys (refetchQueries with
   type active — no new endpoints, no computation changes) with a small
   release-to-sync indicator. Static show/hide under
   prefers-reduced-motion; dark tokens; 12px floor; the pill is
   non-interactive status text. Desktop/keyboard fallback is the existing
   page controls. */
const PULL_SYNC_THRESHOLD_PX = 64;
type PullSyncPhase = 'idle' | 'pull' | 'ready' | 'syncing';

function usePullToSync(onSync: () => Promise<unknown>): PullSyncPhase {
  const startYRef = React.useRef<number | null>(null);
  const phaseRef = React.useRef<PullSyncPhase>('idle');
  const [phase, setPhase] = React.useState<PullSyncPhase>('idle');
  const onSyncRef = React.useRef(onSync);

  React.useEffect(() => {
    onSyncRef.current = onSync;
  });

  React.useEffect(() => {
    const setBoth = (p: PullSyncPhase) => {
      phaseRef.current = p;
      setPhase(p);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const startY = startYRef.current;
      if (startY == null || e.touches.length !== 1 || window.scrollY > 0) return;
      if (phaseRef.current === 'syncing') return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        setBoth('idle');
        return;
      }
      setBoth(dy >= PULL_SYNC_THRESHOLD_PX ? 'ready' : 'pull');
    };
    const onTouchEnd = () => {
      startYRef.current = null;
      if (phaseRef.current !== 'ready') {
        if (phaseRef.current !== 'syncing') setBoth('idle');
        return;
      }
      setBoth('syncing');
      void Promise.resolve()
        .then(() => onSyncRef.current())
        .catch(() => undefined)
        .finally(() => setBoth('idle'));
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return phase;
}

function PullSyncStatus({ phase, label }: { phase: PullSyncPhase; label: string }) {
  const reduceMotion = usePrefersReducedMotion();
  if (phase === 'idle') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex justify-center"
      style={
        reduceMotion
          ? undefined
          : { transition: `opacity ${MOTION.durationFastMs}ms ${MOTION.easeOut}` }
      }
    >
      <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-surface-light/50 bg-surface px-4 py-1 text-xs text-muted">
        <span aria-hidden="true">{phase === 'syncing' ? '⟳' : phase === 'ready' ? '↑' : '↓'}</span>
        {phase === 'syncing' ? 'Syncing…' : phase === 'ready' ? 'Release to sync' : 'Pull to sync'}
      </span>
    </div>
  );
}

function AnalyticsPageInner() {
  usePageTitle('Analytics');
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const queryKey = ['analytics', 'insights'] as const;

  /* Pull-to-sync refetch (section 3.5): same React Query keys, no new fetches. */
  const syncPage = React.useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  );
  const pullPhase = usePullToSync(syncPage);

  /* ── Shared REVIEW time-range (ui-redesign-v2 §2.1): one picker drives the
     analytics load chart together with the other REVIEW surfaces. Day spans
     are clamped to the backend `?days=` cap (≤365) inside timeRangeDays.
     Display only — no computation changes (docs/algorithms.md authoritative).
     Insight rows, explanations, season overview, and the What-If lab carry no
     chart window and keep their existing queries. ───────────────────────── */
  const { start: rangeStart, end: rangeEnd } = useTimeRange();
  const chartDays = timeRangeDays(rangeStart, rangeEnd);

  // Degraded state for the load chart — same ['connections'] cache entry as
  // the LoadStrip slots elsewhere (display only, no recompute).
  const { data: connections } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 300_000,
    enabled: !!token,
  });
  const chartStale = deriveStaleProviders(connections).length > 0;

  const { data: insights, isLoading, isError: insightsError, refetch: refetchInsights, dataUpdatedAt } = useQuery<AthleteInsight[]>({
    queryKey,
    queryFn: () => authFetch<AthleteInsight[]>('/api/v1/analytics/insights'),
    staleTime: 60_000,
    enabled: !!token,
  });

  const recompute = useMutation({
    mutationFn: () => authFetch<AthleteInsight[]>('/api/v1/analytics/recompute', { method: 'POST' }),
    onSuccess: (rows) => queryClient.setQueryData(queryKey, rows),
  });

  // Long-page split (1.8) — tabs lazy-mount heavy sections.
  const [tab, setTab] = React.useState<'insights' | 'season' | 'load'>('insights');

  return (
    <div className="space-y-6">
      <PullSyncStatus phase={pullPhase} label="Analytics sync status" />
      <PageHeader
        title="Analytics"
        subtitle={
          <>
            Observed patterns in your own data — associations, not advice. Recomputed nightly.
            {dataUpdatedAt > 0 && ` · Fetched ${relativeTime(new Date(dataUpdatedAt).toISOString())}`}
          </>
        }
        actions={
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white font-medium hover:bg-accent/80 disabled:opacity-50"
          >
            {recompute.isPending ? 'Computing…' : '↻ Recompute now'}
          </button>
        }
      />

      {recompute.isError && (
        <ErrorState
          variant="inline"
          show
          message="Recompute failed — try again shortly."
          onRetry={() => recompute.mutate()}
        />
      )}

      {/* Shared REVIEW chart range (ui-redesign-v2 §2.1) — one picker drives
          the analytics load chart together with the other REVIEW surfaces. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <TimeRangePicker />
      </div>

      <SegmentedControl
        ariaLabel="Analytics sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'insights', label: 'Insights' },
          { value: 'season', label: 'Season' },
          { value: 'load', label: 'Load & Lab' },
        ]}
      />

      {tab === 'insights' && (
      <ErrorState
        variant="inline"
        show={insightsError}
        message="Insights failed to load."
        onRetry={() => refetchInsights()}
      />
      )}
      {tab === 'insights' && (
      isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonMetric key={i} />)}
        </div>
      ) : insightsError ? null : !insights || insights.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No insights yet"
          description="Train for a few weeks, then hit Recompute — patterns need samples."
          action={{ label: '↻ Recompute now', onClick: () => recompute.mutate() }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {insights.map((insight) => {
            const meta = META[insight.insight_type] ?? {
              title: insight.insight_type,
              icon: '📊',
              blurb: '',
            };
            return (
              <Card key={insight.id}>
                <CardHeader>
                  <div className="flex items-center justify-between w-full gap-2">
                    <CardTitle>{meta.icon} {meta.title}</CardTitle>
                    <Badge variant={CONFIDENCE_VARIANT[insight.confidence]}>
                      {insight.confidence === 'collecting'
                        ? `collecting data (${insight.sample_size})`
                        : `${insight.confidence} · n=${insight.sample_size}`}
                    </Badge>
                  </div>
                </CardHeader>
                <p className="text-xs text-muted mb-3">{meta.blurb}</p>
                {insight.confidence === 'collecting' && (insight.data == null ||
                  Object.values(insight.data).every(
                    (v) => v == null || (Array.isArray(v) && v.length === 0),
                  )) ? (
                  <p className="text-xs text-muted">Not enough samples yet — keep training.</p>
                ) : (
                  <InsightBody insight={insight} />
                )}
                <ExplainInsight insightType={insight.insight_type} />
              </Card>
            );
          })}
        </div>
      ))}

      {/* B-18 season overview — big-picture AI brief over all domains */}
      {tab === 'season' && <SeasonOverview />}

      {/* B-31 unified load — cycling TSS + lifting estimates on one axis.
          Window comes from the shared REVIEW time-range (range in query key
          via the `days` prop — same cache entry as the lifting tab only at
          the 90D default). */}
      {tab === 'load' && <CombinedLoadChart days={chartDays} stale={chartStale} />}

      {/* B-17 What-If Lab — target timelines at current/half/double slope */}
      {tab === 'load' && <WhatIfLab />}
    </div>
  );
}

const WHAT_IF_METRICS = [
  { key: 'ftp_watts', label: 'FTP (W)', unit: 'W', needsExercise: false },
  { key: 'vo2max', label: 'VO₂max (ml/kg/min)', unit: '', needsExercise: false },
  { key: 'body_weight', label: 'Body weight (kg)', unit: 'kg', needsExercise: false },
  { key: 'estimated_1rm', label: 'Est. 1RM (kg)', unit: 'kg', needsExercise: true },
] as const;

function WhatIfLab() {
  const [metricKey, setMetricKey] = React.useState<string>('ftp_watts');
  const [exercise, setExercise] = React.useState('Back Squat');
  const [target, setTarget] = React.useState('');
  const metric = WHAT_IF_METRICS.find((m) => m.key === metricKey)!;
  const filter = metric.needsExercise ? JSON.stringify({ exercise }) : undefined;
  const { data: trend } = useMetricProjection(metricKey, filter);

  const targetNum = parseFloat(target);
  const current = trend?.current_value ?? null;
  const slope = trend?.trend?.slope_per_week ?? null;
  const scenarios =
    current != null && !Number.isNaN(targetNum) && slope != null
      ? [
          { label: 'Half pace', weeks: whatIfWeeks(current, targetNum, slope / 2) },
          { label: 'Current pace', weeks: whatIfWeeks(current, targetNum, slope) },
          { label: 'Double pace', weeks: whatIfWeeks(current, targetNum, slope * 2) },
        ]
      : null;

  const fmtWeeks = (w: number | null) => {
    if (w == null) return '—';
    if (w < 0) return '—';
    if (w === 0) return 'already there';
    const date = new Date(Date.now() + w * 7 * 86400_000).toLocaleDateString(getActiveLocale());
    return `~${w < 1 ? '<1' : Math.round(w)} wk (${date})`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>🔮 What-If Lab</CardTitle>
      </CardHeader>
      <p className="text-xs text-muted mb-3">
        Pick a metric + target — timelines extrapolate your current trend slope. Deterministic, not a promise.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label="What-if metric"
        >
          {WHAT_IF_METRICS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        {metric.needsExercise && (
          <input
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
            placeholder="Exercise name"
            className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            aria-label="Exercise for 1RM projection"
          />
        )}
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={`Target (${metric.unit || 'value'})`}
          inputMode="decimal"
          type="number"
          className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 w-36 focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label="Target value"
        />
      </div>
      {trend && current != null && (
        <p className="text-xs text-muted mb-2">
          Now: {current}{metric.unit ? ` ${metric.unit}` : ''} · trend {slope != null ? `${slope > 0 ? '+' : ''}${slope.toFixed(2)}/wk` : 'flat'}
          {trend.trend ? ` · R² ${trend.trend.r_squared.toFixed(2)}` : ''}
        </p>
      )}
      {scenarios ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {scenarios.map((s) => (
            <div key={s.label} className="p-3 bg-surface-light/30 rounded-lg">
              <p className="text-xs text-muted">{s.label}</p>
              <p className="text-sm font-bold text-foreground">{fmtWeeks(s.weeks)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">
          Enter a target above — needs an established trend in the right direction.
        </p>
      )}
    </Card>
  );
}

/* ── B-18: per-insight AI explanation ─────────────────────────────────────── */

function ExplainInsight({ insightType }: { insightType: string }) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const listKey = ['analytics', 'explanations'] as const;
  const { data: explanations } = useQuery<LlmAnalysis[]>({
    queryKey: listKey,
    queryFn: () => authFetch<LlmAnalysis[]>('/api/v1/analytics/explanations'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const existing = explanations?.find(
    (e) => (e.stats_json as { insight_type?: string } | null)?.insight_type === insightType,
  );

  const explain = useMutation({
    mutationFn: () =>
      authFetch<LlmAnalysis>(`/api/v1/analytics/explain/${insightType}`, { method: 'POST' }),
    onSuccess: (row) => {
      queryClient.setQueryData<LlmAnalysis[]>(listKey, (prev) => [
        row,
        ...(prev ?? []).filter(
          (e) => (e.stats_json as { insight_type?: string } | null)?.insight_type !== insightType,
        ),
      ]);
      setOpen(true);
    },
  });

  return (
    <div className="mt-3">
      <button
        onClick={() => (existing || explain.data ? setOpen((o) => !o) : explain.mutate())}
        disabled={explain.isPending}
        className="text-xs text-accent hover:text-accent-hover disabled:opacity-50"
      >
        {explain.isPending ? 'Explaining…' : existing || explain.data ? (open ? 'Hide AI explanation ▴' : 'Show AI explanation ▾') : '✨ Explain this insight'}
      </button>
      {explain.isError && (
        <p className="text-xs text-warning mt-1">
          Couldn&apos;t explain this insight — try again.
        </p>
      )}
      {open && (explain.data ?? existing) && (
        <div className="mt-2 p-3 bg-surface-light/30 rounded-lg text-sm text-foreground/90 whitespace-pre-wrap">
          {(explain.data ?? existing)!.analysis_text}
        </div>
      )}
    </div>
  );
}

/* ── B-18: big-picture season overview ────────────────────────────────────── */

function SeasonOverview() {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const queryKey = ['analytics', 'season-overview'] as const;

  const { data, isLoading, error } = useQuery<LlmAnalysis | null>({
    queryKey,
    queryFn: () => authFetch<LlmAnalysis | null>('/api/v1/analytics/season-overview'),
    staleTime: 60_000,
    enabled: !!token,
  });
  const generate = useMutation({
    mutationFn: () =>
      authFetch<LlmAnalysis>('/api/v1/analytics/season-overview', { method: 'POST' }),
    onSuccess: (row) => queryClient.setQueryData(queryKey, row),
  });

  return (
    <AiAnalysisCard
      title="🗺️ Season Overview"
      analysis={data ?? null}
      isLoading={isLoading}
      isRefreshing={generate.isPending}
      onRefresh={() => generate.mutate()}
      buttonLabel="Generate season overview"
      emptyEmoji="🗺️"
      emptyTitle="No season overview yet"
      emptyDescription="A cross-domain brief across cycling, strength, recovery, and planning."
      analyzingText="Reading the whole season…"
      mutationError={generate.error as Error | null}
      queryError={error as Error | null}
    />
  );
}
