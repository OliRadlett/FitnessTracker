'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flame,
  Heart,
  Info,
  Moon,
  RefreshCw,
  Scale,
  ShieldCheck,
  Wind,
  WifiOff,
} from 'lucide-react';
import {
  ageDays,
  buildDrivers,
  fmtDay,
  fmtFull,
  fmtTime,
  latestSeriesValue,
  parseInsight,
  todayISO,
  HEALTH_SIGNAL_LABELS,
  type HealthTab,
  type HealthViewModel,
} from './healthView';
import { RecoveryRing, Sparkline, HealthTrendChart } from './HealthCharts';
import {
  CardShell,
  DeltaPill,
  EmptyPanel,
  ErrorPanel,
  SectionLabel,
  StatusPill,
  Tabs,
} from './HealthUi';
import { TimeRangePicker } from '@/components/dashboard/TimeRangePicker';
import { renderStructuredAnalysis } from '@/lib/analysisRenderer';

export interface HealthPageViewProps {
  vm: HealthViewModel;
  tab: HealthTab;
  onTab: (t: HealthTab) => void;
  rangeDays: number;
  checking: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onConnect: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  focusAlertId: string | null;
}

export function HealthPageView({
  vm,
  tab,
  onTab,
  rangeDays,
  checking,
  onCheck,
  onRetry,
  onConnect,
  onRegenerate,
  regenerating,
  focusAlertId,
}: HealthPageViewProps) {
  return (
    <div className="space-y-5">
      <Tabs tab={tab} onChange={onTab} />
      {tab === 'now' && (
        <NowTab
          vm={vm}
          onTab={onTab}
          checking={checking}
          onCheck={onCheck}
          onRetry={onRetry}
          onConnect={onConnect}
        />
      )}
      {tab === 'trends' && (
        <TrendsTab vm={vm} rangeDays={rangeDays} onConnect={onConnect} />
      )}
      {tab === 'history' && (
        <HistoryTab
          vm={vm}
          onRegenerate={onRegenerate}
          regenerating={regenerating}
          focusAlertId={focusAlertId}
        />
      )}
</div>
  );
}

