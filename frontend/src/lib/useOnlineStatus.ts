'use client';

// Connectivity helpers for §3.7 PWA offline UX.

import { useEffect, useState } from 'react';

const LAST_ONLINE_KEY = 'fittrack-last-online';

/** True when the browser reports a network connection. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => {
      localStorage.setItem(LAST_ONLINE_KEY, String(Date.now()));
      setOnline(true);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/** Epoch ms of the last time the browser saw a connection (best-effort). */
export function getLastOnline(): number {
  const raw = localStorage.getItem(LAST_ONLINE_KEY);
  const ts = raw ? Number(raw) : NaN;
  if (Number.isFinite(ts) && ts > 0) return ts;
  return Date.now();
}