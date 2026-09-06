'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { useAuthFetch, Connection } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';

// A connection that hasn't synced in this long (its schedule is 30 min) is
// worth flagging even when the token is still valid.
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function SyncHealthBanner() {
  const { authFetch, token } = useAuthFetch();
  const { data: session } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => authFetch<Connection[]>('/api/v1/connections/'),
    staleTime: 5 * 60 * 1000,
    enabled: !!token,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // The backend JWT is gone/expired — every API call 401s until it's refreshed.
  // The silent refresh in the jwt callback can't help if provider info is
  // missing; surface it so the user isn't staring at silent failures.
  const backendTokenExpired = session?.backendTokenExpired;

  if (dismissed || (!backendTokenExpired && (!connections || connections.length === 0))) {
    return null;
  }

  const needsReauth = connections?.filter((c) => c.status === 'needs_reauth') ?? [];
  const stale =
    connections?.filter((c) => {
      if (c.status === 'needs_reauth' || !c.last_synced_at) return false;
      return Date.now() - new Date(c.last_synced_at).getTime() > STALE_THRESHOLD_MS;
    }) ?? [];

  if (backendTokenExpired) {
    return (
      <div className="mb-4 p-3 rounded-lg border text-sm flex items-start justify-between gap-3 bg-red-500/10 border-red-500/30 text-red-300">
        <div role="status">
          <p>
            <strong>Session expired:</strong> your sign-in token has lapsed, so new
            data can&apos;t sync. Reconnect to keep working out.{' '}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-red-400 hover:text-red-200 font-medium px-1"
          >
            ✕
          </button>
          <button
            disabled={reconnecting}
            onClick={async () => {
              setReconnecting(true);
              await signIn(undefined, { callbackUrl: window.location.href });
              setReconnecting(false);
            }}
            className="px-3 py-1.5 rounded-lg bg-surface-light text-white text-sm font-semibold disabled:opacity-50"
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      </div>
    );
  }

  if (needsReauth.length === 0 && stale.length === 0) return null;

  const providerName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

  return (
    <div className="mb-4 p-3 rounded-lg border text-sm flex items-start justify-between gap-3 bg-red-500/10 border-red-500/30 text-red-300">
      <div role="status">
        {needsReauth.length > 0 ? (
          <p>
            <strong>Action needed:</strong> {needsReauth.map((c) => providerName(c.provider)).join(', ')}{' '}
            need re-authorisation — sync is paused until you reconnect.{' '}
            <Link href="/settings" className="underline hover:text-red-200 font-medium">
              Fix in Settings
            </Link>
          </p>
        ) : (
          <p>
            <strong>Heads up:</strong> {stale.map((c) => providerName(c.provider)).join(', ')}{' '}
            haven&apos;t synced in a while
            {stale[0]?.last_synced_at ? ` (last synced ${formatRelativeTime(stale[0].last_synced_at)})` : ''}.
          </p>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-red-400 hover:text-red-200 font-medium px-1"
      >
        ✕
      </button>
    </div>
  );
}