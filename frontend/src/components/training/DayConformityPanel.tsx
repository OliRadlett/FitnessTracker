'use client';

/**
 * DayConformityPanel — Phase 5C expanded plan-vs-actual detail for one day.
 *
 * Rendered at the bottom of WeeklyView's expanded day panel. Fetches
 * GET /training-plans/{id}/days/{dayId}/conformity lazily via the
 * ['day-conformity', dayId] query (only mounted when the panel is open),
 * and shows:
 *   - ConformityBadge + classification header
 *   - weighted component table (planned → actual, deviation, weight, score bar)
 *   - deviation notes in a warning-tinted list
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  TrainingWeekDay,
  DayConformityResponse,
  ConformityComponent,
} from '@/lib/api';
import { useAuthFetch, getDayConformity } from '@/lib/api';
import { ConformityBadge } from './ConformityBadge';

// ─── Metric presentation ──────────────────────────────────────────────────

const METRIC_META: Record<string, { label: string; unit?: string }> = {
  duration: { label: 'Duration', unit: 'min' },
  power: { label: 'Avg Power', unit: 'W' },
  hr: { label: 'Avg HR', unit: 'bpm' },
  tss: { label: 'TSS' },
  route: { label: 'Route' },
  volume: { label: 'Volume', unit: 'kg' },
  exercises: { label: 'Exercises', unit: '%' },
  rpe: { label: 'RPE' },
  focus: { label: 'Focus' },
};

function metricLabel(metric: string): string {
  return METRIC_META[metric]?.label ?? metric.charAt(0).toUpperCase() + metric.slice(1);
}

/** Format a planned/actual value with its unit; route scores are 0/0.5/1 ratios. */
function fmtMetricValue(metric: string, v: number | null | undefined): string {
  if (v == null) return '—';
  if (metric === 'route') return `${Math.round(v > 1 ? v : v * 100)}%`;
  const unit = METRIC_META[metric]?.unit;
  switch (unit) {
    case 'W':
      return `${Math.round(v)}W`;
    case 'kg':
      return `${Math.round(v)}kg`;
    case 'min':
      return `${Math.round(v)}min`;
    case '%':
      return `${Math.round(v)}%`;
    case 'bpm':
      return `${Math.round(v)}bpm`;
    default:
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
}

function deviationColor(deviationPct: number | null): string {
  if (deviationPct == null || deviationPct === 0) return 'text-muted';
  return deviationPct > 0 ? 'text-red-400' : 'text-blue-300';
}

function fmtDeviation(deviationPct: number | null): string {
  if (deviationPct == null) return '—';
  const sign = deviationPct > 0 ? '+' : '';
  return `${sign}${Math.round(deviationPct)}%`;
}

function scoreBarColor(score: number): string {
  if (score >= 0.9) return 'bg-positive';
  if (score >= 0.7) return 'bg-warning';
  if (score >= 0.5) return 'bg-orange-400';
  return 'bg-red-400';
}

/** Status-appropriate message when there is no conformity score to show. */
function emptyMessage(status: DayConformityResponse['status']): string {
  switch (status) {
    case 'rest':
      return 'Nothing planned';
    case 'pending':
      return 'Not yet logged';
    case 'missed':
      return 'Missed — no activity logged';
    case 'extra':
      return 'Extra session — nothing was planned';
    default:
      return 'No conformity data yet';
  }
}

// ─── Component ────────────────────────────────────────────────────────────

interface DayConformityPanelProps {
  planId: string;
  day: TrainingWeekDay;
  /** Defaults true — WeeklyView only mounts this panel when expanded. */
  open?: boolean;
}

export function DayConformityPanel({ planId, day, open = true }: DayConformityPanelProps) {
  const { token } = useAuthFetch();

  // Lazy per-day scoring — only fetched while the panel is open.
  const query = useQuery({
    queryKey: ['day-conformity', day.id],
    queryFn: () => getDayConformity(planId, day.id, token),
    staleTime: 60_000,
    enabled: open && !!token,
  });

  const data = query.data;

  return (
    <div className="rounded-lg bg-surface-light/30 border border-surface-light/50 p-2 space-y-2">
      <p className="text-[10px] font-medium text-muted uppercase tracking-wide">Conformity</p>

      {/* Loading skeleton */}
      {(query.isLoading || (!data && query.isFetching)) && (
        <div className="space-y-1.5" aria-busy="true">
          <div className="h-3 w-24 rounded bg-surface-light animate-pulse" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 w-full rounded bg-surface-light animate-pulse" />
          ))}
        </div>
      )}

      {query.isError && (
        <p className="text-[11px] text-red-400">
          Failed to load conformity: {(query.error as Error).message}
        </p>
      )}

      {/* Header: badge + classification */}
      {data && (
        <>
          <div className="flex items-center gap-2">
            <ConformityBadge
              status={data.status}
              pct={data.conformity_pct}
              classification={data.classification}
            />
            <span className="text-[11px] text-white font-medium">
              {data.classification ??
                (data.conformity_pct != null ? `${Math.round(data.conformity_pct)}%` : '')}
            </span>
            <span className="text-[10px] text-muted">
              ({data.planned_type}
              {data.sport !== 'rest' ? ` · ${data.sport}` : ''})
            </span>
          </div>

          {/* No-score message */}
          {data.conformity_pct == null ? (
            <p className="text-[11px] text-muted italic">{emptyMessage(data.status)}</p>
          ) : (
            /* Components table */
            data.components.length > 0 && (
              <table className="w-full text-[10px] text-muted">
                <thead>
                  <tr className="text-left">
                    <th className="font-medium">Metric</th>
                    <th className="font-medium">Plan → Actual</th>
                    <th className="font-medium">Dev</th>
                    <th className="font-medium">Weight</th>
                    <th className="font-medium w-14">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.components.map((c: ConformityComponent) => (
                    <tr key={c.metric} className="border-t border-surface-light/30">
                      <td className="py-0.5 text-white/90">{metricLabel(c.metric)}</td>
                      <td className="py-0.5 whitespace-nowrap">
                        {fmtMetricValue(c.metric, c.planned)} →{' '}
                        <span className="text-white/90">{fmtMetricValue(c.metric, c.actual)}</span>
                      </td>
                      <td className={`py-0.5 ${deviationColor(c.deviation_pct)}`}>
                        {fmtDeviation(c.deviation_pct)}
                      </td>
                      <td className="py-0.5">{Math.round(c.weight_used * 100)}%</td>
                      <td className="py-0.5">
                        <div className="h-1.5 w-full rounded-full bg-surface-light overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              c.component_score != null ? scoreBarColor(c.component_score) : ''
                            }`}
                            style={{ width: `${(c.component_score ?? 0) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* Deviations */}
          {data.deviations.length > 0 && (
            <ul className="space-y-0.5">
              {data.deviations.map((d, i) => (
                <li key={i} className="text-[10px] text-warning flex gap-1">
                  <span className="shrink-0">→</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
