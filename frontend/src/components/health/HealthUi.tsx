'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HeartPulse,
  PlugZap,
  RefreshCw,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { HealthTab, HealthViewModel } from './healthView';
import { ageDays, fmtDay, fmtTime } from './healthView';

export function CardShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/[0.07] bg-surface p-5 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-[0.14em] text-muted ${className}`}>
      {children}
    </p>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'positive' | 'caution' | 'warning' | 'muted';
  children: React.ReactNode;
}) {
  const map = {
    positive: 'border-positive/25 bg-positive/10 text-positive',
    caution: 'border-caution/30 bg-caution/10 text-caution',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    muted: 'border-white/10 bg-white/[0.03] text-muted',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

export function DeltaPill({
  value,
  label,
  good,
}: {
  value: string;
  label: string;
  good: boolean | null;
}) {
  if (value === '—') return <span className="text-xs text-muted">{label}</span>;
  const tone = good == null ? 'text-muted' : good ? 'text-positive' : 'text-caution';
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs">
      <span className={`font-medium tabular-nums ${tone}`}>{value}</span>
      <span className="text-muted/70">{label}</span>
    </span>
  );
}

export function Tabs({ tab, onChange }: { tab: HealthTab; onChange: (t: HealthTab) => void }) {
  const items: { id: HealthTab; label: string; icon: React.ReactNode }[] = [
    { id: 'now', label: 'Now', icon: <HeartPulse className="h-4 w-4" /> },
    { id: 'trends', label: 'Trends', icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'history', label: 'History', icon: <Clock3 className="h-4 w-4" /> },
  ];
  return (
    <div role="tablist" aria-label="Health sections" className="flex w-full gap-1 rounded-xl border border-white/[0.07] bg-surface p-1 sm:w-fit">
      {items.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors sm:flex-none ${
              active ? 'bg-white/[0.07] text-foreground' : 'text-muted hover:bg-white/[0.03] hover:text-foreground'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function SyncLine({ vm, loading = false, compact = false }: { vm: HealthViewModel; loading?: boolean; compact?: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Wifi className="h-3.5 w-3.5" /> Checking sync…
      </span>
    );
  }
  if (vm.connectionsError) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <WifiOff className="h-3.5 w-3.5" /> Sync status unavailable
      </span>
    );
  }
  if (!vm.whoopConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <WifiOff className="h-3.5 w-3.5" /> Whoop not connected
      </span>
    );
  }
  const age = ageDays(vm.syncAt, vm.asOf);
  const tone = age == null ? 'text-muted' : age <= 1 ? 'text-positive' : age <= 3 ? 'text-caution' : 'text-warning';
  const label = age == null
    ? 'Not synced'
    : age === 0
      ? `Synced today ${fmtTime(vm.syncAt)}`
      : age === 1
        ? 'Synced yesterday'
        : `Synced ${age}d ago`;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`}>
      <Wifi className="h-3.5 w-3.5" />
      {label}
      {!compact && <span className="text-muted/70">· {fmtDay(vm.asOf)}</span>}
    </span>
  );
}

export function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-warning/25 bg-warning/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div>
          <p className="text-sm font-medium text-foreground">Some health data couldn&apos;t load</p>
          <p className="mt-0.5 text-xs text-muted">Your last known values are hidden rather than shown stale. Retry the sync.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/10 px-4 text-sm text-foreground hover:bg-white/[0.04]"
      >
        <RefreshCw className="h-4 w-4" /> Retry
      </button>
    </div>
  );
}

export function EmptyPanel({
  title,
  body,
  cta,
  onCta,
}: {
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <CardShell className="flex flex-col items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <PlugZap className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      </div>
      <button
        type="button"
        onClick={onCta}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
      >
        {cta} <Activity className="h-4 w-4" />
      </button>
    </CardShell>
  );
}

export function SignalChip({
  label,
  detail,
  tone,
}: {
  label: string;
  detail: string;
  tone: 'positive' | 'caution' | 'warning' | 'muted';
}) {
  const icon = tone === 'positive'
    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
    : tone === 'muted'
      ? <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted" />
      : <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${tone === 'warning' ? 'text-warning' : 'text-caution'}`} />;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] px-2.5 py-2" title={detail}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{label}</span>
    </div>
  );
}
