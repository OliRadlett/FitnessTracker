'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuthFetch, Connection } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const PUBLIC_URL = process.env.NEXT_PUBLIC_PUBLIC_URL || 'https://localhost';

// Providers that require HTTPS for OAuth callbacks
const HTTPS_PROVIDERS = ['wahoo', 'komoot'];

const integrations = [
  {
    id: 'strava',
    name: 'Strava',
    description: 'Sync cycling, running, and swimming activities with routes, power, HR, and GPS data',
    icon: '🚴',
    color: 'bg-orange-500',
    available: true,
  },
  {
    id: 'komoot',
    name: 'Komoot',
    description: 'Sync planned routes and completed tours with GPS data and elevation profiles',
    icon: '🗺️',
    color: 'bg-green-600',
    available: false,
    comingSoon: true,
  },
  {
    id: 'wahoo',
    name: 'Wahoo',
    description: 'Sync routes and workouts from Wahoo trainers and ELEMNT head units',
    icon: '📊',
    color: 'bg-blue-500',
    available: true,
  },
  {
    id: 'whoop',
    name: 'Whoop',
    description: 'Recovery scores, sleep tracking, HRV, and daily strain data',
    icon: '💤',
    color: 'bg-purple-500',
    available: false,
    comingSoon: true,
  },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const { authFetch } = useAuthFetch();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConnections();
  }, []);

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
    // Wahoo/Komoot require HTTPS callback URLs
    const baseUrl = HTTPS_PROVIDERS.includes(provider) ? PUBLIC_URL : API_BASE_URL;
    const callbackUrl = `${baseUrl}/api/v1/auth/oauth/${provider}/callback`;
    window.location.href = `${API_BASE_URL}/api/v1/auth/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  }

  async function handleExport(apiPath: string, filename: string) {
    try {
      const response = await fetch(`${API_BASE_URL}${apiPath}`, {
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

  function getConnection(provider: string): Connection | undefined {
    return connections.find(c => c.provider === provider);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
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
                  <div className={`w-12 h-12 rounded-lg ${integration.color} flex items-center justify-center text-2xl`}>
                    {integration.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium">{integration.name}</p>
                      {isConnected && (
                        <Badge variant="positive">Connected</Badge>
                      )}
                      {integration.comingSoon && (
                        <Badge variant="default">Coming Soon</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted mt-1">{integration.description}</p>
                    {isConnected && connection && (
                      <p className="text-xs text-muted mt-1">
                        Connected as {connection.provider_user_id}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  {isConnected ? (
                    <>
                      <button
                        onClick={() => handleSync(connection!.id)}
                        disabled={syncing === connection!.id}
                        className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {syncing === connection!.id ? 'Syncing...' : 'Sync'}
                      </button>
                      <button
                        onClick={() => handleDisconnect(connection!.id)}
                        className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
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
          <div className="mx-6 mb-4 p-3 rounded-lg bg-background text-sm text-muted">
            {syncResult}
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

      {/* Danger Zone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-red-400">Danger Zone</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <p className="text-sm text-muted mb-4">
            Delete your account and all associated data. This action cannot be undone.
          </p>
          <button className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-colors">
            Delete Account
          </button>
        </div>
      </Card>
    </div>
  );
}
