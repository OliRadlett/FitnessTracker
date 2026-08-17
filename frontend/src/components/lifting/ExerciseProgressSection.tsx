'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { LiftingSession, ChartData } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';

export function ExerciseProgressSection({ sessions }: { sessions?: LiftingSession[] }) {
  const { authFetch } = useAuthFetch();
  const [selectedExercise, setSelectedExercise] = useState('');
  const [weeks, setWeeks] = useState(12);

  // Derive exercise list from sessions data
  const exerciseList = useMemo(() => {
    if (!sessions) return [];
    const names = new Set<string>();
    for (const session of sessions) {
      for (const set of session.sets || []) {
        names.add(set.exercise_name);
      }
    }
    return Array.from(names).sort();
  }, [sessions]);

  // Auto-select first exercise
  const effectiveExercise = selectedExercise || exerciseList[0] || '';

  const { data: progressChart, isLoading: progressLoading } = useQuery<ChartData>({
    queryKey: ['exercise-progress', effectiveExercise, weeks],
    queryFn: () => authFetch<ChartData>(
      `/api/v1/charts/exercise_progress?exercise_name=${encodeURIComponent(effectiveExercise)}&weeks=${weeks}`
    ),
    enabled: !!effectiveExercise,
  });

  if (exerciseList.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Exercise Progress</CardTitle>
          <div className="flex items-center gap-3">
            <select
              value={effectiveExercise}
              onChange={(e) => setSelectedExercise(e.target.value)}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {exerciseList.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <select
              value={weeks}
              onChange={(e) => setWeeks(parseInt(e.target.value))}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
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
      {progressLoading ? (
        <div className="h-80 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent"></div>
        </div>
      ) : progressChart ? (
        <Chart data={progressChart} height={320} />
      ) : (
        <div className="h-80 flex items-center justify-center text-muted">No progress data available for this exercise</div>
      )}
    </Card>
  );
}
