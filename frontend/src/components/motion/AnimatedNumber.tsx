'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MOTION } from './tokens';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Tweened numeric display — ui-redesign-v2 §3.2 "verdict value transitions".
 *
 * When `value` changes, the displayed number eases toward the target over
 * `MOTION.durationValueMs` instead of flashing to it. Under
 * `prefers-reduced-motion` it jumps to the target immediately.
 *
 * The tween is magnitude-only: formatting (rounding, units, `—` nulls) is
 * owned by the caller's `format` fn, and status COLOR is never animated —
 * data-critical color changes apply instantly per §3.2.
 */
export function useAnimatedNumber(value: number, durationMs = MOTION.durationValueMs): number {
  const reduceMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (reduceMotion) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const start =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (value - from) * eased;
      fromRef.current = current;
      setDisplay(current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs, reduceMotion]);

  return display;
}

export interface AnimatedNumberProps {
  /** Target numeric value. */
  value: number;
  /** Formats the (possibly mid-tween) display value. Defaults to rounding. */
  format?: (displayValue: number) => string;
  /** Accessible label; defaults to the formatted target value. */
  ariaLabel?: string;
  className?: string;
}

export function AnimatedNumber({ value, format, ariaLabel, className }: AnimatedNumberProps) {
  const display = useAnimatedNumber(value);
  const formatFn = format ?? ((v: number) => String(Math.round(v)));
  return (
    <span className={className} aria-label={ariaLabel ?? formatFn(value)}>
      {formatFn(display)}
    </span>
  );
}
