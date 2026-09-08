'use client';

// §3.7 offline shell for the dashboard: persists the last-known dashboard
// query data to localStorage and restores it so screens render with the most
// recent data even when the API can't be reached (the SW serves API GETs
// network-only — Pitfall 23 — so an offline cache is the only way to keep the
// dashboard usable). Restored snapshots are marked stale (updatedAt: 0), so
// the very next successful fetch replaces them; on failure React Query keeps
// the stale snapshot painted.

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

const STORAGE_KEY = 'fittrack-dashboard-snapshots';
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WRITE_DEBOUNCE_MS = 500;

function isDashboardKey(key: unknown): boolean {
  return (
    Array.isArray(key) &&
    key.length > 0 &&
    typeof key[0] === 'string' &&
    (key[0] as string).startsWith('dashboard')
  );
}

function isJsonSafe(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

interface Snapshot {
  queryKey: unknown[];
  data: unknown;
  ts: number;
}

export function OfflineSnapshot({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore last-known dashboard data on mount (stale, instantly refetched).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snapshots: Snapshot[] = JSON.parse(raw);
      const now = Date.now();
      for (const snap of snapshots) {
        if (!snap || !isDashboardKey(snap.queryKey) || !isJsonSafe(snap.data)) continue;
        if (now - (snap.ts ?? 0) > MAX_SNAPSHOT_AGE_MS) continue;
        // updatedAt 0 → stale immediately so the mounted query refetches.
        queryClient.setQueryData(snap.queryKey as unknown as QueryKey, snap.data, { updatedAt: 0 });
      }
    } catch {
      // Corrupt/oversized snapshot — drop it.
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [queryClient]);

  // Persist dashboard data as it updates (debounced).
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const { query } = event;
      if (!isDashboardKey(query.queryKey)) return;
      if (!isJsonSafe(query.state.data)) return;

      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => {
        try {
          const now = Date.now();
          const raw = localStorage.getItem(STORAGE_KEY);
          const existing: Snapshot[] = raw ? JSON.parse(raw) : [];
          const next: Snapshot[] = existing.filter(
            (s) => !isDashboardKey(s.queryKey) || JSON.stringify(s.queryKey) !== JSON.stringify(query.queryKey),
          );
          next.push({ queryKey: query.queryKey as unknown[], data: query.state.data, ts: now });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-10)));
        } catch {
          // Quota exceeded / serialization error — ignore, snapshot is best-effort.
        }
      }, WRITE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [queryClient]);

  return <>{children}</>;
}