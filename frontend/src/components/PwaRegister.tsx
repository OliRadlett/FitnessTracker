'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/fittrack/sw.js').catch(() => {
      // SW registration failed — non-critical, app works without it
    });
  }, []);

  return null;
}
