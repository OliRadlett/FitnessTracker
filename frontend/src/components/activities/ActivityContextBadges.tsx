'use client';

import React from 'react';
import type { LoadContext, RideMetrics } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { formatTSB } from '@/lib/utils';

interface ActivityContextBadgesProps {
  context: {
    sport_type: string;
    ride_metrics: RideMetrics | null;
    load_context: LoadContext | null;
  };
}

/**
 * QW4 — tiny TSS provenance badge: power-TSS vs hrTSS are not comparable when
 * HR substitutes silently. Renders next to the TSS value; null source → no badge.
 */
export function TssSourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  switch (source) {
    case 'power':
      return (
        <span
          className="inline-flex items-center text-[10px] px-1 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/30"
          title="Power-based TSS"
        >
          ⚡P
        </span>
      );
    case 'hr':
      return (
        <span
          className="inline-flex items-center text-[10px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30"
          title="HR-estimated TSS — less precise"
        >
          ~H
        </span>
      );
    case 'provider':
      return (
        <span
          className="inline-flex items-center text-[10px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30"
          title="TSS from provider (Strava/Wahoo/etc.)"
        >
          ⧉P
        </span>
      );
    case 'manual':
      return (
        <span
          className="inline-flex items-center text-[10px] px-1 py-0.5 rounded bg-surface-light/40 text-muted border border-surface-light/60"
          title="Manually entered TSS"
        >
          ✎M
        </span>
      );
    default:
      return null;
  }
}

export function ActivityContextBadges({ context }: ActivityContextBadgesProps) {
  const { ride_metrics, load_context, sport_type } = context;
  const isCycling = sport_type === 'cycling';

  const items: React.ReactNode[] = [];

  // Load context (ATL/CTL/TSB)
  if (load_context) {
    const { atl, ctl, tsb } = load_context;
    let tsbColor = 'text-blue-400';
    if (tsb !== undefined) {
      if (tsb > 25) { tsbColor = 'text-positive'; }
      else if (tsb < -30) { tsbColor = 'text-warning'; }
    }
    items.push(
      <span
        key="load"
        className={`text-xs text-muted whitespace-nowrap inline-flex items-center gap-1 ${tsbColor}`}
        title={`ATL ${atl?.toFixed(0) ?? '—'} · CTL ${ctl?.toFixed(0) ?? '—'} · TSB ${formatTSB(tsb)}`}
      >
        <span aria-hidden>📊</span> ATL {atl?.toFixed(0) ?? '—'} · CTL {ctl?.toFixed(0) ?? '—'} · TSB {formatTSB(tsb)}
      </span>
    );
  }

  // Ride-specific analytical metrics
  if (isCycling && ride_metrics) {
    const rm = ride_metrics;

    // QW4 — TSS value with provenance badge (power vs HR vs provider).
    if (rm.tss !== undefined && rm.tss !== null) {
      items.push(
        <span key="tss" className="text-xs text-blue-400 whitespace-nowrap inline-flex items-center gap-1">
          ⚡ {Math.round(rm.tss)} TSS
          <TssSourceBadge source={rm.tss_source} />
        </span>
      );
    }

    if (rm.intensity_factor !== undefined && rm.intensity_factor !== null) {
      let intensityLabel = '';
      const ifVal = rm.intensity_factor;
      if (ifVal < 0.75) intensityLabel = 'Easy';
      else if (ifVal < 0.90) intensityLabel = 'Endurance';
      else if (ifVal < 1.05) intensityLabel = 'Tempo/Threshold';
      else if (ifVal < 1.20) intensityLabel = 'VO2max';
      else intensityLabel = 'Anaerobic';

      items.push(
        <Badge key="if" variant="default" className="text-xs">
          IF {ifVal.toFixed(2)} · {intensityLabel}
        </Badge>
      );
    }

    if (rm.variability_index !== undefined && rm.variability_index !== null) {
      const vi = rm.variability_index;
      let viColor = 'text-muted';
      if (vi < 1.05) viColor = 'text-positive';
      else if (vi < 1.10) viColor = 'text-green-400';
      else if (vi < 1.20) viColor = 'text-yellow-400';
      else viColor = 'text-warning';
      items.push(
        <span key="vi" className={`text-xs text-muted whitespace-nowrap inline-flex items-center gap-1 ${viColor}`}>
          VI {vi.toFixed(2)}
        </span>
      );
    }

    if (rm.decoupling_pct !== undefined && rm.decoupling_pct !== null) {
      const decColor = rm.decoupling_pct < 3 ? 'text-positive' :
                       rm.decoupling_pct < 5 ? 'text-yellow-400' : 'text-warning';
      items.push(
        <span key="decoupling" className={`text-xs text-muted whitespace-nowrap inline-flex items-center gap-1 ${decColor}`}>
          ⚡ {rm.decoupling_pct.toFixed(1)}%
          {rm.decoupling_class && (
            <span className="hidden sm:inline">({rm.decoupling_class})</span>
          )}
        </span>
      );
    }

    if (rm.top_speed_kmh !== undefined && rm.top_speed_kmh !== null) {
      items.push(
        <span key="topspeed" className="text-xs text-muted whitespace-nowrap">
          🏁 {rm.top_speed_kmh.toFixed(1)} km/h
        </span>
      );
    }

    if (rm.climbing_meters !== undefined && rm.climbing_meters !== null && rm.climbing_meters > 0) {
      items.push(
        <span key="climb" className="text-xs text-muted whitespace-nowrap">
          ⛰️ {Math.round(rm.climbing_meters)}m
        </span>
      );
    }

    if (rm.efficiency_factor !== undefined && rm.efficiency_factor !== null) {
      items.push(
        <span key="ef" className="text-xs text-muted whitespace-nowrap">
          EF {rm.efficiency_factor.toFixed(2)}
        </span>
      );
    }
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {items}
    </div>
  );
}
