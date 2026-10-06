'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { ExerciseAutocomplete } from '@/components/ui/ExerciseAutocomplete';

/**
 * Rep-range mix — working-set counts in strength (1–3), hypertrophy (4–6)
 * and endurance (7+) bands. Blank exercise = top-8 overview; typing one
 * narrows to the single-exercise triplet. Same backend endpoint both ways.
 */
export function RepRangeCard() {
  const { authFetch, token } = useAuthFetch();
  const [exercise, setExercise] = useState('');
  const [weeks, setWeeks] = useState(24);

  const params = new URLSearchParams({ weeks: String(weeks) });
  if (exercise.trim()) params.set('exercise_name', exercise.trim());

  const { data, isLoading } = useQuery<ChartData>({
    queryKey: ['chart-rep-range', exercise.trim() || 'all', weeks],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/rep_range_distribution?${params}`),
    enabled: !!token,
    staleTime: 300_000,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>Rep Range Mix</CardTitle>
          <div className="flex items-center gap-3">
            <ExerciseAutocomplete
              value={exercise}
              onChange={setExercise}
              placeholder="All exercises"
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
        emptyMessage="No working sets logged in range"
        height={280}
      />
    </Card>
  );
}
