'use client';

import React from 'react';
import type {
  WhoopWeeklySummary,
  RespiratoryRateResponse,
  Activity,
  LiftingSession,
} from '@/lib/api';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonRow } from '@/components/ui/Skeleton';

/* ── Helpers ────────────────────────────────────────────────────────────── */

export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ── Compact Metric Card ────────────────────────────────────────────────── */

export function MetricCard({ label, value, subtitle, color, icon }: {
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon?: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4 hover:border-surface-light transition-colors">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-base">{icon}</span>}
        <p className="text-xs font-medium text-muted uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color} leading-none`}>{value}</p>
      {subtitle && <p className="text-xs text-muted mt-1.5">{subtitle}</p>}
    </div>
  );
}

/* ── Trend Arrow ────────────────────────────────────────────────────────── */

export function TrendArrow({ trend }: { trend?: 'up' | 'down' | 'stable' | null }) {
  if (!trend || trend === 'stable') return <span className="text-muted">→</span>;
  if (trend === 'up') return <span className="text-positive">↑</span>;
  return <span className="text-warning">↓</span>;
}

/* ── Whoop Weekly Card ──────────────────────────────────────────────────── */

export function WhoopWeeklyCard({ data }: { data: WhoopWeeklySummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🩺 Whoop Weekly</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted mb-1">Avg Recovery</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-green-400">
              {data.avg_recovery?.toFixed(0) ?? '—'}%
            </p>
            <TrendArrow trend={data.avg_recovery_trend} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">Avg Sleep</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-blue-400">
              {data.avg_sleep_hours?.toFixed(1) ?? '—'}h
            </p>
            <TrendArrow trend={data.avg_sleep_trend} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">Total Strain</p>
          <div className="flex items-center gap-1">
            <p className="text-xl font-bold text-orange-400">
              {data.total_strain?.toFixed(1) ?? '—'}
            </p>
            <TrendArrow trend={data.total_strain_trend} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">Sleep Consistency</p>
          <p className="text-xl font-bold text-purple-400">
            {data.sleep_consistency?.toFixed(0) ?? '—'}%
          </p>
        </div>
      </div>
      {(data.best_recovery_day || data.worst_recovery_day) && (
        <div className="flex gap-4 mt-4 pt-3 border-t border-white/5 text-xs">
          {data.best_recovery_day && (
            <div>
              <span className="text-muted">Best: </span>
              <span className="text-green-400">
                {new Date(data.best_recovery_day.date).toLocaleDateString(undefined, { weekday: 'short' })} ({data.best_recovery_day.score?.toFixed(0)}%)
              </span>
            </div>
          )}
          {data.worst_recovery_day && (
            <div>
              <span className="text-muted">Worst: </span>
              <span className="text-red-400">
                {new Date(data.worst_recovery_day.date).toLocaleDateString(undefined, { weekday: 'short' })} ({data.worst_recovery_day.score?.toFixed(0)}%)
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Respiratory Rate Card ──────────────────────────────────────────────── */

export function RespiratoryRateCard({ data }: { data: RespiratoryRateResponse }) {
  const trendColor = data.trend === 'elevated' ? 'text-warning' : data.trend === 'low' ? 'text-blue-400' : 'text-positive';
  const trendArrow = data.trend === 'elevated' ? '↑' : data.trend === 'low' ? '↓' : '→';

  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
      <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">🫁 Resp. Rate</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-2xl font-bold ${trendColor} leading-none`}>
          {data.current_rr?.toFixed(1) ?? '—'}
        </p>
        <span className={`text-lg ${trendColor}`}>{trendArrow}</span>
      </div>
      <p className="text-xs text-muted mt-1.5">
        {data.baseline_avg_rr
          ? `Baseline: ${data.baseline_avg_rr.toFixed(1)} bpm`
          : 'Collecting baseline...'}
      </p>
      {data.trend === 'elevated' && (
        <p className="text-xs text-warning mt-1">⚠️ Above normal range</p>
      )}
    </div>
  );
}

/* ── Activity Row ───────────────────────────────────────────────────────── */

export function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <div className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <Badge variant={getSportBadgeVariant(activity.sport_type)}>
          {activity.sport_type}
        </Badge>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{activity.name}</p>
          <p className="text-xs text-muted">
            {new Date(activity.start_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        {activity.distance_meters && !['weighttraining', 'workout', 'crossfit', 'strength_training'].includes(activity.sport_type) && (
          <p className="text-sm text-slate-300">{formatDistance(activity.distance_meters)}</p>
        )}
        {activity.duration_seconds && (
          <p className="text-xs text-muted">{formatDuration(activity.duration_seconds)}</p>
        )}
      </div>
    </div>
  );
}

/* ── Session Row ────────────────────────────────────────────────────────── */

export function SessionRow({ session }: { session: LiftingSession }) {
  return (
    <div className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
      <div>
        <p className="text-sm font-medium text-white">{session.focus || 'General'}</p>
        <p className="text-xs text-muted">
          {new Date(session.session_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm text-purple-400">
          {session.sets?.length ?? 0} sets
        </p>
        {session.total_volume_kg !== undefined && (
          <p className="text-xs text-muted">
            {session.total_volume_kg.toLocaleString()} kg vol
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Skeleton Loaders ───────────────────────────────────────────────────── */

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-label="Loading data">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
