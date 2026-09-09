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

  useEffect(() => {
    if (route) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [route]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startY.current = e.touches[0].clientY;
    currentY.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const delta = e.touches[0].clientY - startY.current;
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
    if (currentY.current > 100) {
      onClose();
    }
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
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-xl max-h-[75vh] flex flex-col overflow-hidden"
        style={{ transition: isDragging ? 'none' : 'transform 0.25s ease-out' }}
      >
        <div
          className="flex items-center justify-center py-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-surface-light" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <RouteDetailPanel route={route} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
