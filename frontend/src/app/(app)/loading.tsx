'use client';

import { SkeletonLine, SkeletonMetric, SkeletonRow } from '@/components/ui/Skeleton';

export default function AppLoading() {
  return (
    <div className="space-y-6">
      {/* Page header skeleton */}
      <div className="space-y-2">
        <SkeletonLine height="2rem" width="12rem" />
        <SkeletonLine height="1rem" width="18rem" />
      </div>

      {/* Content skeleton — metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonMetric key={i} />
        ))}
      </div>

      {/* Content skeleton — charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonRow key={i} className="h-80" />
        ))}
      </div>

      {/* Content skeleton — list items */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
