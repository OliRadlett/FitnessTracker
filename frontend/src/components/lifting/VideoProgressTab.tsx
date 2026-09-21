'use client';

// B-28 VideoProgressTab — cross-video form/velocity/consistency trends per
// exercise, backed by the video_*_trend charts (B-26).

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';

const TRENDS = [
  { key: 'video_form_trend', title: 'Form Score Trend' },
  { key: 'video_velocity_trend', title: 'Velocity Trend' },
  { key: 'video_consistency_trend', title: 'Consistency Trend' },
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {TRENDS.map((t) => (
          <TrendChart key={t.key} chartKey={t.key} title={t.title} exercise={exercise} />
        ))}
      </div>
    </div>
  );
}
