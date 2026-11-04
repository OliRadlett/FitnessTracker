'use client';

import React from 'react';
import { MOTION } from '@/components/motion/tokens';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

const PULL_SYNC_THRESHOLD_PX = 64;
export type PullSyncPhase = 'idle' | 'pull' | 'ready' | 'syncing';

/**
 * Pull-to-sync (ui-redesign-v2 §3.5 REVIEW signature). A touch pull-down from
 * the very top refetches the page queries through their existing React Query
 * keys, with a small release-to-sync indicator. Static under reduced motion.
 */
export function usePullToSync(onSync: () => Promise<unknown>): PullSyncPhase {
  const startYRef = React.useRef<number | null>(null);
  const phaseRef = React.useRef<PullSyncPhase>('idle');
  const [phase, setPhase] = React.useState<PullSyncPhase>('idle');
  const onSyncRef = React.useRef(onSync);

  React.useEffect(() => {
    onSyncRef.current = onSync;
  });

  React.useEffect(() => {
    const setBoth = (p: PullSyncPhase) => {
      phaseRef.current = p;
      setPhase(p);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const startY = startYRef.current;
      if (startY == null || e.touches.length !== 1 || window.scrollY > 0) return;
      if (phaseRef.current === 'syncing') return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        setBoth('idle');
        return;
      }
      setBoth(dy >= PULL_SYNC_THRESHOLD_PX ? 'ready' : 'pull');
    };
    const onTouchEnd = () => {
      startYRef.current = null;
      if (phaseRef.current !== 'ready') {
        if (phaseRef.current !== 'syncing') setBoth('idle');
        return;
      }
      setBoth('syncing');
      void Promise.resolve()
        .then(() => onSyncRef.current())
        .catch(() => undefined)
        .finally(() => setBoth('idle'));
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return phase;
}

export function PullSyncStatus({ phase, label }: { phase: PullSyncPhase; label: string }) {
  const reduceMotion = usePrefersReducedMotion();
  if (phase === 'idle') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex justify-center"
      style={reduceMotion ? undefined : { transition: `opacity ${MOTION.durationFastMs}ms ${MOTION.easeOut}` }}
    >
      <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-surface-light/50 bg-surface px-4 py-1 text-xs text-muted">
        <span aria-hidden="true">{phase === 'syncing' ? '⟳' : phase === 'ready' ? '↑' : '↓'}</span>
        {phase === 'syncing' ? 'Syncing…' : phase === 'ready' ? 'Release to sync' : 'Pull to sync'}
      </span>
    </div>
  );
}
