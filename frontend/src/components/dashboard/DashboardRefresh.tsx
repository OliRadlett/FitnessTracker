'use client';

import React, { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { formatUpdatedAt } from '@/lib/utils';

// The queries that make up the dashboard data. Their freshest fetch time is
// shown as "last updated" and Refresh refetches all of them. The prefix match
// keeps child-tab queries (e.g. ['chart-weekly-tss', 12]) on the list.
const DASHBOARD_KEYS: string[][] = [
  ['today-summary'],
  ['dashboard-summary'],
  ['readiness'],
  ['respiratory-rate'],
  ['chart-weekly-tss'],
  ['activities-recent'],
  ['lifting-sessions-recent'],
  ['whoop-weekly'],
  ['chart-strain-vs-recovery'],
  ['monthly-summary'],
  ['training-streaks'],
  ['goals'],
  ['events', 'upcoming'],
  ['llm-analysis'],
  ['deficiency'],
];

function isDashboardQuery(key: readonly unknown[]): boolean {
  const first = String(key[0] ?? '');
  return DASHBOARD_KEYS.some(([prefix]) => prefix === first);
}

/** Latest successful-fetch timestamp across the dashboard queries. */
function useLastUpdated(): number {
  const queryClient = useQueryClient();
  const [updatedAt, setUpdatedAt] = useState(0);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const compute = () => {
      let max = 0;
      for (const query of cache.getAll()) {
        if (isDashboardQuery(query.queryKey) && query.state.dataUpdatedAt > max) {
          max = query.state.dataUpdatedAt;
        }
      }
      setUpdatedAt(max);
    };
    compute();
    const unsubscribe = cache.subscribe(() => compute());
    return unsubscribe;
  }, [queryClient]);

  return updatedAt;
}

/** §3.15 — "last updated" timestamp + manual refresh and syncing state for the
 * dashboard. Located in the hero header next to the weather widget. */
export function DashboardRefresh() {
  const queryClient = useQueryClient();
  const isFetching = useIsFetching({ predicate: q => isDashboardQuery(q.queryKey) });
  const updatedAt = useLastUpdated();

  function handleRefresh() {
    void queryClient.refetchQueries({ predicate: q => isDashboardQuery(q.queryKey) });
  }

  return (
    <div
      className="flex items-center gap-2 text-xs text-muted"
      role="status"
      aria-label="Dashboard data freshness"
    >
      <span aria-live="polite">
        {isFetching ? 'Syncing…' : `Last updated ${formatUpdatedAt(updatedAt)}`}
      </span>
      <button
        onClick={handleRefresh}
        disabled={!!isFetching}
        aria-label="Refresh dashboard data"
        title="Refresh dashboard data"
        className={`shrink-0 w-7 h-7 rounded-full border border-surface-light flex items-center justify-center transition-colors ${
          isFetching
            ? 'text-muted cursor-not-allowed'
            : 'text-muted hover:text-white hover:border-accent'
        }`}
      >
        <svg
          className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
    </div>
  );
}