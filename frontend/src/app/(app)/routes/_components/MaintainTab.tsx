'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Layers, Loader2, Route, Tags, TriangleAlert } from 'lucide-react';
import type { RouteSummary } from '@/lib/api/types';
import { useAuthFetch } from '@/lib/api';
import { getRouteScanStatus, refreshRouteScan } from '@/lib/api/routes';
import {
  decodePolyline,
  formatClimb,
  formatDate,
  formatKm,
  hasShape,
  providerChain,
} from '@/lib/routeAtlas';
import { DuplicatesTab } from './DuplicatesTab';

function Section({
  icon,
  title,
  count,
  description,
  tone = 'neutral',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number | string;
  description: string;
  tone?: 'neutral' | 'caution';
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-surface-light/60 bg-surface/80">
      <div className="flex items-start gap-3 border-b border-surface-light/40 px-4 py-3">
        <span className={`mt-0.5 ${tone === 'caution' ? 'text-caution' : 'text-muted'}`} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                tone === 'caution' ? 'bg-caution/15 text-caution' : 'bg-surface-light/60 text-muted'
              }`}
            >
              {count}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function RouteLine({
  route,
  note,
  onOpen,
}: {
  route: RouteSummary;
  note?: string;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(route.id)}
      className="flex w-full items-center justify-between gap-3 border-b border-surface-light/30 px-4 py-2.5 text-left last:border-b-0 hover:bg-surface-light/20"
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">{route.name}</span>
        <span className="mt-0.5 block text-[11px] text-muted">
          {note ??
            `${providerChain(route)} · ${formatKm(route.distance_meters)} · ${formatClimb(
              route.elevation_gain_meters,
            )}`}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-accent">Open</span>
    </button>
  );
}

/**
 * Maintain mode: the library's health, not its browse surface. The duplicate
 * queue is a background scan: the button queues a Celery task, this panel
 * polls the scan state, and only a finished scan shows the review queue.
 */
export function MaintainTab({
  routes,
  total,
  onOpenRoute,
  onOpenCollections,
}: {
  routes: RouteSummary[];
  total: number;
  onOpenRoute: (id: string) => void;
  onOpenCollections: () => void;
}) {
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [scanError, setScanError] = useState<string | null>(null);
  const previousState = useRef<string | undefined>(undefined);

  const { data: scan, refetch: refetchScan } = useQuery({
    queryKey: ['route-scan-status'],
    queryFn: () => getRouteScanStatus(token),
    enabled: !!token,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'queued' || state === 'running' ? 4000 : false;
    },
  });

  const startScan = useMutation({
    mutationFn: () => refreshRouteScan(token),
    onSuccess: () => {
      setScanError(null);
      refetchScan();
    },
    onError: (err) =>
      setScanError((err as Error)?.message || 'The scan could not be queued.'),
  });

  // A finished scan means the cached graph changed: refetch the queue once.
  useEffect(() => {
    const state = scan?.state;
    if (state === 'ready' && previousState.current && previousState.current !== 'ready') {
      queryClient.invalidateQueries({ queryKey: ['route-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['route-orphans'] });
    }
    previousState.current = state;
  }, [scan?.state, queryClient]);

  const scanning = scan?.state === 'queued' || scan?.state === 'running';
  const reviewCount = scan?.state === 'ready' ? (scan.pairs ?? 0) : null;

  const ridden = routes.filter((r) => r.is_ridden).length;
  const merged = routes.filter((r) => r.sources.length > 1);
  const noShape = routes.filter(
    (r) => !hasShape(r) || decodePolyline(r.preview_polyline).length < 3,
  );
  const sportMismatch = routes.filter((r) => r.sport_type !== 'cycling');
  const tags = routes.reduce((sum, r) => sum + r.tags.length, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-3 pb-8">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Summary label="Routes" value={total} hint={`${ridden} ridden · ${routes.length - ridden} new`} />
          <Summary label="Merged" value={merged.length} hint="2+ providers on one route" />
          <Summary label="No shape" value={noShape.length} hint="Geometry can't be drawn" />
          <Summary label="Tags" value={tags} hint="Grouping in use" />
        </div>

        <Section
          icon={<Copy className="h-4 w-4" />}
          title="Duplicate review"
          count={
            scan?.state === 'ready'
              ? (reviewCount ?? 0)
              : scan?.state === 'running' || scan?.state === 'queued'
                ? 'scanning'
                : 'on demand'
          }
          description="Same ride, different provider. The scan is a background job — full-resolution geometry takes minutes, so it never runs inside a request."
        >
          {scanning ? (
            <div className="flex items-start gap-3 px-4 py-4">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />
              <div>
                <p className="text-xs font-medium text-foreground">Scanning the library…</p>
                <p className="mt-1 text-xs text-muted">
                  Started {scan?.started_at ? formatTime(scan.started_at) : 'just now'}. You can
                  leave this page — the scan keeps running in the background.
                </p>
              </div>
            </div>
          ) : scan?.state === 'failed' ? (
            <div className="space-y-2 px-4 py-3">
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                The last scan failed: {scan.error || 'unknown error'}
              </p>
              <button
                type="button"
                onClick={() => startScan.mutate()}
                disabled={startScan.isPending}
                className="h-9 rounded-lg bg-accent px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                Retry scan
              </button>
            </div>
          ) : reviewCount !== null ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
                <span>
                  Last scanned {scan?.finished_at ? formatDate(scan.finished_at) : '—'} ·{' '}
                  <span className="tabular-nums text-foreground">{reviewCount}</span>{' '}
                  {reviewCount === 1 ? 'pair' : 'pairs'}
                </span>
                <button
                  type="button"
                  onClick={() => startScan.mutate()}
                  disabled={startScan.isPending}
                  className="h-8 rounded-lg border border-surface-light/70 px-3 text-[11px] font-medium text-foreground hover:bg-surface-light/30 disabled:opacity-50"
                >
                  Re-scan
                </button>
              </div>
              {reviewCount > 0 ? (
                <div className="p-3">
                  <DuplicatesTab />
                </div>
              ) : (
                <p className="px-4 pb-3 text-xs text-muted">
                  No duplicate candidates. Nothing to review.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="text-xs text-muted">
                Nothing is scanned until you ask. Merging is always confirmed by you.
              </p>
              <button
                type="button"
                onClick={() => startScan.mutate()}
                disabled={startScan.isPending}
                className="h-9 rounded-lg bg-accent px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                {startScan.isPending ? 'Queueing…' : 'Run duplicate scan'}
              </button>
            </div>
          )}
          {scanError && <p className="px-4 pb-3 text-xs text-warning">{scanError}</p>}
        </Section>

        <Section
          icon={<Layers className="h-4 w-4" />}
          title="Merged routes"
          count={merged.length}
          description="One route, several provider records. Open one to check the merged geometry."
        >
          {merged.length > 0 ? (
            merged.map((route) => <RouteLine key={route.id} route={route} onOpen={onOpenRoute} />)
          ) : (
            <p className="px-4 py-3 text-xs text-muted">No route has more than one provider.</p>
          )}
        </Section>

        <Section
          icon={<Route className="h-4 w-4" />}
          title="Unusable geometry"
          count={noShape.length}
          description="Routes whose geometry cannot be drawn or exported. They stay visible so they can be fixed."
        >
          {noShape.length > 0 ? (
            noShape.map((route) => (
              <RouteLine
                key={route.id}
                route={route}
                note={`${formatKm(route.distance_meters)} — no drawable shape`}
                onOpen={onOpenRoute}
              />
            ))
          ) : (
            <p className="px-4 py-3 text-xs text-muted">Every route has a drawable shape.</p>
          )}
        </Section>

        <Section
          icon={<TriangleAlert className="h-4 w-4" />}
          title="Sport mismatch"
          count={sportMismatch.length}
          description="Routes in the library that are not rides. Kept, but flagged."
        >
          {sportMismatch.length > 0 ? (
            sportMismatch.map((route) => (
              <RouteLine
                key={route.id}
                route={route}
                note={`${route.sport_type} · ${formatKm(route.distance_meters)} · ${formatClimb(
                  route.elevation_gain_meters,
                )}`}
                onOpen={onOpenRoute}
              />
            ))
          ) : (
            <p className="px-4 py-3 text-xs text-muted">Every route is a ride.</p>
          )}
        </Section>

        <Section
          icon={<Tags className="h-4 w-4" />}
          title="Collections & tags"
          count={tags}
          description="Group routes without moving them. Smart collections re-fill from rules."
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-muted">
              {tags > 0 ? `${tags} tag assignments across the library.` : 'No tags yet.'}
            </p>
            <button
              type="button"
              onClick={onOpenCollections}
              className="h-9 rounded-lg border border-surface-light/70 px-4 text-xs font-medium text-foreground hover:bg-surface-light/30"
            >
              Manage collections
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border border-surface-light/60 bg-surface/80 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
