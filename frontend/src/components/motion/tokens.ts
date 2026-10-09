/**
 * Motion tokens — ui-redesign-v2 §3.2 (frontend only, Phase-0 hygiene scope).
 *
 * Single source of truth for durations/easings used by the motion primitives
 * under `components/motion/`. The CSS keyframes/classes live in
 * `src/app/globals.css` (the repo's established keyframe location — no CSS
 * modules in this codebase); this module mirrors the same values for the
 * rAF-driven primitives (`AnimatedNumber`, `Reveal`) so JS timing and CSS
 * timing never drift apart.
 *
 * Rules (binding, from §3.2):
 * - `prefers-reduced-motion` is respected throughout (media query in
 *   globals.css + `usePrefersReducedMotion` hook). Status must NEVER depend
 *   on animation — no motion on data-critical color changes.
 * - Verdict transitions animate value changes, never flash (no brightness
 *   pulses on headline/status text).
 * - PR toasts stay exactly as they are (no new celebratory moments).
 */

export const MOTION = {
  /** Fast micro-transitions (hover, value-swap fade). */
  durationFastMs: 150,
  /** Default transition (sheet/dialog enter, reveal). */
  durationBaseMs: 250,
  /** Slow ambient loops (skeleton shimmer sweep). */
  durationSlowMs: 1600,
  /** Numeric tween for verdict value changes (AnimatedNumber). */
  durationValueMs: 500,
  /** Reveal slide distance (px) — subtle, never layout-shifting. */
  revealDistancePx: 12,
  /** Value-swap nudge distance (px) for headline changes. */
  valueSwapDistancePx: 4,
  /** Standard ease-out for entrances. */
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Symmetric ease for loops. */
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const;

export type MotionTokens = typeof MOTION;
