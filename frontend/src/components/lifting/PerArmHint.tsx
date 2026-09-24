'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ExerciseSuggestion } from '@/lib/api';

/**
 * Per-arm weight hint — renders a small pill when the given exercise is a
 * bilateral move logged per implement (one dumbbell/handle, never the
 * combined total). Renders nothing for total-convention exercises or when
 * the exercise isn't in the library. Convention comes from the backend
 * (`weight_convention` on exercise search) so frontend/backend can't drift.
 */
export function PerArmHint({ exerciseName }: { exerciseName: string }) {
  const { authFetch, token } = useAuthFetch();
  const name = exerciseName.trim();

  const { data } = useQuery<ExerciseSuggestion[]>({
    queryKey: ['exercise-convention', name.toLowerCase()],
    queryFn: () =>
      authFetch<ExerciseSuggestion[]>(
        `/api/v1/lifting/exercises?q=${encodeURIComponent(name)}&limit=10`,
      ),
    enabled: !!token && name.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const convention = data?.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  )?.weight_convention;

  if (convention !== 'per_arm') return null;

  return (
    <p
      className="text-xs text-accent bg-accent/10 border border-accent/30 rounded-lg px-2.5 py-1.5"
      title="Log the weight of ONE dumbbell/handle — not both added together"
    >
      ⚖️ Per-arm: log one dumbbell, not the combined total
    </p>
  );
}
