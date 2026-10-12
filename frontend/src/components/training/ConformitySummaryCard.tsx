'use client';

/**
 * ConformitySummaryCard — V3 plan conformity summary (Phase 5C strip).
 *
 * Extracted from WeeklyView so the training surface can present plan
 * adherence (overall %, trend, per-sport chips, detected patterns) as a
 * standalone card above the weekly master bar.
 */

import React from 'react';
import { TrendingUp, TrendingDown, Clock, Link as LinkIcon } from 'lucide-react';
import type { PlanConformityResponse } from '@/lib/api';
import { SPORT_ICON } from './dayCellShared';

const TREND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  improving: TrendingUp,
  declining: TrendingDown,
  stable: Clock,
};

export interface ConformitySummaryCardProps {
  conformity: PlanConformityResponse | null;
  /** [sport, pct] pairs for the per-sport chips. */
  sportChips: [string, number][];
  onLinkActivities: () => void;
  linking: boolean;
}

export function ConformitySummaryCard({
  conformity,
  sportChips,
  onLinkActivities,
  linking,
}: ConformitySummaryCardProps) {
  if (!conformity) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-surface-light/30 border border-surface-light/50">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Conformity
        </span>
        {conformity.overall_pct != null ? (
          <span className="flex items-baseline gap-1">
            <span
              className={`text-xl font-bold leading-none ${
                conformity.overall_pct >= 80
                  ? 'text-positive'
                  : conformity.overall_pct >= 60
                    ? 'text-warning'
                    : 'text-warning'
              }`}
            >
              {Math.round(conformity.overall_pct)}%
            </span>
            <span className="text-[10px] text-muted">overall</span>
          </span>
        ) : (
          <span className="text-xs text-muted italic">No scored days yet</span>
        )}
        {conformity.trend && TREND_ICON[conformity.trend] && (
          <span
            title={`${conformity.trend} vs previous weeks`}
            className="text-base"
          >
            {React.createElement(TREND_ICON[conformity.trend], { className: 'w-4 h-4' })}
          </span>
        )}
        {sportChips.map(([sport, pct]) => (
          <span
            key={sport}
            className="inline-flex items-center gap-1 text-xs text-foreground bg-surface-light/60 rounded-full px-2 py-0.5"
            title={`${sport} adherence`}
          >
            {(() => { const Icon = SPORT_ICON[sport]; return Icon ? <Icon className="w-3 h-3" /> : null; })()}
            <span className="font-medium">{Math.round(pct)}%</span>
          </span>
        ))}
        <button
          onClick={onLinkActivities}
          disabled={linking}
          title="Auto-link synced activities/lifting sessions to plan days"
          className="ml-auto px-2 py-0.5 text-[10px] rounded-lg bg-surface-light/60 text-muted hover:text-foreground hover:bg-surface-light transition-colors disabled:opacity-40"
        >
          {linking ? 'Linking…' : <><LinkIcon className="w-3 h-3" /> Link activities</>}
        </button>
      </div>

      {/* Detected patterns — subtle warning-tinted callout */}
      {conformity.patterns.length > 0 && (
        <div className="rounded-lg bg-warning/5 border border-warning/20 px-3 py-2">
          <ul className="space-y-0.5">
            {conformity.patterns.map((p, i) => (
              <li key={i} className="text-[11px] text-warning/90 flex gap-1.5">
                <span className="shrink-0">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
