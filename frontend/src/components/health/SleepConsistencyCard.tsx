'use client';

import Link from 'next/link';
import type { SleepConsistencyResponse } from '@/lib/api/types';

export function SleepConsistencyCard({ data }: { data: SleepConsistencyResponse }) {
  const color = data.consistency_score >= 80
    ? 'text-positive'
    : data.consistency_score >= 60
      ? 'text-yellow-400'
      : 'text-warning';

  return (
    <Link href="/health" className="block group">
      <div className="bg-surface rounded-xl border border-surface-light/50 p-4 h-full group-hover:border-accent/40 transition-colors">
        <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">🛏️ Bedtime Consistency</p>
        <div className="flex items-baseline gap-2">
          <p className={`text-2xl font-bold ${color} leading-none`}>
            {data.consistency_score.toFixed(0)}
          </p>
          <span className="text-xs text-muted">/ 100</span>
        </div>
        <p className="text-xs text-muted mt-1.5">
          {data.avg_bedtime ? `Avg bedtime ${data.avg_bedtime}` : 'No bedtimes logged'}
          {data.std_minutes > 0 && ` · ±${Math.round(data.std_minutes)}m`}
        </p>
      </div>
    </Link>
  );
}
