'use client';

import Link from 'next/link';
import type { SleepDebtResponse } from '@/lib/api/types';

export function SleepDebtCard({ data }: { data: SleepDebtResponse }) {
  // Convention (0.4): debt_hours >= 0 means hours owed. Displayed with a
  // minus sign ("-2.6h" = 2.6h short) — Health page uses the same sign.
  const color = data.debt_hours <= 0
    ? 'text-positive'
    : data.debt_hours < 3
      ? 'text-yellow-400'
      : 'text-warning';

  return (
    <Link href="/health" className="block group">
      <div className="bg-surface rounded-xl border border-surface-light/50 p-4 h-full group-hover:border-accent/40 transition-colors">
        <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">😴 Sleep Debt</p>
        <div className="flex items-baseline gap-2">
          <p className={`text-2xl font-bold ${color} leading-none`}>
            {data.debt_hours > 0 ? `-${data.debt_hours.toFixed(1)}h` : 'Caught up'}
          </p>
        </div>
        <p className="text-xs text-muted mt-1.5">
          Avg {data.avg_sleep_hours.toFixed(1)}h vs {data.target_hours.toFixed(0)}h target
          {data.days_below_target > 0 && ` · ${data.days_below_target}d short`}
        </p>
      </div>
    </Link>
  );
}
