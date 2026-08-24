'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonRow } from '@/components/ui/Skeleton';
import type { DeficiencyResponse, WeaknessItem, DeficiencySeverity } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Known metric keys → human titles. Unknown keys fall back to title-casing. */
const METRIC_TITLES: Record<string, string> = {
  bench_squat_ratio: 'Bench/Squat Ratio',
  squat_deadlift_ratio: 'Squat/Deadlift Ratio',
  press_squat_ratio: 'Press/Squat Ratio',
  push_pull_balance: 'Push/Pull Balance',
  upper_lower_balance: 'Upper/Lower Balance',
  vo2max_ftp_mismatch: 'VO2max vs FTP Mismatch',
  aerobic_decoupling: 'Aerobic Decoupling',
  zone_distribution: 'Zone Distribution',
};

/** Humanize a machine metric key: "bench_squat_ratio" → "Bench/Squat Ratio". */
function humanizeMetric(metric: string): string {
  if (METRIC_TITLES[metric]) return METRIC_TITLES[metric];
  return metric
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface SeverityStyle {
  dot: string;
  badgeBg: string;
  badgeText: string;
  label: string;
}

const SEVERITY_STYLES: Record<DeficiencySeverity, SeverityStyle> = {
  critical: {
    dot: 'bg-red-500',
    badgeBg: 'bg-red-500/20',
    badgeText: 'text-red-400',
    label: 'Critical',
  },
  high: {
    dot: 'bg-orange-500',
    badgeBg: 'bg-orange-500/20',
    badgeText: 'text-orange-400',
    label: 'High',
  },
  medium: {
    dot: 'bg-yellow-500',
    badgeBg: 'bg-yellow-500/20',
    badgeText: 'text-yellow-400',
    label: 'Medium',
  },
  low: {
    dot: 'bg-blue-400',
    badgeBg: 'bg-blue-400/20',
    badgeText: 'text-blue-300',
    label: 'Low',
  },
  strength: {
    dot: 'bg-green-500',
    badgeBg: 'bg-green-500/20',
    badgeText: 'text-positive',
    label: 'Strength',
  },
};

const MAJOR_SEVERITIES: DeficiencySeverity[] = ['critical', 'high', 'strength'];
const MINOR_SEVERITIES: DeficiencySeverity[] = ['medium', 'low'];

/** Sort order within a group: severity rank, then metric name. */
const SEVERITY_RANK: Record<DeficiencySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  strength: 4,
};

function sortWeaknesses(items: WeaknessItem[]): WeaknessItem[] {
  return [...items].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.metric.localeCompare(b.metric),
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryBadge({ count, style }: { count: number; style: SeverityStyle }) {
  if (count === 0) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.badgeBg} ${style.badgeText}`}>
      {count} {style.label.toLowerCase()}
    </span>
  );
}

function WeaknessRow({ item }: { item: WeaknessItem }) {
  const style = SEVERITY_STYLES[item.severity];
  const isStrength = item.severity === 'strength';
  return (
    <div className="p-3 bg-surface-light/30 rounded-lg">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`}
          aria-hidden="true"
          title={style.label}
        />
        <span className={`text-sm font-medium ${isStrength ? 'text-positive' : 'text-white'}`}>
          {humanizeMetric(item.metric)}
        </span>
        {item.level && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${style.badgeBg} ${style.badgeText}`}>
            {item.level}
          </span>
        )}
      </div>
      {item.detail && <p className="text-xs text-muted mt-1 ml-4">{item.detail}</p>}
      {!isStrength && item.recommendation && (
        <p className="text-xs text-accent mt-1 ml-4">→ {item.recommendation}</p>
      )}
    </div>
  );
}

function CategoryGroup({ title, icon, items }: { title: string; icon: string; items: WeaknessItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1">
        <span aria-hidden="true">{icon}</span> {title}
      </h3>
      <div className="space-y-2">
        {items.map((item) => (
          <WeaknessRow key={`${item.category}-${item.type}-${item.metric}`} item={item} />
        ))}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

interface DeficiencyCardProps {
  data?: DeficiencyResponse;
  isLoading?: boolean;
}

export function DeficiencyCard({ data, isLoading }: DeficiencyCardProps) {
  const [showMinor, setShowMinor] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>🎯 Weakness Analysis</CardTitle></CardHeader>
        <SkeletonRow className="h-24" />
      </Card>
    );
  }

  const weaknesses = data?.weaknesses ?? [];
  const summary = data?.summary;

  // No analysis at all → balanced state
  if (!data || weaknesses.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>🎯 Weakness Analysis</CardTitle></CardHeader>
        <div className="flex items-center gap-3 py-6 justify-center">
          <span className="h-8 w-8 rounded-full bg-positive/20 flex items-center justify-center shrink-0" aria-hidden="true">
            <svg className="h-5 w-5 text-positive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <p className="text-sm text-muted">All metrics balanced — no weaknesses identified</p>
        </div>
      </Card>
    );
  }

  const major = sortWeaknesses(weaknesses.filter((w) => MAJOR_SEVERITIES.includes(w.severity)));
  const minor = sortWeaknesses(weaknesses.filter((w) => MINOR_SEVERITIES.includes(w.severity)));

  const liftingItems = major.filter((w) => w.category === 'lifting');
  const cyclingItems = major.filter((w) => w.category === 'cycling');
  const minorLifting = minor.filter((w) => w.category === 'lifting');
  const minorCycling = minor.filter((w) => w.category === 'cycling');

  const visibleLifting = showMinor ? [...liftingItems, ...minorLifting] : liftingItems;
  const visibleCycling = showMinor ? [...cyclingItems, ...minorCycling] : cyclingItems;
  const visibleCount = visibleLifting.length + visibleCycling.length;

  const hasCritical = !!summary?.critical;
  const hasHigh = !!summary?.high;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <CardTitle>🎯 Weakness Analysis</CardTitle>
          {summary && (summary.total_weaknesses > 0 || summary.strengths > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {hasCritical && (
                <SummaryBadge count={summary.critical} style={SEVERITY_STYLES.critical} />
              )}
              {hasHigh && <SummaryBadge count={summary.high} style={SEVERITY_STYLES.high} />}
              <SummaryBadge count={summary.medium} style={SEVERITY_STYLES.medium} />
              <SummaryBadge count={summary.low} style={SEVERITY_STYLES.low} />
              <SummaryBadge count={summary.strengths} style={SEVERITY_STYLES.strength} />
            </div>
          )}
        </div>
      </CardHeader>

      {visibleCount === 0 ? (
        <div className="flex items-center gap-3 py-6 justify-center">
          <span className="h-8 w-8 rounded-full bg-positive/20 flex items-center justify-center shrink-0" aria-hidden="true">
            <svg className="h-5 w-5 text-positive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <p className="text-sm text-muted">All metrics balanced — no weaknesses identified</p>
        </div>
      ) : (
        <div className="space-y-5">
          <CategoryGroup title="Strength Training" icon="🏋️" items={visibleLifting} />
          <CategoryGroup title="Cycling" icon="🚴" items={visibleCycling} />

          {minor.length > 0 && (
            <button
              onClick={() => setShowMinor(!showMinor)}
              className="text-xs font-semibold text-muted hover:text-white uppercase tracking-wider transition-colors flex items-center gap-1"
              aria-expanded={showMinor}
            >
              <span>{showMinor ? '▾' : '▸'}</span>{' '}
              {showMinor ? 'Hide minor' : `Show minor (${minor.length})`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
