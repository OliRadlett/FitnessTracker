'use client';

import React from 'react';

/**
 * Base skeleton primitive — a pulsing rounded rectangle.
 */
export function SkeletonLine({
  className = '',
  width,
  height,
}: {
  className?: string;
  width?: string;
  height?: string;
}) {
  return (
    <div
      className={`bg-surface-light rounded animate-pulse ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton for a metric/stat card (small rectangular card with label + value).
 */
export function SkeletonMetric({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface rounded-xl border border-surface-light/50 p-4 animate-pulse ${className}`}
      aria-hidden="true"
    >
      <SkeletonLine className="h-3 w-20 mb-3" />
      <SkeletonLine className="h-7 w-14 mb-2" />
      <SkeletonLine className="h-3 w-24" />
    </div>
  );
}

/**
 * Skeleton for a list item row (e.g., activity card, session row).
 */
export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface rounded-xl border border-surface-light/50 p-5 animate-pulse ${className}`}
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <SkeletonLine className="h-6 w-16 rounded-full" />
          <div>
            <SkeletonLine className="h-4 w-32 mb-2" />
            <SkeletonLine className="h-3 w-48" />
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <SkeletonLine className="h-4 w-14 mb-1" />
            <SkeletonLine className="h-3 w-10" />
          </div>
          <div className="text-right">
            <SkeletonLine className="h-4 w-14 mb-1" />
            <SkeletonLine className="h-3 w-10" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for a grid of route cards.
 */
export function SkeletonRouteCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface rounded-xl border border-surface-light/50 p-4 animate-pulse ${className}`}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <SkeletonLine className="h-4 w-3/4 mb-2" />
          <div className="flex gap-2">
            <SkeletonLine className="h-5 w-14 rounded-full" />
            <SkeletonLine className="h-5 w-12 rounded-full" />
          </div>
        </div>
        <SkeletonLine className="h-8 w-10" />
      </div>
      <div className="flex gap-4 mt-3">
        <SkeletonLine className="h-3 w-16" />
        <SkeletonLine className="h-3 w-14" />
        <SkeletonLine className="h-3 w-12" />
      </div>
    </div>
  );
}
