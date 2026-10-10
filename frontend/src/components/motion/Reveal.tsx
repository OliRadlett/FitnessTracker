'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Scroll-into-view reveal wrapper — ui-redesign-v2 §3.2 "chart reveal".
 *
 * Essential-content rule: the reveal DEGRADES OPEN. The element renders
 * fully visible by default and only arms the hidden pre-state from an
 * effect when ALL of these hold: JS is running, `IntersectionObserver`
 * exists, reduced motion is NOT requested, and the element is currently
 * below the viewport. Content that is already in view (or any content when
 * the observer is unavailable) never hides — it simply appears, with no
 * scroll-event listeners involved.
 *
 * Motion is opacity + a 12px translate (tokens) — no layout shift, no color
 * animation, and it fires once (disconnects after revealing).
 */
export interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** Intersection ratio required to reveal. Defaults to 0.1. */
  threshold?: number;
}

export function Reveal({ children, className, threshold = 0.1 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  // null = open (never armed); false = armed-hidden; true = revealed.
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      setVisible(null);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(null);
      return;
    }
    const el = ref.current;
    if (!el) {
      setVisible(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const inView =
      typeof window !== 'undefined'
        ? rect.top < window.innerHeight && rect.bottom > 0
        : true;
    if (inView) {
      // Already on screen: stay open, no animation to run.
      setVisible(null);
      return;
    }
    setVisible(false);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, reduceMotion]);

  return (
    <div
      ref={ref}
      className={`ft-reveal${className ? ` ${className}` : ''}`}
      data-armed={visible === null ? undefined : 'true'}
      data-visible={visible === true ? 'true' : undefined}
    >
      {children}
    </div>
  );
}
