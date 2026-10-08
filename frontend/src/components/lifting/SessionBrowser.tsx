'use client';

import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAuthFetch } from '@/lib/api';
import type { LiftVideo, LiftingSession, PersonalRecord } from '@/lib/api';
import { getActiveLocale } from '@/lib/utils';
import { SessionCardMini } from '@/components/lifting/SessionCardMini';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  DEFAULT_SESSION_BROWSER_FILTERS,
  hasActiveSessionFilters,
  useSessionBrowserFilters,
  type SessionBrowserFilters,
} from '@/components/lifting/useSessionBrowserFilters';

export type { SessionBrowserFilters };
export { DEFAULT_SESSION_BROWSER_FILTERS, hasActiveSessionFilters };

/** Default rows per page in browse mode (backend max is 200). */
export const SESSION_BROWSER_PAGE_SIZE = 20;
/** Rows fetched when client-side filters are active (still one paginated API call). */
const FILTER_FETCH_LIMIT = 200;

export interface SessionBrowserProps {
  selectedSessionId: string | null;
  /** Forwards to SessionCardMini — preserves the `?session=` selection contract owned by the parent. */
  onSelectSession: (id: string | null) => void;
  videosBySession?: Map<string, LiftVideo[]>;
  prsBySession?: Map<string, PersonalRecord[]>;
  onAddSet?: (session: LiftingSession) => void;
  onEdit?: (session: LiftingSession) => void;
  onDelete?: (session: LiftingSession) => void;
  pageSize?: number;
  /** Controlled filter state (e.g. driven by focus chips elsewhere). Defaults to internal URL-synced state. */
  filters?: SessionBrowserFilters;
  onFiltersChange?: (filters: SessionBrowserFilters) => void;
  /**
   * External filter bag (from `useSessionBrowserFilters()` in the parent).
   * When provided it wins over the internal hook AND over `filters`/
   * `onFiltersChange`, so sibling UI (e.g. focus chips) can share one
   * URL-synced state instance with the browser.
   */
  filterBag?: SessionBrowserFilterBag;
  title?: string;
}

interface BrowserPage {
  sessions: LiftingSession[];
  total: number;
}

function matchesFilters(session: LiftingSession, filters: SessionBrowserFilters): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q) {
    const haystacks = [
      session.focus ?? '',
      session.notes ?? '',
      session.program_name ?? '',
      ...(session.sets ?? []).map((s) => s.exercise_name ?? ''),
    ].join('\n').toLowerCase();
    if (!haystacks.includes(q)) return false;
  }
  const focus = filters.focus.trim().toLowerCase();
  if (focus && !(session.focus ?? '').toLowerCase().includes(focus)) return false;
  const exercise = filters.exercise.trim().toLowerCase();
  if (
    exercise &&
    !(session.sets ?? []).some((s) => (s.exercise_name ?? '').toLowerCase().includes(exercise))
  ) {
    return false;
  }
  // session_date is YYYY-MM-DD — lexicographic compare is chronological.
  if (filters.from && session.session_date < filters.from) return false;
  if (filters.to && session.session_date > filters.to) return false;
  return true;
}

function monthKeyFor(session: LiftingSession): string {
  return /^\d{4}-\d{2}/.test(session.session_date ?? '')
    ? (session.session_date as string).slice(0, 7)
    : 'undated';
}

function monthLabel(key: string): string {
  if (key === 'undated') return 'Undated';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(getActiveLocale(), {
    month: 'long',
    year: 'numeric',
  });
}

export type SessionBrowserFilterBag = ReturnType<typeof useSessionBrowserFilters>;

