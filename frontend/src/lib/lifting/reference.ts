import type { LiftingSession, PersonalRecord } from '@/lib/api/types';

// ─── Estimated 1RM (Brzycki) ─────────────────────────────────────────────────

export function brzycki1rm(weightKg: number, reps: number): number | null {
  if (reps <= 0 || reps >= 37 || weightKg <= 0) return null;
  return weightKg * (36 / (37 - reps));
}

export interface ExerciseReference {
  /** ISO date of the session the reference came from */
  date: string;
  sets: { weight_kg: number; reps: number; rpe?: number }[];
}

/**
 * Map of exercise name → most recent session's sets.
 * Sessions must be sorted newest-first (as returned by the API).
 */
export function buildLastSessionMap(
  sessions: LiftingSession[],
  excludeSessionId?: string
): Record<string, ExerciseReference> {
  const map: Record<string, ExerciseReference> = {};
  for (const session of sessions) {
    if (excludeSessionId && session.id === excludeSessionId) continue;
    for (const set of session.sets) {
      if (set.is_warmup) continue;
      if (!map[set.exercise_name]) {
        map[set.exercise_name] = {
          date: session.session_date,
          sets: [],
        };
      }
      const ref = map[set.exercise_name];
      if (!ref.sets.some((s) => s.weight_kg === set.weight_kg && s.reps === set.reps)) {
        ref.sets.push({ weight_kg: set.weight_kg, reps: set.reps, rpe: set.rpe });
      }
    }
  }
  // Cap stored sets per exercise to keep the reference line short
  for (const ref of Object.values(map)) {
    ref.sets = ref.sets.slice(0, 8);
  }
  return map;
}

/** Best estimated 1RM across a user's stored PRs for one exercise. */
function bestPrE1rm(prs: PersonalRecord[], exerciseName: string): number | null {
  let best: number | null = null;
  for (const pr of prs) {
    if (pr.exercise_name !== exerciseName) continue;
    const est = pr.estimated_1rm ?? brzycki1rm(pr.weight_kg, pr.reps);
    if (est !== null && (best === null || est > best)) best = est;
  }
  return best;
}

/**
 * Returns celebration text if this set beats every stored PR for the
 * exercise, otherwise null. Called optimistically at log time — the backend
 * records the actual PR rows during sync.
 */
export function detectPr(
  exerciseName: string,
  weightKg: number,
  reps: number,
  prs: PersonalRecord[] | undefined,
  todaySets: { weight_kg: number; reps: number }[]
): string | null {
  const est = brzycki1rm(weightKg, reps);
  if (est === null) return null;

  // Must also beat everything already logged this session
  for (const s of todaySets) {
    const prior = brzycki1rm(s.weight_kg, s.reps);
    if (prior !== null && prior >= est - 0.01) return null;
  }

  const best = prs ? bestPrE1rm(prs, exerciseName) : null;
  if (best !== null && est <= best * 1.005) return null;
  return `PR! Est. 1RM ${est.toFixed(1)}kg`;
}

/** Recent-exercise chips, most-recently-used first. */
export function recentExerciseNames(sessions: LiftingSession[], limit = 6): string[] {
  const names: string[] = [];
  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.is_warmup) continue;
      if (!names.includes(set.exercise_name)) names.push(set.exercise_name);
      if (names.length >= limit) return names.slice(0, limit);
    }
  }
  return names.slice(0, limit);
}
