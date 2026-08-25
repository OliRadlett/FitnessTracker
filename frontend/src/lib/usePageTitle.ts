'use client';

import { useEffect } from 'react';

export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title.includes('FitTrack') ? title : `${title} | FitTrack`;
    return () => { document.title = prev; };
  }, [title]);
}
