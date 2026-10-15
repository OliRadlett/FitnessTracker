'use client';

import { useEffect, useState } from 'react';

/**
 * True when the viewport matches `query` (default: phones, < 640px).
 *
 * Used to swap a surface's presentation between desktop and mobile — e.g. the
 * day editor renders inline on desktop and as a bottom sheet on phones. SSR-safe
 * (false until mounted).
 */
export function useIsMobile(query = '(max-width: 639px)') {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return isMobile;
}
