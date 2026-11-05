'use client';

/**
 * Rides — the ride index. Every ride, one line each, with one open.
 *
 * The open ride is deliberately an index entry, not a ride deep-dive: per-ride
 * streams live on the activity page, and inventing a zone split here would be the
 * kind of number this page exists to remove.
 */
import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Delta, Metric, Panel, PanelHead, TypeChip, num } from './CyclingUi';
import { formatDuration, formatShortDate, formatDayDate, type RideRow } from '@/lib/cycling/selectors';

export type RidesModeProps = {
  rides: RideRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const speedKmh = (r: RideRow) => (r.distanceKm && r.movingSeconds ? (r.distanceKm / r.movingSeconds) * 3600 : null);
const climbRate = (r: RideRow) => (r.elevationM && r.movingSeconds ? (r.elevationM / r.movingSeconds) * 3600 : null);
const density = (r: RideRow) => (r.tss && r.movingSeconds ? (r.tss / r.movingSeconds) * 3600 : null);

const RIDE_TYPES = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2max'] as const;

export function RidesMode({ rides, selectedId, onSelect }: RidesModeProps) {
  const [filter, setFilter] = React.useState<string>('all');

  const counts = React.useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rides) {
      const key = r.rideType ?? 'unclassified';
      c.set(key, (c.get(key) ?? 0) + 1);
    }
    return c;
  }, [rides]);

  const rows = filter === 'all' ? rides : rides.filter((r) => (r.rideType ?? 'unclassified') === filter);
  const selected = rides.find((r) => r.id === selectedId) ?? rows[0] ?? null;

  const med = {
    speed: median(rides.map(speedKmh).filter((v): v is number => v != null)),
    climb: median(rides.map(climbRate).filter((v): v is number => v != null)),
    density: median(rides.map(density).filter((v): v is number => v != null)),
  };

  const listRef = React.useRef<HTMLUListElement | null>(null);
  const rowRef = React.useRef<HTMLLIElement | null>(null);
  React.useEffect(() => {
    const box = listRef.current;
    const row = rowRef.current;
    if (!box || !row || !selectedId) return;
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - 8;
  }, [selectedId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Panel className="p-0">
        <div className="p-4 pb-2 sm:p-5 sm:pb-2">
          <PanelHead title="All rides" hint={`${rows.length} of ${rides.length} shown`} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(['all', ...RIDE_TYPES, 'unclassified'] as const).map((t) => {
              const count = t === 'all' ? rides.length : counts.get(t) ?? 0;
              if (t !== 'all' && count === 0) return null;
              const on = filter === t;
              return (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`min-h-[44px] rounded-full border px-2.5 text-[12px] font-medium ${
                    on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-surface-light/50 text-muted'
                  }`}
                >
                  {t === 'all' ? 'All' : t === 'unclassified' ? 'Unclassified' : t} <span className="tabular-nums opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <ul ref={listRef} className="max-h-[504px] divide-y divide-surface-light/30 overflow-y-auto [scrollbar-width:thin]">
          {rows.map((r) => {
            const on = selected?.id === r.id;
            return (
              <li key={r.id} ref={r.id === selectedId ? rowRef : undefined}>
                <button
                  onClick={() => onSelect(r.id)}
                  className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left sm:px-5 ${on ? 'bg-surface-light/30' : ''}`}
                >
                  <span className="w-[70px] shrink-0 text-[12px] text-muted">{formatShortDate(r.date)}</span>
                  <span className="w-[64px] shrink-0 text-[15px] font-semibold tabular-nums">
                    {num(r.distanceKm, 1)}
                    <span className="text-[12px] font-normal text-muted"> km</span>
                  </span>
                  <span className="hidden w-[52px] shrink-0 text-[12px] tabular-nums text-muted sm:block">
                    {formatDuration(r.movingSeconds)}
                  </span>
                  <span className="w-[46px] shrink-0 text-[12px] tabular-nums text-muted">{num(r.tss)}</span>
                  <span className="ml-auto shrink-0">
                    <TypeChip type={r.rideType} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel className="h-fit p-4 sm:p-5" anchor="ride-detail">
        {selected ? (
          <>
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ride</p>
            <h2 className="mt-1 text-[20px] font-semibold leading-tight">{formatDayDate(selected.date)}</h2>
            <div className="mt-2 flex items-center gap-2">
              <TypeChip type={selected.rideType} />
              <span className="text-[12px] text-muted">{selected.hasStreams ? 'streams on file' : 'no streams'}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Metric label="Distance" value={`${num(selected.distanceKm, 1)} km`} />
              <Metric label="Moving time" value={formatDuration(selected.movingSeconds)} />
              <Metric label="Elevation" value={`${num(selected.elevationM)} m`} />
              <Metric label="Load" value={`${num(selected.tss)} TSS`} />
            </div>

            <div className="mt-4 h-px bg-surface-light/40" />
            <p className="mt-3 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">How it compares</p>
            <ul className="mt-2 space-y-2">
              <CompareRow label="Speed" value={speedKmh(selected)} median={med.speed} format={(v) => `${v.toFixed(1)} km/h`} />
              <CompareRow label="Climbing" value={climbRate(selected)} median={med.climb} format={(v) => `${Math.round(v)} m/h`} />
              <CompareRow label="Density" value={density(selected)} median={med.density} format={(v) => `${Math.round(v)} TSS/h`} />
            </ul>
            <p className="mt-2 text-[12px] text-muted">Median of this account&apos;s {rides.length} rides.</p>

            {selected.avgPower != null && (
              <>
                <div className="mt-4 h-px bg-surface-light/40" />
                <div className="mt-3 flex items-end justify-between">
                  <Metric label="Average power" value={`${num(selected.avgPower, 1)} W`} />
                  <Link
                    href={`/fittrack/activity/${selected.id}`}
                    className="inline-flex min-h-[44px] items-center gap-1 text-[12px] font-medium text-accent"
                  >
                    Full ride <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              </>
            )}

            <p className="mt-3 text-[12px] text-muted">
              Zone-by-zone detail for a single ride lives on the activity page — this page holds the index, not the
              streams.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-muted">No ride matches that filter.</p>
        )}
      </Panel>
    </div>
  );
}

function CompareRow({
  label,
  value,
  median,
  format,
}: {
  label: string;
  value: number | null;
  median: number | null;
  format: (v: number) => string;
}) {
  const pct = value != null && median ? ((value - median) / median) * 100 : null;
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium tabular-nums">{value != null ? format(value) : '—'}</span>
        <Delta value={pct} digits={0} suffix="%" />
      </span>
    </li>
  );
}
