'use client';

// §3.7 offline banner. API GETs are network-only by design (Pitfall 23 — the
// SW never caches authenticated responses), so while the browser is offline
// every data view falls back to last-known server state. This banner makes
// that honest instead of showing silent staleness.

import React, { useEffect, useState } from 'react';
import { getLastOnline, useOnlineStatus } from '@/lib/useOnlineStatus';

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [lastOnline, setLastOnline] = useState<number>(() => getLastOnline());

  // Refresh the "last seen online" stamp whenever we come back online.
  useEffect(() => {
    if (online) setLastOnline(getLastOnline());
  }, [online]);

  if (online) return null;

  const minsAgo = Math.max(0, Math.round((Date.now() - lastOnline) / 60_000));
  const staleness =
    minsAgo < 1 ? 'a moment ago' : minsAgo < 60 ? `${minsAgo} min ago` : 'earlier';

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300"
    >
      <span aria-hidden>📡</span>
      <span>
        You're offline — the dashboard shows its last snapshot ({staleness}),
        other screens may be empty. Live Lift sets stay saved on this device and
        upload when you reconnect.
      </span>
    </div>
  );
}