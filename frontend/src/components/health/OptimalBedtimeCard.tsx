'use client';

import Link from 'next/link';
import type { OptimalBedtimeResponse } from '@/lib/api/types';

const CONFIDENCE_COLOR: Record<OptimalBedtimeResponse['confidence'], string> = {
  high: 'text-positive',
  medium: 'text-yellow-400',
  low: 'text-muted',
};

export function OptimalBedtimeCard({ data }: { data: OptimalBedtimeResponse }) {
  return (
    <Link href="/health" className="block group">
      <div className="bg-surface rounded-xl border border-surface-light/50 p-4 h-full group-hover:border-accent/40 transition-colors">
        <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">🌙 Optimal Bedtime</p>
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold text-foreground leading-none">
            {data.suggested_bedtime ?? '—'}
          </p>
          <span className={`text-xs ${CONFIDENCE_COLOR[data.confidence]}`}>
            {data.confidence} confidence
          </span>
        </div>
        <p className="text-xs text-muted mt-1.5 line-clamp-2" title={data.message}>
          {data.message}
        </p>
      </div>
    </Link>
  );
}
