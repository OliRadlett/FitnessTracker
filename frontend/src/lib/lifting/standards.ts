// Strength standards — client mirror of `backend/app/services/deficiency.py`
// STANDARDS (Symmetric Strength / StrengthLevel tradition, male-calibrated
// bodyweight multipliers). Keep the two in sync: the ratio badges rendered
// here must agree with the DeficiencyCard findings from that engine.

export type StandardLevel = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export const LEVEL_ORDER: StandardLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
  'elite',
];

export const STANDARDS: Record<string, Record<StandardLevel, number>> = {
  'Back Squat': { beginner: 1.0, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
  'Bench Press': { beginner: 0.6, intermediate: 1.0, advanced: 1.4, elite: 1.8 },
  'Deadlift': { beginner: 1.2, intermediate: 1.75, advanced: 2.4, elite: 3.0 },
};

/** Canonical standards key for an exercise name, or null when it has no band. */
export function standardKeyFor(exerciseName: string): string | null {
  if (STANDARDS[exerciseName]) return exerciseName;
  const lowered = exerciseName.toLowerCase();
  if (lowered.includes('squat')) return 'Back Squat';
  if (lowered.includes('bench')) return 'Bench Press';
  if (lowered.includes('deadlift')) return 'Deadlift';
  return null;
}

/** e1RM as a multiple of bodyweight. Null-safe: null when either is missing. */
export function ratioToBodyweight(
  e1rmKg: number | null | undefined,
  bodyweightKg: number | null | undefined,
): number | null {
  if (e1rmKg == null || bodyweightKg == null || bodyweightKg <= 0) return null;
  return e1rmKg / bodyweightKg;
}

/** Highest standard level whose threshold the ratio meets, else 'beginner'. */
export function levelForRatio(lift: string, ratioToBw: number): StandardLevel {
  const thresholds = STANDARDS[lift];
  for (let i = LEVEL_ORDER.length - 1; i >= 0; i--) {
    if (ratioToBw >= thresholds[LEVEL_ORDER[i]]) return LEVEL_ORDER[i];
  }
  return 'beginner';
}

/** Bodyweight multiplier of the next level up, or null when already elite. */
export function nextLevelTarget(lift: string, level: StandardLevel): number | null {
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx < 0 || idx >= LEVEL_ORDER.length - 1) return null;
  return STANDARDS[lift][LEVEL_ORDER[idx + 1]];
}

// ── Dots scoring ─────────────────────────────────────────────────────────────
// Dots = Total × 500 / (a·BW⁴ + b·BW³ + c·BW² + d·BW + e).
// Official coefficients (user-confirmed, 2026-10-06). Both sexes are stored;
// the UI uses the male formula only (no sex field exists in the schema — see
// plan §8) and says so on the card.

export type DotsSex = 'male' | 'female';

const DOTS_MEN = {
  a: -0.000001093, b: 0.0007391293, c: -0.1918759221, d: 24.0900756, e: -307.75076,
};
const DOTS_WOMEN = {
  a: -0.0000010706, b: 0.0005158568, c: -0.1126655495, d: 13.6175032, e: -57.96288,
};

/** Dots score for a total at a bodyweight. Null-safe: null on bad inputs. */
export function dots(
  totalKg: number | null | undefined,
  bodyweightKg: number | null | undefined,
  sex: DotsSex = 'male',
): number | null {
  if (totalKg == null || bodyweightKg == null || totalKg <= 0 || bodyweightKg <= 0) {
    return null;
  }
  const k = sex === 'female' ? DOTS_WOMEN : DOTS_MEN;
  const x = bodyweightKg;
  const denom =
    k.a * x * x * x * x + k.b * x * x * x + k.c * x * x + k.d * x + k.e;
  if (!(denom > 0)) return null;
  return (500 * totalKg) / denom;
}
