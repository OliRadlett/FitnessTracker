/**
 * Adaptive performance budget for the Relive viewer (next-level Phase C).
 *
 * Phones vary wildly; rather than asking users to find quality settings, the
 * viewer measures itself once it is fully loaded and steps down to a reduced
 * profile a single time when the frame rate misses. One-shot by design — it
 * never oscillates, and the user can always re-enable individual effects
 * afterwards (nothing re-degrades behind their back).
 *
 * Pure — unit-tested. The component owns applying the profile.
 */

/** Frames observed before judging (150 ≈ 2.5 s at 60 fps). */
export const PERF_WARMUP_FRAMES = 150;
/** Sustained fps below this triggers the reduced profile. */
export const PERF_MIN_FPS = 45;

export interface PerfBudget {
  frames: number;
  totalMs: number;
  assessed: boolean;
}

export function createPerfBudget(): PerfBudget {
  return { frames: 0, totalMs: 0, assessed: false };
}

/**
 * Feed one frame's delta. Returns the assessed fps exactly once (after the
 * warmup window), else null. Callers gate on scene readiness — loading jank
 * must never count toward the verdict.
 */
export function perfObserve(budget: PerfBudget, dtMs: number): number | null {
  if (budget.assessed) return null;
  if (!(dtMs > 0)) return null;
  budget.frames += 1;
  budget.totalMs += Math.min(dtMs, 100);
  if (budget.frames < PERF_WARMUP_FRAMES) return null;
  budget.assessed = true;
  return 1000 / (budget.totalMs / budget.frames);
}

/** True when the assessed fps misses the bar. */
export function perfNeedsDegrade(fps: number, minFps = PERF_MIN_FPS): boolean {
  return fps < minFps;
}

/**
 * Whether the OS asks for reduced motion (SSR-safe: false without window).
 * The viewer honours it by holding the auto-orbit static, skipping camera
 * banking, speed streaks and cloud drift — the ride itself still plays.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