function NowTab({
  vm,
  onTab,
  checking,
  onCheck,
  onRetry,
  onConnect,
}: {
  vm: HealthViewModel;
  onTab: (t: HealthTab) => void;
  checking: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onConnect: () => void;
}) {
  if (vm.isError) {
    return (
      <div className="space-y-4">
        <ErrorPanel onRetry={onRetry} />
        <CardShell>
          <p className="text-sm text-muted">No values are shown while the fetch is failing — stale health numbers are worse than none.</p>
        </CardShell>
      </div>
    );
  }

  if (vm.isEmpty) {
    return (
      <div className="space-y-4">
        <EmptyPanel
          title="No Whoop data yet"
          body="Connect Whoop to see recovery, HRV, resting heart rate, sleep and strain. Nothing here is estimated or filled in."
          cta="Connect Whoop"
          onCta={onConnect}
        />
        <CardShell>
          <SectionLabel>What you will get</SectionLabel>
          <div className="mt-3 grid gap-3 text-sm text-muted sm:grid-cols-3">
            <p>Daily readiness with the HRV and resting-HR context behind it.</p>
            <p>Sleep debt, consistency and your best-recovery bedtime window.</p>
            <p>One health check that says whether anything needs attention now.</p>
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Hero vm={vm} />
      <div id="health-check">
        <HealthCheckCard vm={vm} checking={checking} onCheck={onCheck} />
      </div>
      <SleepCard vm={vm} onOpen={() => onTab('trends')} />
      <Coverage vm={vm} />
    </div>
  );
}

function Hero({ vm }: { vm: HealthViewModel }) {
  const drivers = buildDrivers(vm);
  const byKey = Object.fromEntries(drivers.map((d) => [d.key, d]));
  const hrv = byKey.hrv;
  const rhr = byKey.rhr;
  const sleep = byKey.sleep;
  const recovery = byKey.recovery;

  const score = vm.readiness?.recovery_score ?? null;
  const kind = vm.readiness?.readiness ?? 'unknown';
  const baseTone = kind === 'green' ? 'positive' : kind === 'yellow' ? 'caution' : kind === 'red' ? 'warning' : 'muted';
  const tone = vm.isStale ? 'caution' : baseTone;
  const baseVerdict =
    kind === 'green'
      ? (score != null && score >= 80 ? 'Ready to train hard' : 'Ready to train')
      : kind === 'yellow'
        ? 'Take it easier today'
        : kind === 'red'
          ? 'Prioritise recovery'
          : 'No readiness data';
  const verdict = vm.isStale ? `Last known: ${baseVerdict.toLowerCase()}` : baseVerdict;

  const hrvText = vm.readiness?.hrv_ms != null ? `${vm.readiness.hrv_ms.toFixed(0)} ms` : '—';
  const rhrText = vm.readiness?.resting_hr != null ? `${vm.readiness.resting_hr.toFixed(0)} bpm` : '—';
  const debt = vm.sleep?.debt.debt_hours;
  const recoveryAvg = recovery?.value && recovery.value !== '—' ? Number(recovery.value) : null;
  const diff = score != null && recoveryAvg != null ? score - recoveryAvg : null;

  const avgLine = diff != null ? ` That is ${diff >= 0 ? '+' : ''}${diff.toFixed(0)} points versus your 7-day average.` : '';
  const sentence = vm.isStale
    ? `Last known recovery from ${fmtFull(vm.asOf)}. Whoop has not synced since ${fmtDay(vm.syncAt)} at ${fmtTime(vm.syncAt)} — reconnect before acting on this.`
    : kind === 'green'
      ? `HRV ${hrvText} and resting HR ${rhrText} are at your 30-day baseline. Sleep debt is ${debt != null ? `${debt.toFixed(1)}h` : 'unavailable'}.${avgLine}`
      : kind === 'yellow'
        ? `Recovery is ${diff != null ? `${Math.abs(diff).toFixed(0)} points` : 'below your baseline'} below your 7-day average${hrv && hrv.delta !== '—' ? `; HRV is ${hrv.delta.replace(/[+-]/g, '')} ${hrv.delta.startsWith('-') ? 'below' : 'above'} its 30-day baseline` : ''}. Keep the planned session easy.`
        : kind === 'red'
          ? 'Recovery, HRV and resting HR all point to recovery first. Do not force the planned session.'
          : 'Connect Whoop to see readiness, HRV and resting HR.';

  return (
    <CardShell className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
        style={{ backgroundColor: tone === 'positive' ? 'rgba(34,197,94,0.10)' : tone === 'caution' ? 'rgba(245,158,11,0.10)' : 'rgba(148,163,184,0.06)' }}
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="self-center sm:self-auto">
            <RecoveryRing score={score} tone={tone} caption={vm.isStale ? 'Stale' : 'Recovery'} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={tone}>
                {vm.isStale ? <Clock3 className="h-3 w-3" /> : kind === 'green' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {vm.isStale ? 'Stale' : kind === 'green' ? 'Green' : kind === 'yellow' ? 'Moderate' : kind === 'red' ? 'Rest' : 'No data'}
              </StatusPill>
              <span className="text-xs text-muted">
                {vm.isStale ? `as of ${fmtFull(vm.asOf)}` : `updated ${fmtTime(vm.syncAt)}`}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{verdict}</h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted">{sentence}</p>
            {!vm.isStale && vm.isAttention && (
              <button
                type="button"
                onClick={() => document.getElementById('health-check')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-caution hover:text-caution/80"
              >
                See what needs attention <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="grid w-full gap-1.5 sm:grid-cols-2 lg:w-[330px] lg:grid-cols-1">
          {[hrv, rhr, sleep, byKey.strain].filter(Boolean).map((d) => (
            <div key={d.key} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.015] px-3 py-2.5">
              <div className="w-[86px] shrink-0">
                <p className="whitespace-nowrap text-xs uppercase tracking-[0.1em] text-muted">{d.label}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {d.value}<span className="ml-0.5 text-xs font-normal text-muted">{d.unit}</span>
                </p>
              </div>
              <div className="h-6 min-w-0 flex-1">
                <Sparkline data={d.spark} height={24} tone={d.tone} />
              </div>
              <DeltaPill value={d.delta} label={d.deltaLabel} good={d.good} />
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

function HealthCheckCard({
  vm,
  checking,
  onCheck,
}: {
  vm: HealthViewModel;
  checking: boolean;
  onCheck: () => void;
}) {
  const staleUnverified = vm.isStale;
  const loading = vm.checkLoading && !staleUnverified;
  const results = staleUnverified || loading ? null : vm.analysis;
  const warnings = results?.filter((r) => r.result && r.result.severity !== 'none') ?? [];
  const clear = results?.filter((r) => !r.result || r.result.severity === 'none') ?? [];
  const staleRows = staleUnverified
    ? Array.from(new Map(vm.alerts.filter((a) => a.status === 'active').map((a) => [a.alert_type, a])).values())
    : [];

  const tone: 'positive' | 'caution' | 'warning' | 'muted' =
    staleUnverified ? 'warning' : warnings.length > 0 ? 'caution' : results ? 'positive' : 'muted';
  const badge = staleUnverified
    ? 'Unverified'
    : loading
      ? 'Checking…'
      : warnings.length > 0
        ? `${warnings.length} needs attention`
        : results
          ? 'All clear'
          : 'No check yet';

  return (
    <CardShell className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Health check</SectionLabel>
          <p className="mt-1.5 text-sm text-muted">
            {staleUnverified
              ? `Whoop last synced ${fmtDay(vm.syncAt)} · ${ageDays(vm.syncAt, vm.asOf)} days ago`
              : loading
                ? 'Running the six signals…'
                : vm.analysisDate
                  ? `Last checked ${fmtTime(vm.analysisDate)} · 6 deterministic signals`
                  : 'No check yet'}
          </p>
        </div>
        <StatusPill tone={tone}>
          {tone === 'positive' ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {badge}
        </StatusPill>
      </div>

      {staleUnverified ? (
        <div className="mt-3 rounded-xl border border-caution/20 bg-caution/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-caution">
            These are the last known checks, not current ones. Run a check before treating any of them as live.
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-light/30" />
          ))}
        </div>
      ) : staleUnverified ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {staleRows.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] px-2.5 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-caution" />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{a.title}</span>
              <span className="shrink-0 text-xs text-caution">{fmtDay(a.detected_date)}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {warnings.map((item) => (
            <div key={item.type} className="mt-2 flex items-start gap-2.5 rounded-lg border border-caution/20 bg-caution/[0.05] px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
              <div className="min-w-0">
                <p className="text-sm text-foreground">{HEALTH_SIGNAL_LABELS[item.type] ?? item.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.error ?? item.result?.description ?? 'No result returned.'}</p>
              </div>
            </div>
          ))}
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {clear.map((item) => (
              <div key={item.type} className="flex items-center gap-2 rounded-lg border border-white/[0.05] px-2.5 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{HEALTH_SIGNAL_LABELS[item.type] ?? item.label}</span>
                <span className="hidden shrink-0 text-xs text-muted sm:inline">clear</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <p className="text-xs text-muted">
          {staleUnverified ? 'Whoop has not synced — a check would use old data.' : 'Runs the six signals — no LLM, no plan changes.'}
        </p>
        <button
          type="button"
          onClick={onCheck}
          disabled={checking || staleUnverified || loading}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/10 px-3.5 text-xs font-medium text-foreground hover:bg-white/[0.04] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking || loading ? 'animate-spin' : ''}`} />
          {staleUnverified ? 'Sync first' : checking || loading ? 'Checking…' : 'Run check'}
        </button>
      </div>
    </CardShell>
  );
}

function SleepCard({ vm, onOpen }: { vm: HealthViewModel; onOpen: () => void }) {
  const target = vm.sleep?.debt.target_hours ?? 8;
  const avg = vm.sleep?.debt.avg_sleep_hours ?? null;
  const debt = vm.sleep?.debt.debt_hours ?? null;
  const below = vm.sleep?.debt.days_below_target ?? null;
  const consistency = vm.sleep?.consistency ?? null;
  const bedtime = vm.sleep?.bedtime ?? null;
  const lastNight = latestSeriesValue(vm.charts.sleep_quality_trend, 'Sleep Hours');
  const tone = debt != null && debt >= 3 ? 'warning' : debt != null && debt >= 1 ? 'caution' : 'positive';

  return (
    <CardShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Sleep</SectionLabel>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-foreground">
              {lastNight != null ? lastNight.toFixed(1) : '—'}
              <span className="ml-0.5 text-base font-normal text-muted">h</span>
            </span>
            <span className="text-xs text-muted">
              {vm.isStale ? `night of ${fmtDay(vm.asOf)}` : 'last night'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {avg != null ? `7-day average ${avg.toFixed(1)}h` : 'No rolling average yet'}
            {debt != null && <span className={tone === 'positive' ? 'text-positive' : tone === 'caution' ? 'text-caution' : 'text-warning'}> · {debt.toFixed(1)}h debt</span>}
          </p>
        </div>
        <StatusPill tone={tone}>
          {below != null ? `${below} of 7 below ${target.toFixed(0)}h` : 'No target data'}
        </StatusPill>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-white/[0.06] pt-4">
        <Stat label="7d debt" value={debt != null ? `-${debt.toFixed(1)}h` : '—'} tone={tone} note={`target ${target.toFixed(0)}h`} />
        <Stat
          label="Consistency"
          value={consistency ? `${consistency.consistency_score.toFixed(0)}/100` : '—'}
          note={consistency ? `±${consistency.std_minutes.toFixed(0)} min` : 'not enough nights'}
        />
        <Stat
          label="Bedtime"
          value={bedtime?.suggested_bedtime ?? '—'}
          note={bedtime ? `${bedtime.confidence} confidence` : 'no recommendation'}
        />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
      >
        Sleep and strain trends <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </CardShell>
  );
}

function Stat({ label, value, note, tone = 'muted' }: { label: string; value: string; note?: string; tone?: 'positive' | 'caution' | 'warning' | 'muted' }) {
  const color = tone === 'positive' ? 'text-positive' : tone === 'caution' ? 'text-caution' : tone === 'warning' ? 'text-warning' : 'text-foreground';
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Coverage({ vm }: { vm: HealthViewModel }) {
  const weight = vm.weight?.entries[vm.weight.entries.length - 1];
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-4 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        {vm.whoopConnected ? <CheckCircle2 className="h-3.5 w-3.5 text-positive" /> : <WifiOff className="h-3.5 w-3.5" />}
        {vm.whoopConnected ? 'Whoop connected' : 'Whoop not connected'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Wind className="h-3.5 w-3.5" />
        Respiratory rate: {vm.respiratory?.current_rr != null ? `${vm.respiratory.current_rr.toFixed(1)} /min` : 'not provided by Whoop'}
      </span>
      {weight && (
        <span className="inline-flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5" /> {weight.weight_kg.toFixed(1)} kg · {fmtDay(weight.date)}
        </span>
      )}
      <a href="/fittrack/cycling" className="ml-auto inline-flex min-h-[24px] items-center gap-1 text-muted hover:text-foreground">
        Training load on Cycling <ArrowRight className="h-3 w-3" />
      </a>
    </footer>
  );
}

function TrendsTab({
  vm,
  rangeDays,
  onConnect,
}: {
  vm: HealthViewModel;
  rangeDays: number;
  onConnect: () => void;
}) {
  if (vm.isEmpty) {
    return (
      <EmptyPanel
        title="No trends without Whoop"
        body="Recovery, HRV, resting HR and sleep trends appear once Whoop is connected. No synthetic lines are drawn."
        cta="Connect Whoop"
        onCta={onConnect}
      />
    );
  }

  const recoveryInsight = vm.charts.whoop_recovery_trend?.insights?.[0] ?? 'No recovery insight for this window.';
  const rhrInsight = vm.charts.resting_hr_trend?.insights?.[0] ?? 'No resting-HR insight for this window.';
  const sleepAvg = vm.sleep?.debt.avg_sleep_hours;
  const correlations = (vm.charts.recovery_vs_performance?.insights ?? []).map(parseInsight);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Trends</SectionLabel>
          <p className="mt-1 text-sm text-muted">Baselines are 30-day means; the shaded band is ±1 SD. One unit per chart.</p>
        </div>
        <TimeRangePicker />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendCard
          title="Recovery"
          icon={<Activity className="h-4 w-4" />}
          meta={`Today ${vm.readiness?.recovery_score != null ? `${vm.readiness.recovery_score.toFixed(0)}%` : '—'} · ${rangeDays}D`}
          insight={recoveryInsight}
        >
          <HealthTrendChart
            chart={vm.charts.whoop_recovery_trend}
            days={rangeDays}
            primary="Recovery"
            secondary="7-day Average"
            unit="%"
            domain={[0, 100]}
            zones={[
              { from: 67, to: 100, tone: 'positive' },
              { from: 34, to: 67, tone: 'caution' },
              { from: 0, to: 34, tone: 'warning' },
            ]}
            ticks={[0, 25, 50, 75, 100]}
            ariaLabel="Recovery score trend"
          />
        </TrendCard>

        <TrendCard
          title="HRV"
          icon={<Heart className="h-4 w-4" />}
          meta={`Today ${vm.readiness?.hrv_ms != null ? `${vm.readiness.hrv_ms.toFixed(0)} ms` : '—'} · ${rangeDays}D`}
          insight="Daily HRV against your 30-day average — the direction matters more than one night."
        >
          <HealthTrendChart
            chart={vm.charts.hrv_trend_detailed}
            days={rangeDays}
            primary="Daily HRV"
            secondary="30-day Average"
            unit="ms"
            ariaLabel="HRV trend"
          />
        </TrendCard>

        <TrendCard
          title="Resting heart rate"
          icon={<Activity className="h-4 w-4" />}
          meta={`Today ${vm.readiness?.resting_hr != null ? `${vm.readiness.resting_hr.toFixed(0)} bpm` : '—'} · ${rangeDays}D`}
          insight={rhrInsight}
        >
          <HealthTrendChart
            chart={vm.charts.resting_hr_trend}
            days={rangeDays}
            primary="Resting HR"
            secondary="7-day Average"
            unit="bpm"
            ariaLabel="Resting heart rate trend"
          />
        </TrendCard>

        <TrendCard
          title="Sleep duration"
          icon={<Moon className="h-4 w-4" />}
          meta={`${sleepAvg != null ? `${sleepAvg.toFixed(1)}h` : '—'} 7D avg · target 8h`}
          insight={`${vm.sleep?.debt.days_below_target ?? 0} of the last 7 nights were below target; the band is 7–9h.`}
        >
          <HealthTrendChart
            chart={vm.charts.sleep_quality_trend}
            days={rangeDays}
            primary="Sleep Hours"
            unit="h"
            domain={[0, 10]}
            zones={[{ from: 7, to: 9, tone: 'positive' }]}
            ticks={[0, 2, 4, 6, 8, 10]}
            ariaLabel="Sleep duration trend"
          />
        </TrendCard>

        <TrendCard
          title="Strain"
          icon={<Flame className="h-4 w-4" />}
          meta={`Latest ${latestSeriesValue(vm.charts.whoop_strain_trend, 'Strain') != null ? latestSeriesValue(vm.charts.whoop_strain_trend, 'Strain')!.toFixed(1) : '—'} · 0–21`}
          insight="Daily cardiovascular load. The band is the moderate 10–14 range; this is context, not a target."
        >
          <HealthTrendChart
            chart={vm.charts.whoop_strain_trend}
            days={rangeDays}
            primary="Strain"
            unit=""
            domain={[0, 21]}
            zones={[{ from: 10, to: 14, tone: 'caution' }]}
            ticks={[0, 7, 14, 21]}
            primaryColor="#60a5fa"
            ariaLabel="Whoop strain trend"
          />
        </TrendCard>

        <WeightCard vm={vm} />
      </div>

      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel>Correlations</SectionLabel>
            <p className="mt-1 text-sm text-muted">Directional, not causal. We only treat a link as actionable at n ≥ 10.</p>
          </div>
          <Info className="h-4 w-4 shrink-0 text-muted" />
        </div>
        <div className="mt-3 space-y-2">
          {correlations.length === 0 ? (
            <p className="text-sm text-muted">No recovery/performance correlation yet.</p>
          ) : (
            correlations.map((c) => {
              const display = c.trusted
                ? c.text
                : c.text.replace(/\((strong|weak) link, /, '(too few sessions to treat as a link, ');
              return (
                <div key={c.text} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/[0.05] px-3 py-2.5">
                  <p className="max-w-xl text-sm leading-relaxed text-muted">{display}</p>
                  <StatusPill tone={c.trusted ? 'muted' : 'caution'}>
                    {c.n != null ? `n=${c.n}` : 'n unknown'}{!c.trusted ? ' · too few' : ''}
                  </StatusPill>
                </div>
              );
            })
          )}
        </div>
      </CardShell>
    </div>
  );
}

function TrendCard({
  title,
  icon,
  meta,
  insight,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  meta: string;
  insight: string;
  children: React.ReactNode;
}) {
  return (
    <CardShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="text-muted">{icon}</span>
            {title}
          </div>
          <p className="mt-0.5 text-xs text-muted">{meta}</p>
        </div>
      </div>
      <div className="mt-3">{children}</div>
      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-3 w-3 shrink-0" /> {insight}
      </p>
    </CardShell>
  );
}

function WeightCard({ vm }: { vm: HealthViewModel }) {
  const entries = vm.weight?.entries ?? [];
  const latest = entries[entries.length - 1];
  const avg = vm.weight?.rolling_avg[vm.weight.rolling_avg.length - 1];
  const weights = entries.map((e) => e.weight_kg);
  const spread = weights.length > 1 ? Math.max(...weights) - Math.min(...weights) : 0;
  const recent = entries.slice(-3).reverse();

  return (
    <CardShell className="h-fit">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Body weight</SectionLabel>
          {latest ? (
            <>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums text-foreground">{latest.weight_kg.toFixed(1)}<span className="ml-0.5 text-sm font-normal text-muted">kg</span></span>
                <span className="text-xs text-muted">{fmtDay(latest.date)} · via {latest.source}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{avg ? `7-day avg ${avg.weight_kg.toFixed(1)} kg` : 'No rolling average yet'}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No weigh-ins yet. Log one on the Cycling page.</p>
          )}
        </div>
        <a href="/fittrack/cycling" className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
          Manage weigh-ins <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
      {spread > 0.2 ? (
        <div className="mt-3 h-7">
          <Sparkline data={weights} height={26} tone="muted" />
        </div>
      ) : (
        entries.length > 1 && <p className="mt-2 text-xs text-muted">Weight stable across {entries.length} entries ({spread.toFixed(1)} kg spread).</p>
      )}
      {recent.length > 1 && (
        <ul className="mt-3 space-y-1 border-t border-white/[0.06] pt-2 text-xs" aria-label="Recent weigh-ins">
          {recent.map((e) => (
            <li key={`${e.date}-${e.source}`} className="flex items-baseline justify-between gap-3">
              <span className="text-muted">{fmtDay(e.date)}</span>
              <span className="tabular-nums text-foreground">{e.weight_kg.toFixed(1)} kg</span>
              <span className="text-muted">via {e.source}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function HistoryTab({
  vm,
  onRegenerate,
  regenerating,
  focusAlertId,
}: {
  vm: HealthViewModel;
  onRegenerate: () => void;
  regenerating: boolean;
  focusAlertId: string | null;
}) {
  const [filter, setFilter] = useState<'all' | 'active' | 'dismissed'>('all');
  const [openAi, setOpenAi] = useState(false);

  useEffect(() => {
    if (!focusAlertId) return;
    setFilter('all');
    requestAnimationFrame(() => {
      document.getElementById(`health-alert-${focusAlertId}`)?.scrollIntoView({ block: 'center' });
    });
  }, [focusAlertId]);

  const isRecent = (a: { detected_date: string; status: string }) =>
    a.status === 'active' && (ageDays(a.detected_date, todayISO()) ?? 999) <= 14;
  const filtered = vm.alerts.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'active') return isRecent(a);
    return a.status === filter;
  });
  const counts = {
    all: vm.alerts.length,
    active: vm.alerts.filter(isRecent).length,
    dismissed: vm.alerts.filter((a) => a.status === 'dismissed').length,
  };
  const groups = filtered.reduce<Record<string, typeof filtered>>((acc, a) => {
    const key = new Date(`${a.detected_date}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    acc[key] = [...(acc[key] ?? []), a];
    return acc;
  }, {});

  const aiAge = vm.ai ? ageDays(vm.ai.analysis_date, todayISO()) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>History</SectionLabel>
          <p className="mt-1 text-sm text-muted">Alerts and analysis, archived by the date they were produced.</p>
        </div>
        <div role="group" aria-label="Alert status" className="flex gap-1 rounded-lg border border-white/[0.07] bg-surface p-1">
          {(['all', 'active', 'dismissed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-[44px] rounded-md px-3 text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-white/[0.07] text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {f} <span className="tabular-nums text-muted">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <CardShell className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-positive" />
          <p className="text-sm text-muted">No {filter} alerts. A clear check does not erase history; it just means nothing is live now.</p>
        </CardShell>
      ) : (
        <div className="space-y-5">
          {Object.entries(groups).map(([month, alerts]) => (
            <section key={month}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{month}</h2>
                <span className="text-xs text-muted">{alerts.length}</span>
              </div>
              <div className="space-y-2">
                {alerts.map((a) => {
                  const age = ageDays(a.detected_date, todayISO()) ?? 0;
                  const unverified = a.status === 'active' && age > 14;
                  const dot = a.severity === 'critical' ? 'bg-warning' : a.severity === 'warning' ? 'bg-caution' : 'bg-info';
                  return (
                    <div key={a.id} id={`health-alert-${a.id}`} className="scroll-mt-4 rounded-xl border border-white/[0.06] bg-surface p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{a.title}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted">{a.description}</p>
                          </div>
                        </div>
                        <StatusPill tone={unverified ? 'caution' : a.status === 'dismissed' || a.status === 'resolved' ? 'muted' : a.severity === 'critical' ? 'warning' : 'caution'}>
                          {unverified ? 'Unverified' : a.status}
                        </StatusPill>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs text-muted">
                        <span>{fmtFull(a.detected_date)}</span>
                        <span>·</span>
                        <span>{age}d ago</span>
                        <span>·</span>
                        <span className="uppercase">{a.severity}</span>
                        {unverified && <span className="text-caution">· not re-checked since</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <CardShell>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <SectionLabel>AI health analysis</SectionLabel>
              <p className="mt-1 text-sm text-muted">
                {vm.ai
                  ? `Generated ${fmtFull(vm.ai.analysis_date)} · ${aiAge != null ? `${aiAge} days ago` : 'date unknown'} · ${vm.ai.model_used}`
                  : vm.aiLoading
                    ? 'Loading analysis…'
                    : 'No analysis yet — generate one from your current health data.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {vm.ai && (
              <button
                type="button"
                onClick={() => setOpenAi((v) => !v)}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-white/10 px-3 text-xs font-medium text-foreground hover:bg-white/[0.04]"
              >
                {openAi ? 'Hide analysis' : 'View analysis'} <ChevronRight className={`h-3.5 w-3.5 transition-transform ${openAi ? 'rotate-90' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating || vm.aiLoading}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-medium text-foreground hover:bg-white/[0.04] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Analyzing…' : vm.ai ? 'Regenerate' : 'Analyze health'}
            </button>
          </div>
        </div>
        {vm.ai && aiAge != null && aiAge > 7 && (
          <div className="mt-3 rounded-lg border border-caution/20 bg-caution/[0.06] px-3 py-2 text-xs leading-relaxed text-caution">
            This analysis was written before your current data. Refresh it before acting on it.
          </div>
        )}
        {vm.ai && openAi && (
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            {renderStructuredAnalysis(vm.ai.analysis_text)}
          </div>
        )}
      </CardShell>
    </div>
  );
}
