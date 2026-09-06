import type { LiftingSession, PersonalRecord } from '@/lib/api/types';

// ─── Estimated 1RM (Brzycki) ─────────────────────────────────────────────────

export function brzycki1rm(weightKg: number, reps: number): number | null {
  if (reps <= 0 || reps >= 37 || weightKg <= 0) return null;
  return weightKg * (36 / (37 - reps));
}

export interface ExerciseReference {
  /** ISO date of the session the reference came from */
  date: string;
  /** Most recent non-warmup set for this exercise — the prefill target. */
  lastSet: { weight_kg: number; reps: number; rpe?: number };
  sets: { weight_kg: number; reps: number; rpe?: number }[];
}

/**
 * Map of exercise name → most recent session's sets.
 * Sessions must be sorted newest-first (as returned by the API).
 */
/** ISO date (YYYY-MM-DD) `days` ago, local calendar day. */
function dateDaysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Map of exercise name → most recent session's sets.
 * Sessions must be sorted newest-first (as returned by the API).
 *
 * Only sessions within `withinDays` contribute — a stale month-old prescription
 * must not prefill a deconditioned lifter as if it were current. Falls back to
 * having no reference (rather than an out-of-window one) for rarely-performed
 * exercises.
 */
export function buildLastSessionMap(
  sessions: LiftingSession[],
  excludeSessionId?: string,
  withinDays = 84
): Record<string, ExerciseReference> {
  const cutoff = dateDaysAgoIso(withinDays);
  const map: Record<string, ExerciseReference> = {};
  for (const session of sessions) {
    if (excludeSessionId && session.id === excludeSessionId) continue;
    if (session.session_date < cutoff) continue;
    for (const set of session.sets) {
      if (set.is_warmup) continue;
      const ref = map[set.exercise_name];
      if (!ref) {
        map[set.exercise_name] = {
          date: session.session_date,
          lastSet: { weight_kg: set.weight_kg, reps: set.reps, rpe: set.rpe },
          sets: [],
        };
      }
      // lastSet must be the *true* most-recent set of the most-recent session,
      // so a repeated (weight,reps) pair in that session still prefills the
      // same value rather than an older pair.
      map[set.exercise_name].lastSet = {
        weight_kg: set.weight_kg,
        reps: set.reps,
        rpe: set.rpe,
      };
      const display = map[set.exercise_name].sets;
      if (!display.some((s) => s.weight_kg === set.weight_kg && s.reps === set.reps)) {
        display.push({ weight_kg: set.weight_kg, reps: set.reps, rpe: set.rpe });
      }
    }
  }
  // Cap stored sets per exercise to keep the reference line short, but keep the
  // heaviest working sets so a long ramp never pushes the top prescription off
  // the summary line.
  for (const ref of Object.values(map)) {
    if (ref.sets.length > 8) {
      ref.sets = [...ref.sets]
        .sort((a, b) => b.weight_kg * b.reps - a.weight_kg * a.reps)
        .slice(0, 8)
        .sort((a, b) => ref.sets.indexOf(a) - ref.sets.indexOf(b));
    }
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
