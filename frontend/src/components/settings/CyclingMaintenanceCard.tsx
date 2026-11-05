'use client';

/**
 * Cycling data repair — the three maintenance actions that used to sit inline
 * on the `/cycling` page, between the charts and the reading path.
 *
 * They are rare, each one is a POST, and none of them is a training decision:
 * they belong in Settings next to the activity backfill, not next to the power
 * curve. Behaviour (endpoints, result copy, cache invalidation) is unchanged
 * from the page that hosted them.
 */
import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Satellite, Timer } from 'lucide-react';
import { useAuthFetch } from '@/lib/api';
import type { BackfillFtpResult } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';

interface ActionRowProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  label: string;
  pendingLabel: string;
  pending: boolean;
  result: string | null;
  error: boolean;
  onRun: () => void;
}

function ActionRow({ title, description, icon, label, pendingLabel, pending, result, error, onRun }: ActionRowProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-light/30 bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted">{description}</p>
        {result && (
          <p className={`mt-2 text-sm ${error ? 'text-warning' : 'text-positive'}`}>{result}</p>
        )}
      </div>
      <button
        onClick={onRun}
        disabled={pending}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-surface-light/50 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-light/30 disabled:opacity-50"
      >
        <span aria-hidden>{icon}</span>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}

export function CyclingMaintenanceCard() {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const [results, setResults] = React.useState<Record<string, { text: string; error: boolean }>>({});

  const setResult = (key: string, text: string, error = false) =>
    setResults((prev) => ({ ...prev, [key]: { text, error } }));

  const invalidate = (keys: string[][]) => {
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
  };

  const recalculateTss = useMutation({
    mutationFn: () =>
      authFetch<{ updated: number; total_checked: number }>(
        '/api/v1/cycling/recalculate-tss?days=365&force=true',
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      setResult('tss', `Recalculated TSS for ${data.updated} of ${data.total_checked} activities`);
      invalidate([['cycling-metrics'], ['training-load'], ['chart-training-load'], ['chart-daily-tss']]);
    },
    onError: () => setResult('tss', "Couldn't recalculate TSS — try again.", true),
  });

  const backfillStreams = useMutation({
    mutationFn: () =>
      authFetch<{ backfilled: number; total_checked: number; message?: string }>(
        '/api/v1/cycling/backfill-streams?days=90&limit=50',
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      setResult(
        'streams',
        data.message || `Backfilled streams for ${data.backfilled} of ${data.total_checked} activities`,
      );
      invalidate([
        ['power-curve'],
        ['chart-stream-power-curve'],
        ['power-zones'],
        ['chart-power-zones'],
        ['cycling-metrics'],
        ['chart-wkg-power-curve'],
        ['chart-power-duration-percentile'],
        ['power-vs-hr'],
        ['vo2max'],
        ['vo2max-history'],
        ['chart-vo2max-trend'],
        ['decoupling-history'],
        ['chart-decoupling-trend'],
        ['cycling-prs'],
        ['activity-streams'],
        ['activities'],
      ]);
    },
    onError: () => setResult('streams', "Couldn't backfill streams — try again.", true),
  });

  const backfillFtpHistory = useMutation({
    mutationFn: () =>
      authFetch<BackfillFtpResult>('/api/v1/cycling/backfill-ftp-history?months=12', { method: 'POST' }),
    onSuccess: (data) => {
      setResult('ftp', `Backfilled ${data.created} FTP history entries over ${data.months_analyzed} months`);
      invalidate([['ftp-history'], ['chart-ftp-history'], ['cycling-profile'], ['cycling-metrics']]);
    },
    onError: () => setResult('ftp', "Couldn't backfill FTP history — try again.", true),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycling data</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-6 pb-6">
        <p className="text-sm text-muted">
          Recompute what the cycling analysis is built on. Each of these is a repair, not a routine
          step — run one when a number looks wrong, not to make the page load.
        </p>

        <ActionRow
          title="Per-second streams"
          description="Power curves, zones, VO₂max and FTP estimation all need per-second power. Fetches streams for up to 50 rides from the last 90 days."
          icon={<Satellite className="h-4 w-4" />}
          label="Fetch streams"
          pendingLabel="Fetching…"
          pending={backfillStreams.isPending}
          result={results.streams?.text ?? null}
          error={!!results.streams?.error}
          onRun={() => backfillStreams.mutate()}
        />

        <ActionRow
          title="Training stress"
          description="Recomputes TSS for every ride in the last year. Needed for CTL / ATL / TSB, and for any ride that was imported without it."
          icon={<RefreshCw className="h-4 w-4" />}
          label="Recalculate TSS"
          pendingLabel="Calculating…"
          pending={recalculateTss.isPending}
          result={results.tss?.text ?? null}
          error={!!results.tss?.error}
          onRun={() => recalculateTss.mutate()}
        />

        <ActionRow
          title="FTP history"
          description="Backfills monthly threshold estimates from the last 12 months of rides, so the FTP chart has a past."
          icon={<Timer className="h-4 w-4" />}
          label="Backfill FTP history"
          pendingLabel="Backfilling…"
          pending={backfillFtpHistory.isPending}
          result={results.ftp?.text ?? null}
          error={!!results.ftp?.error}
          onRun={() => backfillFtpHistory.mutate()}
        />
      </div>
    </Card>
  );
}