export function SessionBrowser({
  selectedSessionId,
  onSelectSession,
  videosBySession,
  prsBySession,
  onAddSet,
  onEdit,
  onDelete,
  pageSize = SESSION_BROWSER_PAGE_SIZE,
  filters: controlledFilters,
  onFiltersChange,
  filterBag,
  title = 'Sessions',
}: SessionBrowserProps) {
  const { authFetchWithHeaders, token } = useAuthFetch();
  const internalBag = useSessionBrowserFilters({
    filters: controlledFilters,
    onFiltersChange,
  });
  const { filters, setPartial, setPage, resetFilters } = filterBag ?? internalBag;

  const filtering = hasActiveSessionFilters(filters);
  // Single-day ranges can be pushed to the backend; everything else filters client-side.
  const serverDate = filters.from !== '' && filters.from === filters.to ? filters.from : undefined;

  const limit = filtering ? FILTER_FETCH_LIMIT : pageSize;
  const offset = filtering ? 0 : (filters.page - 1) * pageSize;

  const queryKey = [
    'lifting-sessions',
    'browser',
    filtering ? 'filtered' : 'page',
    filtering ? 0 : filters.page,
    pageSize,
    serverDate ?? '',
  ];

  const { data, isLoading, isError, refetch } = useQuery<BrowserPage>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (serverDate) params.set('session_date', serverDate);
      const res = await authFetchWithHeaders<LiftingSession[]>(
        `/api/v1/lifting/sessions?${params.toString()}`,
      );
      const headerTotal = Number(res.headers.get('X-Total-Count'));
      return {
        sessions: res.data,
        total: Number.isFinite(headerTotal) ? headerTotal : res.data.length,
      };
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  const fetched = useMemo(() => data?.sessions ?? [], [data]);
  const serverTotal = data?.total ?? 0;

  // Facet options reflect the loaded window; full-list facets arrive with server-side filtering.
  const focusOptions = useMemo(() => {
    const names = new Set<string>();
    for (const s of fetched) {
      if (s.focus && s.focus.trim() !== '') names.add(s.focus.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [fetched]);

  const exerciseOptions = useMemo(() => {
    const names = new Set<string>();
    for (const s of fetched) {
      for (const set of s.sets ?? []) {
        if (set.exercise_name) names.add(set.exercise_name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [fetched]);

  const filteredSessions = useMemo(
    () => (filtering ? fetched.filter((s) => matchesFilters(s, filters)) : fetched),
    [fetched, filtering, filters],
  );

  const total = filtering ? filteredSessions.length : serverTotal;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(Math.max(1, filters.page), totalPages);

  const visibleSessions = useMemo(() => {
    const sorted = [...filteredSessions].sort((a, b) => {
      const ka = monthKeyFor(a);
      const kb = monthKeyFor(b);
      if (ka === 'undated' && kb !== 'undated') return 1;
      if (kb === 'undated' && ka !== 'undated') return -1;
      if (b.session_date !== a.session_date) return b.session_date < a.session_date ? -1 : 1;
      return b.created_at < a.created_at ? -1 : 1;
    });
    if (!filtering) return sorted;
    const start = (effectivePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [filteredSessions, filtering, effectivePage, pageSize]);

  const monthGroups = useMemo(() => {
    const groups = new Map<string, LiftingSession[]>();
    for (const s of visibleSessions) {
      const key = monthKeyFor(s);
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return Array.from(groups.entries());
  }, [visibleSessions]);

  const listTopRef = useRef<HTMLDivElement>(null);
  const handlePageChange = (next: number) => {
    setPage(Math.min(Math.max(1, next), totalPages));
    // `auto` behavior so reduced-motion users are not force-scrolled with animation.
    listTopRef.current?.scrollIntoView({ block: 'start' });
  };

  const advancedActive =
    filters.focus.trim() !== '' ||
    filters.exercise.trim() !== '' ||
    filters.from !== '' ||
    filters.to !== '';
  const [advancedOpen, setAdvancedOpen] = React.useState(advancedActive);
  React.useEffect(() => {
    if (advancedActive) setAdvancedOpen(true);
  }, [advancedActive]);
  const activeFilterCount =
    (filters.q.trim() !== '' ? 1 : 0) +
    (filters.focus.trim() !== '' ? 1 : 0) +
    (filters.exercise.trim() !== '' ? 1 : 0) +
    (filters.from !== '' || filters.to !== '' ? 1 : 0);

  const rangeStart = total === 0 ? 0 : (effectivePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(effectivePage * pageSize, total);

  return (
    <div ref={listTopRef} className="space-y-3 scroll-mt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted" aria-live="polite">
          {total === 1 ? '1 session' : `${total.toLocaleString()} sessions`}
          {filtering ? ' · filtered' : ''}
        </p>
      </div>

      {/* Filter bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => setPartial({ q: e.target.value })}
              placeholder="Search focus, notes, exercise…"
              aria-label="Search sessions"
              className="w-full min-h-[44px] bg-surface border border-surface-light text-foreground text-sm rounded-lg pl-9 pr-9 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted"
            />
            {filters.q !== '' && (
              <button
                onClick={() => setPartial({ q: '' })}
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted hover:text-foreground rounded transition-colors motion-reduce:transition-none"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
          </div>
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            aria-label="Toggle session filters"
            title="Filters"
            className={`relative shrink-0 min-h-[44px] min-w-[44px] px-3 flex items-center justify-center gap-1.5 rounded-lg border text-sm transition-colors motion-reduce:transition-none ${
              advancedActive || advancedOpen
                ? 'border-accent/50 text-foreground bg-surface'
                : 'border-surface-light text-muted hover:text-foreground bg-surface'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-accent text-background text-[11px] font-bold flex items-center justify-center"
                aria-label={`${activeFilterCount} active filters`}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {advancedOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-surface rounded-xl border border-surface-light/50">
            <label className="block">
              <span className="block text-xs text-muted mb-1">Focus</span>
              <select
                value={filters.focus}
                onChange={(e) => setPartial({ focus: e.target.value })}
                className="w-full min-h-[44px] bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">All</option>
                {Array.from(
                  new Set(
                    filters.focus !== '' ? [...focusOptions, filters.focus] : focusOptions,
                  ),
                )
                  .sort((a, b) => a.localeCompare(b))
                  .map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-muted mb-1">Exercise</span>
              <input
                type="text"
                value={filters.exercise}
                onChange={(e) => setPartial({ exercise: e.target.value })}
                placeholder="e.g. Bench Press"
                list="session-browser-exercises"
                className="w-full min-h-[44px] bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted"
              />
              <datalist id="session-browser-exercises">
                {exerciseOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="block text-xs text-muted mb-1">From</span>
              <input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => setPartial({ from: e.target.value })}
                className="w-full min-h-[44px] bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted mb-1">To</span>
              <input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => setPartial({ to: e.target.value })}
                className="w-full min-h-[44px] bg-surface-light border border-surface-light text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <div className="sm:col-span-2 flex justify-end">
              <button
                onClick={resetFilters}
                disabled={!filtering}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm text-muted hover:text-foreground rounded-lg transition-colors motion-reduce:transition-none disabled:opacity-40"
              >
                <RotateCcw className="w-4 h-4" aria-hidden />
                Clear filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div aria-live="polite">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : isError ? (
          <div
            className="p-4 bg-warning/10 border border-warning/30 rounded-xl text-sm text-warning"
            role="alert"
          >
            <p className="font-semibold">Couldn&apos;t load sessions</p>
            <p className="text-muted mt-1">Check your connection and try again.</p>
            <button
              onClick={() => refetch()}
              className="mt-2 min-h-[44px] px-4 rounded-lg bg-warning/20 hover:bg-warning/30 font-medium transition-colors motion-reduce:transition-none"
            >
              Retry
            </button>
          </div>
        ) : visibleSessions.length > 0 ? (
          <div className="space-y-4">
            {monthGroups.map(([key, group]) => (
              <section key={key} aria-label={monthLabel(key)}>
                <div className="flex items-center gap-2 mb-2">
                  <CalendarDays className="w-3.5 h-3.5 text-muted" aria-hidden />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {monthLabel(key)}
                  </h3>
                  <span className="text-[11px] text-muted bg-surface-light/50 px-1.5 py-0.5 rounded">
                    {group.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.map((session) => (
                    <SessionCardMini
                      key={session.id}
                      session={session}
                      isSelected={selectedSessionId === session.id}
                      onSelect={onSelectSession}
                      videos={videosBySession?.get(session.id)}
                      sessionPRs={prsBySession?.get(session.id)}
                      onAddSet={onAddSet}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : filtering ? (
          <EmptyState
            icon="🔍"
            title="No sessions match these filters"
            description="Try widening the date range or clearing the search — your sessions are still here."
            action={{ label: 'Clear filters', onClick: resetFilters }}
          />
        ) : (
          <EmptyState
            icon="🏋️"
            title="No lifting sessions recorded"
            description="Create your first session, or jump straight into the Live Lift tracker to start logging sets in real time."
            action={{ label: 'Start Live Session', href: '/lifting/live' }}
          />
        )}
      </div>

      {/* Pagination */}
      {!isLoading && !isError && totalPages > 1 && (
        <nav
          className="flex items-center justify-between gap-2 pt-1"
          aria-label="Session pages"
        >
          <button
            onClick={() => handlePageChange(effectivePage - 1)}
            disabled={effectivePage <= 1}
            className="inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-3 rounded-lg border border-surface-light text-sm text-foreground bg-surface hover:border-surface-light/80 transition-colors motion-reduce:transition-none disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">Prev</span>
          </button>
          <p className="text-xs text-muted" aria-live="polite">
            Page {effectivePage} of {totalPages} · {rangeStart}–{rangeEnd} of{' '}
            {total.toLocaleString()}
          </p>
          <button
            onClick={() => handlePageChange(effectivePage + 1)}
            disabled={effectivePage >= totalPages}
            className="inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-3 rounded-lg border border-surface-light text-sm text-foreground bg-surface hover:border-surface-light/80 transition-colors motion-reduce:transition-none disabled:opacity-40"
            aria-label="Next page"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="w-4 h-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
