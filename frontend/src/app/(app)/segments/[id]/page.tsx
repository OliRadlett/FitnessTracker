'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Pencil, X } from 'lucide-react';

import {
  getSegmentGroup,
  renameSegmentGroup,
  useAuthFetch,
} from '@/lib/api';
import type { SegmentEffort } from '@/lib/api/types';
import { usePageTitle } from '@/lib/usePageTitle';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { ClimbProfile, GradientLegend } from '@/components/segments/ClimbProfile';

const CAT_STYLES: Record<string, string> = {
  HC: 'border-red-500/30 bg-red-500/15 text-red-300',
  '1': 'border-orange-500/30 bg-orange-500/15 text-orange-300',
  '2': 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300',
  '3': 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  '4': 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
};

function fmtTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const fmtKm = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const fmtDateShort = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—';

function StatCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-surface-light/60 bg-surface-light/20 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint ? <p className="text-xs capitalize text-muted/80">{hint}</p> : null}
    </div>
  );
}

function Progression({ efforts }: { efforts: SegmentEffort[] }) {
  const rows = [...efforts]
    .filter((e) => e.assisted !== true && e.started_at)
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
  if (rows.length < 3) return null;
  const times = rows.map((e) => e.moving_seconds ?? e.elapsed_seconds);
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const pad = Math.max((hi - lo) * 0.15, 5);
  const low = lo - pad;
  const high = hi + pad;
  const W = 320;
  const H = 72;
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const y = (v: number) => ((v - low) / Math.max(1, high - low)) * H;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Attempts over time</span>
        <span className="tabular-nums">{fmtTime(lo)} best</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        className="mt-1 w-full overflow-visible"
        role="img"
        aria-label="Elapsed time for each attempt, oldest to newest"
      >
        <polyline
          points={rows
            .map((_, i) => `${x(i)},${y(times[i])}`)
            .join(' ')}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {rows.map((e, i) => (
          <circle
            key={e.id}
            cx={x(i)}
            cy={y(times[i])}
            r={i === rows.length - 1 ? 3.5 : 2.5}
            fill={i === rows.length - 1 ? 'rgb(16 185 129)' : 'rgb(148 163 184)'}
          />
        ))}
      </svg>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>{fmtDateShort(rows[0].started_at)}</span>
        <span>{fmtDateShort(rows[rows.length - 1].started_at)}</span>
      </div>
    </div>
  );
}

