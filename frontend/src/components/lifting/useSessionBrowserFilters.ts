'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Filter state for {@link SessionBrowser}.
 *
 * `page` is 1-based. All other fields are client-side filters; `from`/`to`
 * are `YYYY-MM-DD` bounds (inclusive). When `from === to` the browser also
 * forwards it as the backend `session_date` param.
 */
export interface SessionBrowserFilters {
  q: string;
  focus: string;
  exercise: string;
  from: string;
  to: string;
  page: number;
}

export const DEFAULT_SESSION_BROWSER_FILTERS: SessionBrowserFilters = {
  q: '',
  focus: '',
  exercise: '',
  from: '',
  to: '',
  page: 1,
};

/** URL param names — namespaced with `s_` so `?session=` / `?tab=` / `?pr=` deep-links are never clobbered. */
const URL_KEYS = {
  q: 's_q',
  focus: 's_focus',
  exercise: 's_ex',
  from: 's_from',
  to: 's_to',
  page: 's_page',
} as const;

function parsePositiveInt(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function readFiltersFromLocation(): SessionBrowserFilters {
  if (typeof window === 'undefined') return { ...DEFAULT_SESSION_BROWSER_FILTERS };
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get(URL_KEYS.q) ?? '',
    focus: params.get(URL_KEYS.focus) ?? '',
    exercise: params.get(URL_KEYS.exercise) ?? '',
    from: params.get(URL_KEYS.from) ?? '',
    to: params.get(URL_KEYS.to) ?? '',
    page: parsePositiveInt(params.get(URL_KEYS.page)),
  };
}

function writeFiltersToLocation(filters: SessionBrowserFilters): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const setOrDelete = (key: string, value: string) => {
    if (value === '') params.delete(key);
    else params.set(key, value);
  };
  setOrDelete(URL_KEYS.q, filters.q);
  setOrDelete(URL_KEYS.focus, filters.focus);
  setOrDelete(URL_KEYS.exercise, filters.exercise);
  setOrDelete(URL_KEYS.from, filters.from);
  setOrDelete(URL_KEYS.to, filters.to);
  if (filters.page <= 1) params.delete(URL_KEYS.page);
  else params.set(URL_KEYS.page, String(filters.page));
  const qs = params.toString();
  window.history.replaceState(
    null,
    '',
    qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
  );
}

/** True when any filter narrows the session set (page excluded). */
export function hasActiveSessionFilters(
  filters: Pick<SessionBrowserFilters, 'q' | 'focus' | 'exercise' | 'from' | 'to'>,
): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.focus.trim() !== '' ||
    filters.exercise.trim() !== '' ||
    filters.from !== '' ||
    filters.to !== ''
  );
}

export interface UseSessionBrowserFiltersOptions {
  /** Controlled filter state (e.g. driven by focus chips elsewhere on the page). */
  filters?: SessionBrowserFilters;
  onFiltersChange?: (filters: SessionBrowserFilters) => void;
}

/**
 * URL-synced filter state for the session browser.
 *
 * Reads initial state from the URL on mount and writes back via
 * `history.replaceState`, preserving every unrelated param (notably
 * `?session=`, `?tab=` and `?pr=`). Supports a controlled mode so external
 * UI (e.g. focus filter chips) can drive the same state.
 */
export function useSessionBrowserFilters(options: UseSessionBrowserFiltersOptions = {}) {
  const { filters: controlled, onFiltersChange } = options;
  const [internal, setInternal] = useState<SessionBrowserFilters>(() =>
    controlled ? controlled : readFiltersFromLocation(),
  );

  const filters = controlled ?? internal;

  const commit = useCallback(
    (next: SessionBrowserFilters) => {
      writeFiltersToLocation(next);
      if (onFiltersChange) onFiltersChange(next);
      else setInternal(next);
    },
    [onFiltersChange],
  );

  // Keep the URL canonical once on mount (drops e.g. s_page=1).
  useEffect(() => {
    writeFiltersToLocation(controlled ?? readFiltersFromLocation());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/forward navigation re-reads the URL into uncontrolled state.
  useEffect(() => {
    if (controlled) return;
    const onPopState = () => setInternal(readFiltersFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [controlled]);

  // Any filter edit resets to page 1; page changes keep the filters.
  const setPartial = useCallback(
    (partial: Partial<SessionBrowserFilters>, opts?: { keepPage?: boolean }) => {
      // Prefer live state over the URL so rapid edits compose.
      const current = controlled ?? internal;
      commit({
        ...current,
        ...partial,
        page: partial.page ?? (opts?.keepPage ? current.page : 1),
      });
    },
    [commit, controlled, internal],
  );

  const setPage = useCallback(
    (page: number) => {
      const current = controlled ?? internal;
      commit({ ...current, page: Math.max(1, page) });
    },
    [commit, controlled, internal],
  );

  const resetFilters = useCallback(() => {
    commit({ ...DEFAULT_SESSION_BROWSER_FILTERS });
  }, [commit]);

  return { filters, setPartial, setPage, resetFilters };
}
