'use client';

import React from 'react';
import type { ActivityContext } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';

interface ActivityContextBadgesProps {
  context: ActivityContext;
}

export function ActivityContextBadges({ context }: ActivityContextBadgesProps) {
  const { ride_metrics, load_context, sport_type } = context;
  const isCycling = sport_type === 'cycling';

  const items: React.ReactNode[] = [];

  // Load context (ATL/CTL/TSB)
  if (load_context) {
    const { atl, ctl, tsb } = load_context;
    let tsbLabel = 'Neutral';
    let tsbColor = 'text-blue-400';
    if (tsb !== undefined) {
      if (tsb > 25) { tsbLabel = 'Fresh'; tsbColor = 'text-positive'; }
      else if (tsb < -30) { tsbLabel = 'Fatigued'; tsbColor = 'text-warning'; }
    }
    items.push(
      <span
        key="load"
        className={`text-xs text-muted whitespace-nowrap inline-flex items-center gap-1 ${tsbColor}`}
        title={`ATL ${atl?.toFixed(0) ?? '—'} · CTL ${ctl?.toFixed(0) ?? '—'} · TSB ${tsb?.toFixed(0) ?? '—'}`}
      >
        <span aria-hidden>📊</span> ATL {atl?.toFixed(0) ?? '—'} · CTL {ctl?.toFixed(0) ?? '—'} · TSB {tsb?.toFixed(0) ?? '—'}
      </span>
    );
  }

  // Ride-specific analytical metrics
  if (isCycling && ride_metrics) {
    const rm = ride_metrics;

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
