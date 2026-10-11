'use client';

import React, { useState } from 'react';
import { signIn, useSession } from 'next-auth/react';

/**
 * §3.x auth-stale banner (R3 auth-stale spec).
 *
 * Fires when the NextAuth jwt callback's sync-user attempt failed — the
 * backend JWT is stale or missing, so every API call 401s until the user
 * retries or re-signs in. The banner surfaces that state with an honest
 * message ("login session stale — retry") and a manual Retry that bypasses
 * SYNC_RETRY_BACKOFF_S by calling useSession().update(), which re-invokes
 * the jwt callback with trigger='update' (see auth.ts forceSync logic).
 *
 * This complements (not replaces) SyncHealthBanner: the latter handles
 * connection-level staleness and needs-reauth flows; this handles the
 * narrower case of sync-user failure leaving the backend token unrefreshed.
 *
 * Honest-empty note: while this banner is shown, data queries that receive
 * 401s are classified by apiFetch as isAuthStale (see fetch.ts) so
 * components can render empty states instead of error pages — the banner
 * is the single source of truth for the "why" messaging.
 */
export function AuthStaleBanner() {
  const { data: session, update, status } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Only act on an actual session — don't show during loading or when signed out.
  const syncFailed = session?.backendSyncFailed;

  if (status === 'loading' || !syncFailed || dismissed) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠️</span>
        <span>
          <strong>Login session stale</strong> — the sign-in token could not be
          refreshed. Retry now to bypass the retry backoff, or{' '}
          <button
            onClick={() => signIn(undefined, { callbackUrl: window.location.href })}
            className="underline hover:text-warning/80 font-medium"
          >
            sign in again
          </button>
          .
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={async () => {
            setRetrying(true);
            try {
              // update() triggers the jwt callback with trigger='update',
              // which the auth.ts forceSync bypass forces a sync-user retry
              // regardless of SYNC_RETRY_BACKOFF_S. On success the session
              // clears backendSyncFailed and the banner disappears.
              await update();
            } finally {
              setRetrying(false);
            }
          }}
          disabled={retrying}
          className="px-3 py-1.5 rounded-lg bg-surface-light text-foreground text-sm font-semibold disabled:opacity-50 hover:bg-surface-light/80 transition-colors"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-warning hover:text-warning/80 font-medium px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
