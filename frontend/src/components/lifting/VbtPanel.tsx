'use client';

// VBT load-velocity profile — plots analysed sets (load vs mean concentric
// velocity), fits the lifter's load-velocity line and reads an estimated 1RM
// off the minimal-velocity-threshold crossing.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuthFetch, getVbtProfile } from '@/lib/api';
import type { VbtProfile } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const CONFIDENCE_VARIANT: Record<string, 'positive' | 'muted' | 'warning'> = {
  high: 'positive',
  medium: 'muted',
  low: 'warning',
  insufficient: 'warning',
};

export function VbtPanel({ exercise }: { exercise: string }) {
  const { authFetch, token } = useAuthFetch();
  const { data, isLoading } = useQuery<VbtProfile>({
    queryKey: ['vbt-profile', exercise],
    queryFn: () => getVbtProfile(authFetch, exercise),
    enabled: !!token && exercise.trim().length > 0,
    staleTime: 300_000,
  });

  if (!exercise.trim()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Load–Velocity (VBT)</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted">
          Enter an exercise above and add a load (kg) when uploading videos to see
          your load–velocity profile and estimated 1RM.
        </p>
      </Card>
    );
  }

  const points = data?.points ?? [];
  const hasLine = data?.slope != null && data?.intercept != null;
  const lineData = hasLine
    ? [
        { load_kg: data!.load_min_kg ?? 0, velocity: data!.intercept! + data!.slope! * (data!.load_min_kg ?? 0) },
        { load_kg: data!.load_max_kg ?? 0, velocity: data!.intercept! + data!.slope! * (data!.load_max_kg ?? 0) },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Load–Velocity (VBT)</CardTitle>
        {data && (
          <Badge variant={CONFIDENCE_VARIANT[data.confidence] ?? 'muted'}>
            {data.confidence} confidence
          </Badge>
        )}
      </CardHeader>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : points.length === 0 ? (
        <p className="text-sm text-muted">
          No {exercise} videos with a recorded load yet. Add a load when uploading
          to build your profile.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wide">Est. 1RM</p>
              <p className="text-xl font-bold text-foreground">
                {data?.est_1rm_kg != null ? `${data.est_1rm_kg} kg` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wide">Sets</p>
              <p className="text-xl font-semibold text-foreground">{data?.n ?? 0}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wide">Fit R²</p>
              <p className="text-xl font-semibold text-foreground">
                {data?.r2 != null ? data.r2.toFixed(2) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wide">MVT</p>
              <p className="text-xl font-semibold text-foreground">
                {data?.mvt != null ? `${data.mvt} m/s` : '—'}
              </p>
            </div>
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="load_kg"
                  type="number"
                  domain={['dataMin - 10', 'dataMax + 10']}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Load (kg)', position: 'insideBottom', offset: -4, fontSize: 11 }}
                />
                <YAxis
                  dataKey="velocity"
                  type="number"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Velocity (m/s)', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v: number) => v.toFixed(2)}
                  labelFormatter={(l) => `${l} kg`}
                />
                <Scatter name={exercise} data={points} fill="#3b82f6" />
                {hasLine && (
                  <Line
                    data={lineData}
                    dataKey="velocity"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {data?.mvt != null && (
                  <ReferenceLine
                    y={data.mvt}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: 'MVT', fontSize: 10, fill: '#f59e0b' }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted">
            Estimated 1RM is the load where the fitted line crosses the minimal
            velocity threshold (MVT) — no true max attempt needed.
          </p>
        </div>
      )}
    </Card>
  );
}
