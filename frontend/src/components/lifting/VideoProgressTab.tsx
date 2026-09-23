'use client';

// B-28 VideoProgressTab — cross-video form/velocity/consistency trends per
// exercise, backed by the video_*_trend charts (B-26).

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ChartBody } from '@/components/charts/Chart';
import { VbtPanel } from '@/components/lifting/VbtPanel';

const CONTROL_METRICS = [
  { key: 'form', label: 'Form score' },
  { key: 'velocity', label: 'Bar speed' },
  { key: 'consistency', label: 'Rep consistency' },
  { key: 'bar_path', label: 'Bar-path consistency' },
  { key: 'sticking_point', label: 'Sticking point' },
] as const;

interface ControlResult {
  metric: string;
  n: number;
  mean: number | null;
  sigma: number | null;
  ucl: number | null;
  lcl: number | null;
  latest: number | null;
  z: number | null;
  status: 'insufficient' | 'normal' | 'above' | 'below';
}

function ControlCard({ exercise }: { exercise: string }) {
  const { authFetch, token } = useAuthFetch();
  const [metric, setMetric] = useState<string>('form');
  const params = new URLSearchParams({ metric });
  if (exercise) params.set('exercise_name', exercise);
  const { data, isLoading } = useQuery<ControlResult>({
    queryKey: ['control', metric, exercise],
    queryFn: () => authFetch<ControlResult>(`/api/v1/charts/control?${params.toString()}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const badge =
    data?.status === 'above'
      ? { label: 'Shifted high', variant: 'warning' as const }
      : data?.status === 'below'
        ? { label: 'Shifted low', variant: 'warning' as const }
        : data?.status === 'normal'
          ? { label: 'Stable', variant: 'positive' as const }
          : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Process control</CardTitle>
      </CardHeader>
      <div className="p-3 space-y-2">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label="Control-chart metric"
          className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {CONTROL_METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !data || data.status === 'insufficient' ? (
          <p className="text-sm text-muted">
            Not enough history yet — control limits need ≥5 analysed sessions.
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted">Latest ({data.n} sessions)</span>
              <span className="flex items-center gap-2 text-foreground">
                {data.latest}
                {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
              </span>
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>Mean ± σ</span>
              <span>
                {data.mean} ± {data.sigma}
              </span>
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>Control limits</span>
              <span>
                {data.lcl} – {data.ucl}
              </span>
            </div>
            <p className="text-[11px] text-muted">
              A latest value outside the limits is a real change, not week-to-week noise.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

const TRENDS = [
  { key: 'video_form_trend', title: 'Form Score Trend' },
  { key: 'video_velocity_trend', title: 'Velocity Trend' },
  { key: 'video_consistency_trend', title: 'Consistency Trend' },
  { key: 'video_bar_path_trend', title: 'Bar-path Consistency' },
  { key: 'video_sticking_point_trend', title: 'Sticking Point' },
] as const;

function TrendChart({ chartKey, title, exercise }: { chartKey: string; title: string; exercise: string }) {
  const { authFetch, token } = useAuthFetch();
  const params = exercise ? `?exercise_name=${encodeURIComponent(exercise)}` : '';
  const { data, isLoading } = useQuery<ChartData>({
    queryKey: ['chart', chartKey, exercise],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/${chartKey}${params}`),
    staleTime: 300_000,
    enabled: !!token,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <ChartBody
        isLoading={isLoading}
        data={data}
        emptyMessage={exercise ? `No analyzed ${exercise} videos yet` : 'Analyze some videos to see trends'}
        height={240}
      />
    </Card>
  );
}

export function VideoProgressTab({ initialExercise = '' }: { initialExercise?: string }) {
  const [exercise, setExercise] = useState(initialExercise);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          placeholder="Exercise (blank = all)"
          className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label="Exercise filter for progress trends"
        />
      </div>
      <VbtPanel exercise={exercise} />
      <ControlCard exercise={exercise} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {TRENDS.map((t) => (
          <TrendChart key={t.key} chartKey={t.key} title={t.title} exercise={exercise} />
        ))}
      </div>
    </div>
  );
}
