'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Enables deep-linking to a specific record via URL query params
 * (e.g. `/activities?activity=abc`). Reads params once on mount and provides
 * `setParam` to update the query string in place with `history.replaceState`.
 *
 * Uses `window.location` directly instead of `useSearchParams()` so pages
 * don't need a Suspense boundary around the hook.
 */
export function useDeepLink() {
  const [params, setParams] = useState<URLSearchParams>(new URLSearchParams());

  useEffect(() => {
    setParams(new URLSearchParams(window.location.search));
  }, []);

  const getParam = useCallback((key: string): string | null => params.get(key), [params]);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === '') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const qs = next.toString();
      window.history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
      setParams(next);
    },
    [params],
  );

  return { getParam, setParam };
}