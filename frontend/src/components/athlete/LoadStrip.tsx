'use client';

/**
 * Phase 1 (plans/ui-redesign-v2.md §1 + §4 moment 2) — `LoadStrip`.
 *
 * The single home for CTL/ATL/TSB display: identical props in every slot
 * (dashboard, cycling, training — guardrail §1.3). Values are display-only;
 * CTL/ATL/TSB computation stays in `docs/algorithms.md`. Tapping a chip jumps
 * to its home chart.
 */

import React from 'react';
import Link from 'next/link';
import { formatTSB } from '@/lib/utils';
import { SkeletonMetric } from '@/components/ui/Skeleton';

export interface LoadStripProps {
  ctl?: number | null;
  atl?: number | null;
  tsb?: number | null;
  /** Trailing-7d TSS from the server-computed load series. */
  weekTss?: number | null;
  ftpWatts?: number | null;
  trend?: 'up' | 'down' | 'flat' | null;
  isLoading?: boolean;
  /** Optional sync badge rendered as the trailing chip (same node everywhere). */
  syncBadge?: React.ReactNode;
}

function tsbLabel(tsb: number | null | undefined): string | null {
  if (tsb == null || !Number.isFinite(tsb)) return null;
  if (tsb > 10) return 'Fresh';
  if (tsb >= -10) return 'Neutral';
  if (tsb > -30) return 'Fatigued';
  return 'Very fatigued';
}

function tsbColor(tsb: number | null | undefined): string {
  if (tsb == null || !Number.isFinite(tsb)) return 'text-muted';
  if (tsb < -30) return 'text-warning';
  if (tsb < -10) return 'text-amber-400';
  if (tsb > 10) return 'text-positive';
  return 'text-blue-400';
}

interface ChipProps {
  label: string;
  value: string;
  sub?: string | null;
  valueClassName?: string;
  href: string;
}

function Chip({ label, value, sub, valueClassName = 'text-foreground', href }: ChipProps) {
  return (
    <Link
      href={href}
      className="flex min-h-[44px] min-w-[88px] flex-col justify-center rounded-lg border border-surface-light/50 bg-surface px-3 py-1.5 transition-colors hover:border-accent/40"
      aria-label={`${label}: ${value}${sub ? `, ${sub}` : ''}. Open chart.`}
    >
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-base font-bold tabular-nums ${valueClassName}`}>{value}</span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </Link>
  );
}

export function LoadStrip({
  ctl,
  atl,
  tsb,
  weekTss,
  ftpWatts,
  trend,
  isLoading,
  syncBadge,
}: LoadStripProps) {
  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto" role="status" aria-label="Loading training load">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="min-w-[88px] flex-1">
            <SkeletonMetric />
          </div>
        ))}
      </div>
    );
  }

  const trendArrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'flat' ? '→' : null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1" role="group" aria-label="Training load">
      <Chip
        label="CTL (42d)"
        value={ctl != null && Number.isFinite(ctl) ? ctl.toFixed(1) : '—'}
        href="/cycling"
      />
      <Chip
        label="ATL (7d)"
        value={atl != null && Number.isFinite(atl) ? atl.toFixed(1) : '—'}
        href="/cycling"
      />
      <Chip
        label="TSB"
        value={formatTSB(tsb)}
        sub={[tsbLabel(tsb), trendArrow].filter(Boolean).join(' ')}
        valueClassName={tsbColor(tsb)}
        href="/cycling"
      />
      <Chip
        label="7d TSS"
        value={weekTss != null && Number.isFinite(weekTss) ? String(Math.round(weekTss)) : '—'}
        href="/activities"
      />
      <Chip
        label="FTP"
        value={ftpWatts != null && Number.isFinite(ftpWatts) ? `${Math.round(ftpWatts)} W` : '—'}
        href="/cycling"
      />
      {syncBadge ? (
        <div className="flex min-h-[44px] items-center px-1">{syncBadge}</div>
      ) : null}
    </div>
  );
}
