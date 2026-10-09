'use client';

import { useEffect, useState } from 'react';

/**
 * Reactive `prefers-reduced-motion` hook (ui-redesign-v2 §3.2).
 *
 * SSR-safe: `false` on the server / when `matchMedia` is unavailable, then
 * re-evaluates on mount and subscribes to OS-setting changes. Every motion
 * primitive in this directory gates on it — when reduced motion is requested
 * all value transitions jump to their target and all reveals render open.
 *
 * (The one-shot `prefersReducedMotion()` pure helper in `lib/perf.ts` serves
 * the Relive viewer; this hook is the reactive equivalent for React UI.)
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
