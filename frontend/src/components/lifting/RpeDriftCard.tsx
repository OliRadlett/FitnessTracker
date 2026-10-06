'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

/**
 * RPE drift — per-session average RPE against the plan's latest programmed
 * target for the exercise. A sustained positive drift is an early
 * overreaching flag. Exercise is required (the endpoint 422s without it).
 */
export function RpeDriftCard() {
  const { authFetch, token } = useAuthFetch();
  const [exercise, setExercise] = useState('');
  const [weeks, setWeeks] = useState(24);

  const name = exercise.trim();
  const params = new URLSearchParams({ weeks: String(weeks) });
  if (name) params.set('exercise_name', name);

  const { data, isLoading } = useQuery<ChartData>({
    queryKey: ['chart-rpe-drift', name, weeks],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/rpe_drift?${params}`),
    enabled: !!token && name !== '',
    staleTime: 300_000,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>RPE Drift</CardTitle>
          <div className="flex items-center gap-3">
            <ExerciseAutocomplete
              value={exercise}
              onChange={setExercise}
              placeholder="Pick an exercise…"
              className="w-48"
            />
            <select
              value={weeks}
              onChange={(e) => setWeeks(parseInt(e.target.value, 10))}
              className="bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Weeks of history"
            >
              <option value={4}>4 weeks</option>
              <option value={8}>8 weeks</option>
              <option value={12}>12 weeks</option>
              <option value={24}>24 weeks</option>
              <option value={52}>52 weeks</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <ChartBody
        isLoading={isLoading}
        data={data}
        emptyMessage={
          name === ''
            ? 'Enter an exercise above to see actual vs planned RPE'
            : 'No rated working sets logged in range'
        }
        height={280}
      />
    </Card>
  );
}
