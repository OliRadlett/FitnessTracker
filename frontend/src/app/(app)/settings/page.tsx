'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuthFetch, Connection } from '@/lib/api';
import { ExerciseManager } from '@/components/settings/ExerciseManager';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { usePageTitle } from '@/lib/usePageTitle';
import { formatRelativeTime } from '@/lib/utils';

const BASE_PATH = '/fittrack';

const integrations = [
  {
    id: 'strava',
    name: 'Strava',
    description: 'Sync cycling, running, and swimming activities with routes, power, HR, and GPS data',
    icon: `${BASE_PATH}/icons/strava.svg`,
    emoji: '🚴',
    color: 'bg-orange-500',
    available: true,
  },
  {
    id: 'komoot',
    name: 'Komoot',
    description: 'Sync planned routes and completed tours with GPS data and elevation profiles (configured via KOMOOT_EMAIL/KOMOOT_PASSWORD in .env)',
    icon: `${BASE_PATH}/icons/komoot.svg`,
    emoji: '🗺️',
    color: 'bg-green-600',
    available: true,
    basicAuth: true,
  },
  {
    id: 'wahoo',
    name: 'Wahoo',
    description: 'Sync routes and workouts from Wahoo trainers and ELEMNT head units',
    icon: `${BASE_PATH}/icons/wahoo.svg`,
    emoji: '📊',
    color: 'bg-blue-500',
    available: true,
  },
  {
    id: 'whoop',
    name: 'Whoop',
    description: 'Recovery scores, sleep tracking, HRV, daily strain, and heart rate data',
    icon: `${BASE_PATH}/icons/whoop.svg`,
    emoji: '💤',
    color: 'bg-purple-500',
    available: true,
  },
];

