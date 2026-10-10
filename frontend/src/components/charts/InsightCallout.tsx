'use client';

import React from 'react';

/**
 * One shared insight line for every chart (Phase 3 data-viz system,
 * ui-redesign-v2 §3.3) — replaces the ad-hoc 💡 lines that lived inside
 * `Chart` (`InsightsList`) and `ChartCard` (header `insight`).
 *
 * Presentational only: renders strings, never computes them.
 */
export function InsightCallout({ children }: { children: React.ReactNode }) {
  if (children == null) return null;
  if (Array.isArray(children) && children.length === 0) return null;
  return (
    <p className="text-xs text-muted flex items-start gap-1.5">
      <span className="text-accent mt-0.5" aria-hidden="true">
        💡
      </span>
      <span>{children}</span>
    </p>
  );
}

/** Backend `ChartData.insights` block rendered under a chart. */
export function ChartInsights({ insights }: { insights?: string[] }) {
  if (!insights || insights.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {insights.map((insight, i) => (
        <InsightCallout key={i}>{insight}</InsightCallout>
      ))}
    </div>
  );
}
