'use client';

import { useState } from 'react';
import { Copy, Layers, Route, Tags, TriangleAlert } from 'lucide-react';
import type { RouteSummary } from '@/lib/api/types';
import {
  decodePolyline,
  formatClimb,
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
 * queue is on demand — the scan runs full geometry inside the request today,
 * so auto-loading it would wedge the page (and the backend worker).
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
  const [scanOpen, setScanOpen] = useState(false);
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
          count={scanOpen ? '—' : 'on demand'}
          description="Find routes that are the same ride from different providers. The scan runs full-resolution geometry, so it can take minutes on a large library."
        >
          {scanOpen ? (
            <div className="p-3">
              <DuplicatesTab />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="text-xs text-muted">
                Nothing is scanned until you ask. Merging is always confirmed by you.
              </p>
              <button
                type="button"
                onClick={() => setScanOpen(true)}
                className="h-9 rounded-lg bg-accent px-4 text-xs font-semibold text-white"
              >
                Run duplicate scan
              </button>
            </div>
          )}
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