export default function SettingsPage() {
  usePageTitle('Settings');
  const { data: session } = useSession();
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [, setLoading] = useState(true);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);
  useEffect(() => {
    loadConnections();
  }, [authFetch]);

  // Surface the OAuth redirect outcome (the callback bounces back to
  // /settings?connected=... or /settings?error=... — previously dropped).
  useEffect(() => {
    const connected = searchParams?.get('connected');
    const error = searchParams?.get('error');
    if (connected) {
      setOauthNotice(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully.`);
      setConnections([]);
      setLoading(true);
      loadConnections();
    } else if (error) {
      setOauthNotice(`Connection failed: ${error}`);
    }
    if (connected || error) {
      // Strip the params so a refresh doesn't re-show the stale notice.
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  async function loadConnections() {
    try {
      const data = await authFetch<Connection[]>('/api/v1/connections/');
      setConnections(data);
    } catch {
      // No connections yet
    } finally {
      setLoading(false);
    }
  }

  function handleConnect(provider: string) {
    // Let the backend own the redirect_uri (derived from PUBLIC_URL) so the
    // authorize step and the callback's token exchange always agree (BUG-025).
    // The authorize navigation stays relative (Caddy routes /api/v1).
    // The backend resolves the user from the state parameter (a JWT) in the
    // callback — without it, connecting fails with "Could not identify
    // authenticated user".
    const state = session?.backendToken ? `?state=${encodeURIComponent(session.backendToken)}` : '';
    window.location.href = `/api/v1/auth/oauth/${provider}/authorize${state}`;
  }

  async function handleExport(apiPath: string, filename: string) {
    try {
      // Use raw fetch() instead of authFetch because we need the Response blob,
      // not a parsed JSON body. authFetch always returns parsed JSON.
      const response = await fetch(apiPath, {
        headers: session?.backendToken ? { Authorization: `Bearer ${session.backendToken}` } : {},
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }

  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [homeLat, setHomeLat] = useState<string>('');
  const [homeLng, setHomeLng] = useState<string>('');
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationResult, setLocationResult] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const profile = await authFetch<{ home_lat?: number | null; home_lng?: number | null }>(
          '/api/v1/cycling/profile'
        );
        if (profile.home_lat != null) setHomeLat(String(profile.home_lat));
        if (profile.home_lng != null) setHomeLng(String(profile.home_lng));
      } catch {
        // Profile not loaded — inputs stay empty
      }
    }
    loadProfile();
  }, [authFetch]);

  async function handleSaveLocation() {
    const lat = parseFloat(homeLat);
    const lng = parseFloat(homeLng);
    if (Number.isNaN(lat) || lat < -90 || lat > 90 || Number.isNaN(lng) || lng < -180 || lng > 180) {
      setLocationResult('Error: latitude must be -90..90 and longitude -180..180');
      return;
    }
    setSavingLocation(true);
    setLocationResult(null);
    try {
      await authFetch('/api/v1/cycling/profile', {
        method: 'PATCH',
        body: JSON.stringify({ home_lat: lat, home_lng: lng }),
      });
      setLocationResult('Location saved');
      queryClient.invalidateQueries({ queryKey: ['weather-current'] });
      queryClient.invalidateQueries({ queryKey: ['weather-forecast'] });
    } catch (err) {
      setLocationResult(`Error: ${err instanceof Error ? err.message : 'Save failed'}`);
    } finally {
      setSavingLocation(false);
    }
  }

  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [stravaBackfillProgress, setStravaBackfillProgress] = useState<{
    page: number;
    max_pages: number;
    synced: number;
    skipped: number;
    phase: string;
    streams_fetched?: number;
    streams_total?: number;
  } | null>(null);
  const [whoopBackfilling, setWhoopBackfilling] = useState(false);
  const [whoopBackfillResult, setWhoopBackfillResult] = useState<string | null>(null);
  const [whoopBackfillProgress, setWhoopBackfillProgress] = useState<{
    chunk: number;
    total_chunks: number;
    synced_cycles: number;
    synced_sleep: number;
    synced_workouts: number;
  } | null>(null);

  async function handleDisconnect(connectionId: string) {
    try {
      await authFetch(`/api/v1/connections/${connectionId}`, { method: 'DELETE' });
      setConnections(connections.filter(c => c.id !== connectionId));
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  }

  async function handleSync(connectionId: string) {
    setSyncing(connectionId);
    setSyncResult(null);
    try {
      const result = await authFetch<{ synced_count: number; detail: string }>(
        `/api/v1/connections/${connectionId}/sync`,
        { method: 'POST' }
      );
      setSyncResult(result.detail);
    } catch (err) {
      setSyncResult(`Error: ${err instanceof Error ? err.message : 'Sync failed'}`);
    } finally {
      setSyncing(null);
    }
  }

  async function handleSyncKomoot() {
    setSyncing('komoot-route-sync');
    setSyncResult(null);
    try {
      const results = await authFetch<Array<{ provider: string; synced_count: number; merged_count: number }>>(
        '/api/v1/routes/sync',
        { method: 'POST' }
      );
      const komoot = results?.find((r) => r.provider === 'komoot');
      if (komoot) {
        setSyncResult(`Komoot: synced ${komoot.synced_count} routes (${komoot.merged_count} merged)`);
      } else {
        setSyncResult('Komoot route sync completed');
      }
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    } catch (err) {
      setSyncResult(`Error: ${err instanceof Error ? err.message : 'Komoot sync failed'}`);
    } finally {
      setSyncing(null);
    }
  }

  function getConnection(provider: string): Connection | undefined {
    return connections.find(c => c.provider === provider);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="text-muted mt-1">Manage your account and integrations</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <div className="flex items-center gap-4">
            {session?.user?.image && (
              <img
                src={session.user.image}
                alt={session.user.name || ''}
                className="w-16 h-16 rounded-full"
              />
            )}
            <div>
              <p className="text-white font-medium text-lg">{session?.user?.name}</p>
              <p className="text-muted">{session?.user?.email}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Home Location */}
      <Card>
        <CardHeader>
          <CardTitle>Home Location</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <p className="text-sm text-muted mb-4">
            Latitude and longitude used for weather forecasts (e.g. 51.5074, -0.1278).
            Falls back to your most recent cycling activity when unset.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              inputMode="decimal"
              value={homeLat}
              onChange={(e) => setHomeLat(e.target.value)}
              placeholder="Latitude"
              className="w-40 px-3 py-2 text-sm bg-background border border-surface-light rounded-lg text-white placeholder-muted focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              inputMode="decimal"
              value={homeLng}
              onChange={(e) => setHomeLng(e.target.value)}
              placeholder="Longitude"
              className="w-40 px-3 py-2 text-sm bg-background border border-surface-light rounded-lg text-white placeholder-muted focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleSaveLocation}
              disabled={savingLocation}
              className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {savingLocation ? 'Saving...' : 'Save'}
            </button>
          </div>
          {locationResult && (
            <p className="mt-3 text-sm text-muted">{locationResult}</p>
          )}
        </div>
      </Card>

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6 space-y-4">
          {integrations.map((integration) => {
            const connection = getConnection(integration.id);
            const isConnected = !!connection;

            return (
              <div
                key={integration.id}
                className="flex items-center justify-between p-4 rounded-lg bg-background border border-surface-light/30"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg ${integration.color} flex items-center justify-center`}>
                    <img src={integration.icon} alt={integration.name} className="w-7 h-7" width="28" height="28" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium">{integration.name}</p>
                      {isConnected && connection && (
                        connection.status === 'needs_reauth' ? (
                          <Badge variant="warning">Needs re-auth</Badge>
                        ) : (
                          <Badge variant="positive">Connected</Badge>
                        )
                      )}
                    </div>
                    <p className="text-sm text-muted mt-1">{integration.description}</p>
                    {isConnected && connection && (
                      <p className="text-xs text-muted mt-1">
                        Connected as {connection.provider_user_id}
                        {connection.last_synced_at && (
                          <> · Last synced {formatRelativeTime(connection.last_synced_at)}</>
                        )}
                      </p>
                    )}
                    {isConnected && connection?.status === 'needs_reauth' && (
                      <p className="text-xs text-warning mt-1">
                        Sync is paused — please re-authorise to resume.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  {(integration as { basicAuth?: boolean }).basicAuth ? (
                    // Basic Auth integrations (e.g. Komoot) — configured via .env, synced via routes endpoint
                    <button
                      onClick={() => handleSyncKomoot()}
                      disabled={syncing === 'komoot-route-sync'}
                      className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {syncing === 'komoot-route-sync' ? 'Syncing...' : 'Sync Routes'}
                    </button>
                  ) : isConnected ? (
                    <>
                      {connection!.status === 'needs_reauth' ? (
                        <button
                          onClick={() => handleConnect(integration.id)}
                          className="px-4 py-2 text-sm font-medium text-warning hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          Reconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSync(connection!.id)}
                          disabled={syncing === connection!.id}
                          className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {syncing === connection!.id ? 'Syncing...' : 'Sync'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDisconnect(connection!.id)}
                        className="px-4 py-2 text-sm font-medium text-warning hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleConnect(integration.id)}
                      disabled={!integration.available}
                      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        integration.available
                          ? 'bg-accent hover:bg-accent/80 text-white'
                          : 'bg-surface-light/30 text-muted cursor-not-allowed'
                      }`}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {syncResult && (
          <div
            className={`mx-6 mb-4 p-3 rounded-lg bg-background text-sm ${
              syncResult.startsWith('Error:') ? 'text-warning' : 'text-muted'
            }`}
          >
            {syncResult}
          </div>
        )}
        {oauthNotice && (
          <div
            className={`mx-6 mb-4 p-3 rounded-lg bg-background text-sm ${
              oauthNotice.startsWith('Connection failed') ? 'text-warning' : 'text-positive'
            }`}
          >
            {oauthNotice}
          </div>
        )}
      </Card>

      {/* Export Data */}
      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <p className="text-sm text-muted mb-4">
            Download your data in CSV or GPX format for backup or use in other tools.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleExport('/api/v1/export/lifting/csv', 'fittrack_lifting.csv')}
              className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
            >
              📊 Lifting CSV
            </button>
            <button
              onClick={() => handleExport('/api/v1/export/activities/csv', 'fittrack_activities.csv')}
              className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
            >
              🏃 Activities CSV
            </button>
            <button
              onClick={() => handleExport('/api/v1/export/prs/csv', 'fittrack_prs.csv')}
              className="px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-white rounded-lg transition-colors border border-surface-light"
            >
              🏆 Personal Records CSV
            </button>
          </div>
        </div>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <CardTitle>Data Management</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <p className="text-sm text-muted mb-4">
            Backfill historical data from connected services. This fetches your complete
            activity history — useful after initial setup.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={async () => {
                setBackfilling(true);
                setBackfillResult(null);
                setStravaBackfillProgress(null);
                try {
                  const headers: Record<string, string> = {};
                  if (session?.backendToken) {
                    headers['Authorization'] = `Bearer ${session.backendToken}`;
                  }
                  const response = await fetch('/api/v1/activities/backfill?max_pages=50', {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                  });
                  if (!response.ok) {
                    const err = await response.json().catch(() => ({ detail: response.statusText }));
                    throw new Error(err.detail || `Backfill failed: ${response.status}`);
                  }

                  const reader = response.body?.getReader();
                  if (!reader) throw new Error('No response stream');
                  const decoder = new TextDecoder();
                  let buffer = '';

                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                      if (!line.startsWith('data: ')) continue;
                      try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'progress') {
                          setStravaBackfillProgress({
                            page: event.page,
                            max_pages: event.max_pages,
                            synced: event.synced,
                            skipped: event.skipped,
                            phase: event.phase,
                            streams_fetched: event.streams_fetched,
                            streams_total: event.streams_total,
                          });
                        } else if (event.type === 'complete') {
                          setBackfillResult(event.detail);
                          setStravaBackfillProgress(null);
                        } else if (event.type === 'page_error') {
                          console.warn('Strava backfill:', event.detail);
                        } else if (event.type === 'error') {
                          throw new Error(event.detail);
                        }
                      } catch (parseErr) {
                        if (parseErr instanceof Error && parseErr.message !== 'No response stream') {
                          throw parseErr;
                        }
                        console.warn('SSE event parse error:', parseErr);
                      }
                    }
                  }

                  queryClient.invalidateQueries({ queryKey: ['activities'] });
                  queryClient.invalidateQueries({ queryKey: ['activities-calendar'] });
                  queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
                } catch (err) {
                  setBackfillResult(`Error: ${err instanceof Error ? err.message : 'Backfill failed'}`);
                  setStravaBackfillProgress(null);
                } finally {
                  setBackfilling(false);
                }
              }}
              disabled={backfilling || !getConnection('strava')}
              className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {backfilling ? '⏳ Backfilling...' : '📥 Backfill All Strava Activities'}
            </button>
            <button
              onClick={async () => {
                setWhoopBackfilling(true);
                setWhoopBackfillResult(null);
                setWhoopBackfillProgress(null);
                try {
                  // Use raw fetch for SSE streaming — authFetch always parses JSON
                  const headers: Record<string, string> = {};
                  if (session?.backendToken) {
                    headers['Authorization'] = `Bearer ${session.backendToken}`;
                  }
                  const response = await fetch('/api/v1/connections/whoop/backfill?months=24', {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                  });
                  if (!response.ok) {
                    const err = await response.json().catch(() => ({ detail: response.statusText }));
                    throw new Error(err.detail || `Backfill failed: ${response.status}`);
                  }

                  const reader = response.body?.getReader();
                  if (!reader) throw new Error('No response stream');
                  const decoder = new TextDecoder();
                  let buffer = '';
                  let chunkErrors = 0;

                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    // Parse SSE events from buffer
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                      if (!line.startsWith('data: ')) continue;
                      try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'progress') {
                          setWhoopBackfillProgress({
                            chunk: event.chunk,
                            total_chunks: event.total_chunks,
                            synced_cycles: event.synced_cycles,
                            synced_sleep: event.synced_sleep,
                            synced_workouts: event.synced_workouts,
                          });
                        } else if (event.type === 'complete') {
                          setWhoopBackfillResult(event.detail);
                          setWhoopBackfillProgress(null);
                        } else if (event.type === 'error') {
                          // Non-fatal per-chunk error — the backend continues
                          // and reports the failure count in the final
                          // `complete` event. Don't abort the stream.
                          console.warn('Whoop backfill chunk error:', event.detail);
                          chunkErrors += 1;
                        }
                      } catch (parseErr) {
                        // Only log actual JSON parse errors, not backend errors
                        console.warn('SSE event parse error:', parseErr);
                      }
                    }
                  }

                  queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
                  queryClient.invalidateQueries({ queryKey: ['readiness'] });
                } catch (err) {
                  setWhoopBackfillResult(`Error: ${err instanceof Error ? err.message : 'Backfill failed'}`);
                  setWhoopBackfillProgress(null);
                } finally {
                  setWhoopBackfilling(false);
                }
              }}
              disabled={whoopBackfilling || !getConnection('whoop')}
              className="px-4 py-2 text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {whoopBackfilling ? '⏳ Backfilling...' : '💤 Backfill Whoop History'}
            </button>
          </div>
          {stravaBackfillProgress && (
            <div className="mt-3">
              <div className="flex items-center gap-3 mb-1">
                <div className="flex-1 bg-surface-light/30 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-orange-500 h-full rounded-full transition-all duration-300"
                    style={{
                      width: stravaBackfillProgress.phase === 'activities'
                        ? `${(stravaBackfillProgress.page / stravaBackfillProgress.max_pages) * 100}%`
                        : stravaBackfillProgress.phase === 'streams' && stravaBackfillProgress.streams_total
                          ? `${((stravaBackfillProgress.streams_fetched || 0) / stravaBackfillProgress.streams_total) * 100}%`
                          : '100%'
                    }}
                  />
                </div>
                <span className="text-xs text-muted whitespace-nowrap">
                  {stravaBackfillProgress.phase === 'activities'
                    ? `Page ${stravaBackfillProgress.page}/${stravaBackfillProgress.max_pages}`
                    : stravaBackfillProgress.phase === 'streams'
                      ? `Streams ${stravaBackfillProgress.streams_fetched || 0}/${stravaBackfillProgress.streams_total}`
                      : 'Linking...'}
                </span>
              </div>
              <p className="text-xs text-muted">
                {stravaBackfillProgress.synced} synced · {stravaBackfillProgress.skipped} skipped
              </p>
            </div>
          )}
          {backfillResult && (
            <p className="mt-3 text-sm text-muted">{backfillResult}</p>
          )}
          {whoopBackfillProgress && (
            <div className="mt-3">
              <div className="flex items-center gap-3 mb-1">
                <div className="flex-1 bg-surface-light/30 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-purple-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${(whoopBackfillProgress.chunk / whoopBackfillProgress.total_chunks) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted whitespace-nowrap">
                  {whoopBackfillProgress.chunk}/{whoopBackfillProgress.total_chunks} chunks
                </span>
              </div>
              <p className="text-xs text-muted">
                {whoopBackfillProgress.synced_cycles} metrics · {whoopBackfillProgress.synced_sleep} sleep · {whoopBackfillProgress.synced_workouts} workouts
              </p>
            </div>
          )}
          {whoopBackfillResult && (
            <p className="mt-3 text-sm text-muted">{whoopBackfillResult}</p>
          )}
        </div>
      </Card>

      {/* Exercise Library */}
      <ExerciseManager />

      {/* Notifications */}
      <NotificationSettings />

      {/* Danger Zone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-warning">Danger Zone</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <p className="text-sm text-muted mb-4">
            Delete your account and all associated data. This action cannot be undone.
          </p>
          <button className="px-4 py-2 text-sm font-medium text-warning hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-colors">
            Delete Account
          </button>
        </div>
      </Card>
    </div>
  );
}
