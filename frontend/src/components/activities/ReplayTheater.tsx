'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Activity } from '@/lib/api';
import type { ReplayBuildResult } from '@/lib/replay';

// three.js stays out of the activities bundle until the Theater opens.
const Replay3D = dynamic(
  () => import('@/components/activities/Replay3D').then((mod) => mod.Replay3D),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-surface-light/20" /> },
);

/**
 * Full-screen "Theater" for the 3D ride replay (Relive redesign, Phase 1).
 *
 * Portaled to document.body and edge-to-edge so the replay is never crammed
 * into the activity card. The parent keeps the app shell locked/inert while
 * open, mirroring `Modal` (a dialog inside the inert <main> would be dead).
 */
export function ReplayTheater({
  activity,
  build,
  polyline,
  ftpWatts,
  onClose,
}: {
  activity: Activity;
  build: ReplayBuildResult;
  polyline?: string;
  ftpWatts?: number | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const main = document.querySelector('main');
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    const prevMain = main instanceof HTMLElement ? main.style.overflow : null;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (main instanceof HTMLElement) main.style.overflow = 'hidden';
    main?.setAttribute('inert', '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
      if (main instanceof HTMLElement) main.style.overflow = prevMain ?? '';
      main?.removeAttribute('inert');
    };
  }, [onClose]);

  if (!mounted) return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`3D Replay — ${activity.name}`}
      className="fixed inset-0 z-[60] flex flex-col bg-background"
    >
      <header className="flex items-center gap-3 border-b border-surface-light px-3 py-2 sm:px-4">
        <span className="text-xs font-medium uppercase tracking-wide text-accent">Relive</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{activity.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close 3D replay"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-muted transition-colors hover:bg-surface-light/40 hover:text-foreground"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        <Replay3D
          name={activity.name}
          build={build}
          polyline={polyline}
          ftpWatts={ftpWatts}
          canvasHeightClass="h-[68dvh]"
          theater
        />
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
