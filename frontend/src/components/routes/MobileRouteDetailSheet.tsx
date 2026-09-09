'use client';

import { useState, useRef, useEffect } from 'react';
import type { RouteData } from '@/lib/api/types';
import { RouteDetailPanel } from '@/components/routes/RouteDetailPanel';

interface MobileRouteDetailSheetProps {
  route: RouteData | null;
  onClose: () => void;
}

export function MobileRouteDetailSheet({ route, onClose }: MobileRouteDetailSheetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const lastMove = useRef<{ y: number; t: number } | null>(null);
  const velocity = useRef(0);

  useEffect(() => {
    if (route) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [route]);

  useEffect(() => {
    if (!route) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [route, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startY.current = e.touches[0].clientY;
    currentY.current = 0;
    velocity.current = 0;
    lastMove.current = { y: e.touches[0].clientY, t: performance.now() };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const y = e.touches[0].clientY;
    const now = performance.now();
    if (lastMove.current) {
      const dt = Math.max(now - lastMove.current.t, 1);
      velocity.current = (y - lastMove.current.y) / dt;
    }
    lastMove.current = { y, t: now };
    const delta = y - startY.current;
    if (delta > 0) {
      currentY.current = delta;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${delta}px)`;
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    // Dismiss on a long drag OR a fast downward flick
    if (currentY.current > 100 || velocity.current > 0.5) {
      onClose();
    }
    currentY.current = 0;
    velocity.current = 0;
    lastMove.current = null;
  };

  if (!route) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={route.name ? `Route details: ${route.name}` : 'Route details'}
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-xl max-h-[75vh] flex flex-col overflow-hidden"
        style={{ transition: isDragging ? 'none' : 'transform 0.25s ease-out' }}
      >
        <div
          className="flex items-center justify-center min-h-[44px] cursor-grab active:cursor-grabbing touch-none"
          role="button"
          tabIndex={0}
          aria-label="Drag down to close route details"
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onClose();
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-12 h-1.5 rounded-full bg-surface-light" aria-hidden="true" />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <RouteDetailPanel route={route} onClose={onClose} scrollable={false} />
        </div>
      </div>
    </div>
  );
}
