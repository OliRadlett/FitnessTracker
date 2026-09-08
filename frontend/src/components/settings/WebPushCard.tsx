'use client';

// §3.8 Web Push settings card — enable/disable browser notifications.
// Per-type granularity is inherited from the existing NotificationSettings
// toggles (the backend gates push delivery through the same preferences).

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAuthFetch } from '@/lib/api';
import {
  getPushCapability,
  getPushCount,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  type PushCapability,
} from '@/lib/webPush';

export function WebPushCard() {
  const { authFetch, token } = useAuthFetch();
  const [capability, setCapability] = useState<PushCapability | null>(null);
  const [serverCount, setServerCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setCapability(await getPushCapability());
    setServerCount(await getPushCount(authFetch));
  }, [authFetch]);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

  const onEnable = async () => {
    setBusy(true);
    setError(null);
    const result = await subscribeToWebPush(authFetch);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Failed to enable web push.');
    }
    setCapability(await getPushCapability());
    setServerCount(await getPushCount(authFetch));
  };

  const onDisable = async () => {
    setBusy(true);
    setError(null);
    const result = await unsubscribeFromWebPush(authFetch);
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'Failed to disable web push.');
    setCapability(await getPushCapability());
    setServerCount(await getPushCount(authFetch));
  };

  if (capability === null) return null;
  if (capability === 'unsupported') return null; // hide entirely

  const active = capability === 'granted' && (serverCount ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Web Push</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-surface-light/50 bg-surface-light/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden>🔔</span>
            <div>
              <p className="text-sm font-medium text-white">Browser notifications</p>
              <p className="text-xs text-muted mt-0.5">
                Deliver notifications to this device even when the app isn’t open.
                Delivery respects the per-type toggles above.
              </p>
              {active && (
                <p className="text-xs text-positive mt-1">
                  ✓ Enabled on {serverCount} device{serverCount === 1 ? '' : 's'}
                </p>
              )}
              {capability === 'denied' && (
                <p className="text-xs text-warning mt-1">
                  Notifications are blocked for this site — enable them in your browser settings.
                </p>
              )}
              {error && <p className="text-xs text-warning mt-1">{error}</p>}
            </div>
          </div>
          <div className="shrink-0">
            {active ? (
              <button
                onClick={onDisable}
                disabled={busy}
                className="px-3 py-1.5 text-xs rounded-lg border border-surface-light text-muted hover:text-white disabled:opacity-50"
              >
                {busy ? 'Disabling…' : 'Disable'}
              </button>
            ) : (
              (capability === 'granted' || capability === 'available') && (
                <button
                  onClick={onEnable}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white font-medium hover:bg-accent/80 disabled:opacity-50"
                >
                  {busy ? 'Requesting…' : 'Enable'}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}