export default function SegmentGroupPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['segment-group', id],
    queryFn: () => getSegmentGroup(authFetch, id),
    enabled: !!token && !!id,
    staleTime: 300_000,
  });

  const group = data?.group;
  usePageTitle(group?.name ?? 'Climb');

  const rename = useMutation({
    mutationFn: (name: string | null) => renameSegmentGroup(authFetch, id, name),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['segment-group', id] });
      queryClient.invalidateQueries({ queryKey: ['segment-groups'] });
    },
  });

  const humanEfforts = useMemo(
    () =>
      [...(data?.efforts ?? [])]
        .filter((e) => e.assisted !== true)
        .sort(
          (a, b) =>
            (a.moving_seconds ?? a.elapsed_seconds) -
            (b.moving_seconds ?? b.elapsed_seconds)
        ),
    [data?.efforts]
  );
  const best = group?.best ?? null;
  const comparable = useMemo(() => {
    const ds = humanEfforts.map((e) => {
      const line = data?.segments.find((s) => s.id === e.segment_id);
      return line?.distance_m ?? 0;
    });
    if (!ds.length) return true;
    const max = Math.max(...ds);
    return max - Math.min(...ds) <= max * 0.02;
  }, [data?.segments, humanEfforts]);

  const record = useMemo(() => {
    if (!humanEfforts.length) return null;
    const times = humanEfforts
      .map((e) => e.moving_seconds ?? e.elapsed_seconds)
      .sort((a, b) => a - b);
    const median = times[Math.floor((times.length - 1) / 2)];
    const first = [...humanEfforts].sort((a, b) =>
      (a.started_at ?? '').localeCompare(b.started_at ?? '')
    )[0];
    const firstTime = first.moving_seconds ?? first.elapsed_seconds;
    const improvement =
      comparable && first.id !== humanEfforts[0].id
        ? Math.round(((firstTime - (group?.best?.seconds ?? firstTime)) / firstTime) * 100)
        : null;
    return { median, first, improvement };
  }, [comparable, group?.best?.seconds, humanEfforts]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-3">
        <SkeletonLine className="h-8 w-40" />
        <SkeletonLine className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !group) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          show
          message="Could not load this climb."
          onRetry={() => refetch()}
        />
        <Link href="/segments" className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-xs text-accent">
          <ArrowLeft className="h-4 w-4" /> All climbs
        </Link>
      </div>
    );
  }

  const startEditing = () => {
    setDraft(group.display_name ?? group.name);
    setEditing(true);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/segments"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All climbs
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {group.category ? (
              <span
                className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-xs font-bold ${
                  CAT_STYLES[group.category.toUpperCase()] ?? CAT_STYLES['4']
                }`}
              >
                Cat {group.category.toUpperCase()}
              </span>
            ) : null}
          </div>

          {editing ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label htmlFor="climb-name" className="sr-only">
                Climb name
              </label>
              <input
                id="climb-name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename.mutate(draft.trim() || null);
                  if (e.key === 'Escape') setEditing(false);
                }}
                autoFocus
                maxLength={80}
                className="min-h-[44px] w-full min-w-0 max-w-md flex-1 rounded-lg border border-surface-light/70 bg-surface px-3 text-lg font-bold text-foreground focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => rename.mutate(draft.trim() || null)}
                disabled={rename.isPending}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-accent px-3 text-xs font-semibold text-white disabled:opacity-60"
              >
                <Check className="h-4 w-4" /> Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-surface-light/70 px-3 text-xs text-muted"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
                {group.name}
              </h1>
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`Rename ${group.name}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}

          <p className="mt-1 text-sm text-muted">
            {[group.area, group.region, group.country].filter(Boolean).join(' · ') ||
              group.route_name ||
              'Climb'}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {fmtKm(group.distance_m)} at {group.avg_gradient_pct.toFixed(1)}% ·{' '}
            {Math.round(group.gain_m)} m gain · {group.attempts}{' '}
            {group.attempts === 1 ? 'attempt' : 'attempts'}
          </p>
          {group.name_source === 'user' ? (
            <p className="mt-0.5 text-xs text-accent/80">Your name</p>
          ) : null}
        </div>

        <div className="w-full text-left lg:w-auto lg:text-right">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">
            {best ? 'Personal best' : 'Your record'}
          </p>
          <p
            className={
              best
                ? 'text-2xl font-bold tabular-nums text-positive'
                : 'text-lg font-semibold text-muted'
            }
          >
            {best ? fmtTime(best.seconds) : 'Not ridden yet'}
          </p>
          <p className="text-xs text-muted">
            {best ? fmtDate(best.date) : 'No measured effort'}
          </p>
        </div>
      </div>

      <section className="mt-4 rounded-2xl border border-surface-light/60 bg-surface p-3 sm:p-4">
        <ClimbProfile points={group.profile} height={180} large />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <GradientLegend />
          <p className="text-xs text-muted">
            {group.route_count} route{group.route_count === 1 ? '' : 's'} contain
            this climb
          </p>
        </div>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCell label="Distance" value={fmtKm(group.distance_m)} />
        <StatCell label="Average" value={`${group.avg_gradient_pct.toFixed(1)}%`} />
        <StatCell label="Climbing" value={`${Math.round(group.gain_m)} m`} />
        <StatCell
          label="Steepest 200 m"
          value={`${group.steepest_200m_pct.toFixed(1)}%`}
        />
        <StatCell label="Max gradient" value={`${group.max_gradient_pct.toFixed(1)}%`} />
        <StatCell
          label="Difficulty"
          value={group.difficulty?.toFixed(0) ?? '—'}
          hint="of 100"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-2xl border border-surface-light/60 bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Your attempts
            </h2>
            <p className="text-xs text-muted">
              {humanEfforts.length}{' '}
              {humanEfforts.length === 1 ? 'ride' : 'rides'} · ranked by{' '}
              {comparable ? 'time' : 'climb rate'}
            </p>
          </div>

          {humanEfforts.length === 0 ? (
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
              No measured effort on this hill yet. The profile and stats above
              come from the route geometry; the personal record appears here
              after a ride crosses the climb.
            </p>
          ) : (
            <>
              {comparable ? <Progression efforts={humanEfforts} /> : null}
              <div className="mt-4 grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr] gap-2 border-b border-surface-light/50 pb-1 text-xs text-muted sm:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.7fr]">
                <span>Date</span>
                <span className="text-right">Time</span>
                <span className="text-right">Rate</span>
                <span className="hidden text-right sm:block">Power</span>
                <span className="text-right">vs best</span>
              </div>
              <div className="divide-y divide-surface-light/50">
                {(() => {
                  const ordered = comparable
                    ? humanEfforts
                    : [...humanEfforts].sort(
                        (a, b) =>
                          (b.effort_vam ?? 0) - (a.effort_vam ?? 0)
                      );
                  const base = ordered[0];
                  const bestTime = base
                    ? base.moving_seconds ?? base.elapsed_seconds
                    : 1;
                  const bestRate = base?.effort_vam ?? 1;
                  return ordered.map((e, i) => {
                    const time = e.moving_seconds ?? e.elapsed_seconds;
                    const delta = comparable
                      ? Math.round((time / bestTime - 1) * 100)
                      : Math.round(((e.effort_vam ?? 0) / bestRate - 1) * 100);
                    return (
                      <div
                        key={e.id}
                        className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr] items-center gap-2 py-2 text-xs first:pt-0 last:pb-0 sm:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.7fr]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-foreground">
                            {fmtDate(e.started_at)}
                          </p>
                          <p className="text-muted">
                            km {e.line_km?.[0] ?? '—'}–{e.line_km?.[1] ?? '—'}
                            {i === 0 ? (
                              <span className="ml-1 font-semibold text-yellow-400">
                                Best
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <p className="text-right font-semibold tabular-nums text-foreground">
                          {fmtTime(time)}
                        </p>
                        <p className="text-right tabular-nums text-muted">
                          {e.effort_vam != null
                            ? `${Math.round(e.effort_vam)} m/h`
                            : '—'}
                        </p>
                        <p className="hidden text-right tabular-nums text-muted sm:block">
                          {e.avg_power_watts != null
                            ? `${Math.round(e.avg_power_watts)} W`
                            : '—'}
                        </p>
                        <p
                          className={`text-right tabular-nums ${
                            i === 0 ? 'text-positive' : 'text-muted'
                          }`}
                        >
                          {i === 0
                            ? 'best'
                            : `${delta > 0 ? '+' : ''}${delta}%`}
                        </p>
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </section>

        <div className="space-y-3">
          {record ? (
            <section className="rounded-2xl border border-surface-light/60 bg-surface p-4">
              <h2 className="text-sm font-semibold text-foreground">Your record</h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted">Attempts</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {humanEfforts.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Median</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {fmtTime(record.median)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">First ridden</dt>
                  <dd className="font-semibold tabular-nums text-foreground">
                    {fmtDateShort(record.first.started_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Since first</dt>
                  <dd
                    className={`font-semibold tabular-nums ${
                      (record.improvement ?? 0) > 0
                        ? 'text-positive'
                        : 'text-muted'
                    }`}
                  >
                    {record.improvement == null
                      ? '—'
                      : record.improvement > 0
                        ? `${record.improvement}% faster`
                        : record.improvement < 0
                          ? `${Math.abs(record.improvement)}% slower`
                          : 'same as first'}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-muted/80">
                {comparable
                  ? 'Times are comparable on this hill: every line is within 2% of the same length.'
                  : 'Lines differ in length, so attempts are ranked by climb rate rather than time.'}
              </p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-surface-light/60 bg-surface p-4">
            <h2 className="text-sm font-semibold text-foreground">On the route</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {group.route_count > 1
                ? `${group.route_count} route records contain this climb.`
                : 'The only route record containing this climb.'}
            </p>
            <ul className="mt-2 space-y-1.5">
              {(data?.route_names ?? []).slice(0, 6).map((r) => (
                <li key={r} className="text-xs leading-snug text-foreground">
                  {r}
                </li>
              ))}
            </ul>
          </section>

          {group.attempts === 0 && group.prediction ? (
            <section className="rounded-2xl border border-surface-light/60 bg-surface p-4">
              <h2 className="text-sm font-semibold text-foreground">
                What it might take
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                A comparable-climb model expects about{' '}
                <span className="font-semibold text-foreground">
                  {fmtTime(group.prediction.seconds)}
                </span>
                . This is an estimate, not a measurement.
              </p>
              <p className="mt-2 text-xs text-muted">
                Confidence:{' '}
                {(group.prediction.confidence ?? 0) >= 0.7
                  ? 'high'
                  : (group.prediction.confidence ?? 0) >= 0.4
                    ? 'medium'
                    : 'low'}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <p className="pt-3 text-xs text-muted/80">
        Areas © OpenStreetMap contributors (ODbL). Profile and stats are derived
        from the route geometry; attempts are measured efforts.
      </p>
    </div>
  );
}
