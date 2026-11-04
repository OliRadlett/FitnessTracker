'use client';

/**
 * Dashboard — three zones, one page.
 *
 * Today (act) · Trends (review) · History (the record). Replaces four time-zoom
 * tabs where Week already contained Month and Year.
 *
 * URL state: `?view=today|trends|history` and `?range=7d|30d|90d|ytd`. Legacy
 * `?tab=today|weekly|monthly|yearly` bookmarks are mapped on arrival rather than
 * falling through to a blank page — the old tabs were the only navigation this
 * page ever had.
 */

import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { TodayView } from '@/components/dashboard/today/TodayView';
import { TrendsView } from '@/components/dashboard/trends/TrendsView';
import { HistoryView } from '@/components/dashboard/history/HistoryView';
import {
  useDashboardPage,
  type DashboardRange,
  type DashboardView,
} from '@/lib/dashboard/useDashboardPage';
import { usePageTitle } from '@/lib/usePageTitle';

const VIEWS: DashboardView[] = ['today', 'trends', 'history'];
const RANGES: DashboardRange[] = ['7d', '30d', '90d', 'ytd'];

/** Old `?tab=` values, mapped. `weekly` and `monthly` were both review surfaces. */
const LEGACY_TABS: Record<string, DashboardView> = {
  today: 'today',
  weekly: 'trends',
  monthly: 'trends',
  yearly: 'history',
};

interface UrlState {
  view: DashboardView;
  range: DashboardRange;
}

function parseLocation(search: string): UrlState {
  const params = new URLSearchParams(search);
  const rawView = params.get('view');
  const legacy = params.get('tab');
  const view =
    (rawView && VIEWS.includes(rawView as DashboardView) ? (rawView as DashboardView) : null) ??
    (legacy ? LEGACY_TABS[legacy] : null) ??
    'today';
  const rawRange = params.get('range');
  const range =
    (rawRange && RANGES.includes(rawRange as DashboardRange)
      ? (rawRange as DashboardRange)
      : null) ?? '90d';
  return { view, range };
}

export default function DashboardPage() {
  usePageTitle('Dashboard');

  // Read the URL after mount rather than with `useSearchParams`, which would force a
  // Suspense boundary around the whole page for a value that only exists client-side.
  const [urlState, setUrlState] = useState<UrlState>({ view: 'today', range: '90d' });

  useEffect(() => {
    const parsed = parseLocation(window.location.search);
    setUrlState(parsed);
    // Normalise the URL on arrival: a legacy `?tab=weekly` bookmark must be rewritten
    // to the new contract, otherwise the address bar lies about what is on screen and
    // a reload loses the zone.
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== parsed.view || url.searchParams.get('range') !== parsed.range) {
      url.searchParams.set('view', parsed.view);
      url.searchParams.set('range', parsed.range);
      url.searchParams.delete('tab');
      window.history.replaceState(null, '', url);
    }
  }, []);

  const update = useCallback((next: UrlState) => {
    setUrlState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next.view);
    url.searchParams.set('range', next.range);
    url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
  }, []);

  const page = useDashboardPage(urlState.view, urlState.range);

  // The verdict is the one call the page cannot do without; everything else degrades
  // per section, so only this failing takes the whole screen.
  if (page.status === 'error') {
    return (
      <ErrorState
        title="The dashboard could not load today's verdict"
        message="Nothing else on this page is trusted while the verdict is missing."
        onRetry={page.today.retry}
        variant="card"
        show
      />
    );
  }

  if (page.status === 'loading' && !page.today.data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="h-[74px]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonMetric className="h-[180px]" />
          <SkeletonMetric className="h-[180px]" />
        </div>
        <SkeletonMetric className="h-[150px]" />
        <SkeletonMetric className="h-[160px]" />
      </div>
    );
  }

  return (
    <>
      {urlState.view === 'today' && <TodayView page={page} />}
      {urlState.view === 'trends' && (
        <TrendsView
          page={page}
          range={urlState.range}
          onRangeChange={(range) => update({ ...urlState, range })}
        />
      )}
      {urlState.view === 'history' && <HistoryView page={page} />}
    </>
  );
}
