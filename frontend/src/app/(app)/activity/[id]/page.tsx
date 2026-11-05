'use client';

/**
 * `/activity/[id]` — one session.
 *
 * This replaces `/activities?activity=<id>`, which mounted the entire 50-row
 * legacy list to show a single ride. A ride gets its route, streams, zones and
 * context; a lift gets its volume, sets and session facts. The two are separate
 * layouts on purpose — a shared one would show an em dash in half the panels.
 */

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ActivityDetail, LiftingSession, RideAnalysis } from '@/lib/api';
import { describeActivity, formatRowDuration, formatVolumeKg } from '@/lib/journal';
import { isStrengthType } from '@/lib/sportUtils';
import {
  ALTITUDE_STREAM_TYPES,
  HEARTRATE_STREAM_TYPES,
  POWER_STREAM_TYPES,
  getStreamValues,
} from '@/lib/streams';
import { seriesArea } from '@/lib/route-shape';
import { formatDistance, formatDuration, getActiveLocale } from '@/lib/utils';
import { RouteShape } from '@/components/activity/RouteShape';
import { StreamChart } from '@/components/activity/StreamChart';
import { FuelPlanCard } from '@/components/cycling/FuelPlanCard';
import { ErrorState } from '@/components/ui/ErrorState';

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted/45">{label}</dt>
      <dd className="text-[16px] font-semibold leading-none tabular-nums text-foreground">{value}</dd>
      {sub && <span className="text-[10px] tabular-nums text-muted/45">{sub}</span>}
    </div>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted/45">{children}</h2>
      {aside && <span className="text-[10.5px] tabular-nums text-muted/40">{aside}</span>}
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.04] py-2 last:border-b-0">
      <dt className="text-[11px] text-muted/60">{label}</dt>
      <dd className="text-[11.5px] font-medium tabular-nums text-foreground/85">{value}</dd>
    </div>
  );
}

function ZoneBars({ zones }: { zones: RideAnalysis['power_zones'] }) {
  const total = zones.reduce((sum, zone) => sum + zone.seconds, 0) || 1;
  return (
    <div className="flex flex-col gap-2.5">
      {zones.map((zone, index) => (
        <div key={zone.zone_name} className="flex items-center gap-3">
          <span className="w-4 shrink-0 text-[10px] tabular-nums text-muted/45">{zone.zone_name}</span>
          <span className="w-[92px] shrink-0 truncate text-[11px] text-muted/75">{zone.zone_label}</span>
          <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1, (zone.seconds / total) * 100)}%`,
                background: `rgb(var(--accent) / ${0.85 - index * 0.09})`,
              }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-[10.5px] tabular-nums text-muted/55">
            {formatRowDuration(zone.seconds)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A stream can be 8k points; an SVG path does not need them all. */
function decimate(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const step = values.length / max;
  return Array.from({ length: max }, (_, i) => values[Math.floor(i * step)]);
}

function byExercise(sets: LiftingSession['sets']) {
  const groups = new Map<string, LiftingSession['sets']>();
  for (const set of sets) {
    const list = groups.get(set.exercise_name) ?? [];
    list.push(set);
    groups.set(set.exercise_name, list);
  }
  return [...groups.entries()]
    .map(([name, list]) => ({
      name,
      sets: list,
      volume: list.reduce((sum, set) => sum + (set.weight_kg ?? 0) * (set.reps ?? 1), 0),
      top: list.reduce<LiftingSession['sets'][number] | null>(
        (best, set) => (!best || (set.weight_kg ?? 0) > (best.weight_kg ?? 0) ? set : best),
        null,
      ),
    }))
    .sort((a, b) => b.volume - a.volume);
}

export default function ActivityPage({ params }: { params: { id: string } }) {
  const { authFetch, token } = useAuthFetch();

  const detailQuery = useQuery<ActivityDetail>({
    queryKey: ['activity-detail', params.id],
    queryFn: () => authFetch<ActivityDetail>(`/api/v1/activities/${params.id}`),
    enabled: !!token,
  });

  const activity = detailQuery.data;
  const isRide = activity?.sport_type === 'cycling';
  const isLift = activity ? isStrengthType(activity.sport_type) : false;
  // Runs, swims, hikes and walks use the endurance layout; they are not lifts,
  // and the two-way branch used to give them a "no set log" panel.
  const isEndurance = Boolean(activity) && !isLift;

  const analysisQuery = useQuery<RideAnalysis>({
    queryKey: ['activity-analysis', params.id],
    queryFn: () => authFetch<RideAnalysis>(`/api/v1/activities/${params.id}/analysis`),
    enabled: !!token && isRide,
  });

  const linkedSessionId = activity?.linked_lifting_session?.id;
  const liftingQuery = useQuery<LiftingSession>({
    queryKey: ['lifting-session', linkedSessionId],
    queryFn: () => authFetch<LiftingSession>(`/api/v1/lifting/sessions/${linkedSessionId}`),
    enabled: !!token && !!linkedSessionId,
  });

  const analysis = analysisQuery.data;
  const lifting = liftingQuery.data;
  const groups = useMemo(() => (lifting ? byExercise(lifting.sets) : []), [lifting]);
  const maxVolume = Math.max(1, ...groups.map((group) => group.volume));

  // Stream names differ by provider ("watts" from Strava, "power" from FIT), so
  // the alias lists in lib/streams are the only correct lookup. A ride without a
  // power meter still has heart rate, altitude and velocity — and must still
  // chart them rather than claiming it has no streams.
  const watts = useMemo(
    () => getStreamValues(activity?.streams, ...POWER_STREAM_TYPES),
    [activity?.streams],
  );
  const heartrate = useMemo(
    () => getStreamValues(activity?.streams, ...HEARTRATE_STREAM_TYPES),
    [activity?.streams],
  );
  const altitude = useMemo(
    () => getStreamValues(activity?.streams, ...ALTITUDE_STREAM_TYPES),
    [activity?.streams],
  );
  const hasStreams = watts.length > 1 || heartrate.length > 1;

  const elevation = useMemo(
    () => (altitude.length > 1 ? seriesArea(decimate(altitude, 700), 820, 64) : null),
    [altitude],
  );

  if (detailQuery.isError) {
    return (
      <div className="space-y-5">
        <Link href="/journal" className="text-[11.5px] text-muted hover:text-foreground">
          ← Activity
        </Link>
        <ErrorState
          title="Couldn’t load this session"
          message="It may have been removed, or the connection dropped."
          onRetry={() => detailQuery.refetch()}
        />
      </div>
    );
  }

  if (detailQuery.isLoading || !activity) {
    return (
      <div className="space-y-4" aria-label="Loading activity">
        <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
        <div className="h-8 w-2/3 animate-pulse rounded bg-white/[0.06]" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" />
      </div>
    );
  }

  const row = describeActivity(activity);
  const rawSource = activity.sources?.[0]?.provider ?? activity.source;
  const source = rawSource.charAt(0).toUpperCase() + rawSource.slice(1);
  // Only rows that have a value: a ride without a power meter has no IF, zones
  // or decoupling, and a column of em dashes says less than nothing.
  const contextRows: { label: string; value: string }[] = [];
  const addContext = (label: string, value: string | null | undefined) => {
    if (value) contextRows.push({ label, value });
  };
  addContext('Variability', analysis?.variability_index ? analysis.variability_index.toFixed(2) : null);
  addContext('Efficiency', analysis?.efficiency_factor ? analysis.efficiency_factor.toFixed(2) : null);
  addContext(
    'Decoupling',
    analysis?.decoupling?.decoupling_pct != null ? `${analysis.decoupling.decoupling_pct.toFixed(1)}%` : null,
  );
  addContext('VAM', analysis?.vam ? `${Math.round(analysis.vam)} m/h` : null);
  addContext(
    'Max gradient',
    analysis?.climbing_analysis?.max_gradient_pct
      ? `${analysis.climbing_analysis.max_gradient_pct.toFixed(1)}%`
      : null,
  );
  if (contextRows.length > 0) contextRows.push({ label: 'Source', value: source });

  // Only the metrics that exist. A ride without a power meter used to show
  // three em dashes where a number should be.
  const metrics: { label: string; value: string; sub?: string }[] = [];
  const addMetric = (label: string, value: string | null | undefined, sub?: string) => {
    if (value) metrics.push({ label, value, sub });
  };
  const durationLabel = activity.duration_seconds ? formatRowDuration(activity.duration_seconds) : null;
  const heartLabel = activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm` : null;
  const caloriesLabel = activity.calories ? `${Math.round(activity.calories)} kcal` : null;

  if (isEndurance) {
    addMetric('Distance', activity.distance_meters ? formatDistance(activity.distance_meters, 1) : null);
    addMetric('Moving', durationLabel);
    addMetric('Elevation', activity.elevation_gain_meters ? `${Math.round(activity.elevation_gain_meters)} m` : null);
    addMetric('Load', activity.tss ? String(Math.round(activity.tss)) : null, activity.tss ? 'TSS' : undefined);
    if (isRide) {
      addMetric('Avg power', activity.average_power ? `${Math.round(activity.average_power)} W` : null);
      addMetric('Normalised', activity.normalized_power ? `${Math.round(activity.normalized_power)} W` : null);
      addMetric(
        'Intensity',
        analysis?.intensity_factor ? analysis.intensity_factor.toFixed(2) : null,
        analysis?.intensity_factor ? 'IF' : undefined,
      );
    }
    addMetric('Avg HR', heartLabel);
    addMetric('Calories', caloriesLabel);
  } else if (lifting) {
    addMetric('Volume', lifting.total_volume_kg ? formatVolumeKg(lifting.total_volume_kg) : null);
    addMetric('Sets', String(lifting.sets.length));
    addMetric('Duration', durationLabel);
    addMetric(
      'Est. load',
      lifting.estimated_tss ? lifting.estimated_tss.toFixed(1) : null,
      lifting.estimated_tss ? 'TSS' : undefined,
    );
    addMetric('Avg HR', heartLabel);
    addMetric('Calories', caloriesLabel);
  } else {
    addMetric('Duration', durationLabel);
    addMetric('Avg HR', heartLabel);
    addMetric('Calories', caloriesLabel);
  }
  const date = new Date(activity.start_date);
  const dateLabel = date.toLocaleDateString(getActiveLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeLabel = date.toLocaleTimeString(getActiveLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const subtitle = isEndurance
    ? [
        formatDistance(activity.distance_meters, 1),
        activity.elevation_gain_meters ? `${Math.round(activity.elevation_gain_meters)} m climbed` : null,
        formatRowDuration(activity.duration_seconds),
      ]
        .filter(Boolean)
        .join('  ·  ')
    : [
        lifting?.focus ? `${lifting.focus.charAt(0).toUpperCase()}${lifting.focus.slice(1)} day` : null,
        lifting?.total_volume_kg ? formatVolumeKg(lifting.total_volume_kg) : null,
        // A lift with no set log still has a duration and often a heart rate;
        // saying "no summary fields recorded" beside three real numbers is wrong.
        !lifting ? formatRowDuration(activity.duration_seconds) : null,
        !lifting && activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm avg` : null,
      ]
        .filter(Boolean)
        .join('  ·  ');

  return (
    <div className="mx-auto w-full max-w-[880px] pb-16">
      <Link href="/journal" className="inline-flex min-h-[32px] items-center gap-1.5 text-[11px] text-muted/60 transition-colors hover:text-foreground">
        ← Activity
      </Link>

      <header className="mt-4">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.15em] text-muted/50">
          {dateLabel} · {timeLabel} · {source}
        </p>
        <h1 className="mt-2 text-[22px] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[26px]">
          {row.title}
        </h1>
        <p className="mt-2 text-[12px] tabular-nums text-muted/65">{subtitle || 'No summary fields recorded'}</p>
      </header>

      <dl className="mt-6 grid grid-cols-3 gap-x-5 gap-y-5 border-y border-white/[0.06] py-5 sm:grid-cols-4">
        {metrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} sub={metric.sub} />
        ))}
      </dl>

      {isRide && analysis?.normalized_power_convention === 'includes_coasting_zeros' ? (
        <p className="mt-2 text-[10px] leading-relaxed text-muted/45">
          NP includes coasting zeros. Provider summaries may exclude them, so the two numbers are not directly comparable.
        </p>
      ) : null}

      {isEndurance ? (
        <>
          <section className="mt-8">
            <SectionTitle>Route</SectionTitle>
            {activity.encoded_polyline ? (
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.012]">
                <div className="grid grid-cols-3 gap-3 border-b border-white/[0.05] px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-foreground/80">
                      {formatDistance(activity.distance_meters, 1)}
                    </span>
                    <span className="text-[8.5px] uppercase tracking-[0.13em] text-muted/40">distance</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-foreground/80">
                      {activity.elevation_gain_meters ? `${Math.round(activity.elevation_gain_meters)} m` : '—'}
                    </span>
                    <span className="text-[8.5px] uppercase tracking-[0.13em] text-muted/40">climb</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-foreground/80">
                      {analysis?.climbing_analysis?.max_gradient_pct
                        ? `${analysis.climbing_analysis.max_gradient_pct.toFixed(0)}%`
                        : '—'}
                    </span>
                    <span className="text-[8.5px] uppercase tracking-[0.13em] text-muted/40">max gradient</span>
                  </div>
                </div>

                <div className="hidden sm:block">
                  <RouteShape encoded={activity.encoded_polyline} width={820} height={250} padding={40} />
                </div>
                <div className="sm:hidden">
                  <RouteShape encoded={activity.encoded_polyline} width={360} height={300} padding={30} />
                </div>

                {elevation && (
                  <div className="border-t border-white/[0.05] px-3 pb-2 pt-2">
                    <div className="flex items-baseline justify-between pb-1 text-[9px] tabular-nums text-muted/35">
                      <span>elevation</span>
                      <span>
                        {Math.round(elevation.min)}–{Math.round(elevation.max)} m
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 820 64"
                      className="h-14 w-full"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label="Elevation profile"
                    >
                      <path d={elevation.area} fill="rgb(var(--accent) / 0.08)" />
                      <path
                        d={elevation.line}
                        fill="none"
                        stroke="rgb(var(--accent) / 0.45)"
                        strokeWidth={1.1}
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center text-[11.5px] text-muted/50">
                No route recorded for this session.
              </div>
            )}
          </section>

          <div className={`mt-9 grid gap-8 ${contextRows.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_260px]' : ''}`}>
            <section>
              <SectionTitle>Streams</SectionTitle>
              {hasStreams ? (
                <StreamChart watts={watts} hr={heartrate} />
              ) : (
                <p className="text-[11.5px] text-muted/50">No per-second streams stored for this session.</p>
              )}
            </section>

            {/* Only rows with a value: a ride without a power meter has no IF,
                no zones and no decoupling, and six em dashes say less than
                nothing. */}
            {contextRows.length > 0 && (
              <aside>
                <SectionTitle>Context</SectionTitle>
                <dl>
                  {contextRows.map((row) => (
                    <ContextRow key={row.label} label={row.label} value={row.value} />
                  ))}
                </dl>
              </aside>
            )}
          </div>

          {analysis?.power_zones && analysis.power_zones.length > 0 && (
            <section className="mt-9 max-w-[560px]">
              <SectionTitle
                aside={`${formatDuration(analysis.power_zones.reduce((sum, zone) => sum + zone.seconds, 0))} in zone`}
              >
                Time in zone
              </SectionTitle>
              <ZoneBars zones={analysis.power_zones} />
            </section>
          )}

          {isRide && (
            <section className="mt-9">
              <SectionTitle>Fuel plan</SectionTitle>
              <FuelPlanCard activity={activity} />
            </section>
          )}
        </>
      ) : lifting ? (
        <>
          <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
            <section>
              <SectionTitle>Volume by exercise</SectionTitle>
              <div className="flex flex-col gap-4">
                {groups.map((group) => (
                  <div key={group.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[12.5px] text-foreground/85">{group.name}</span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-muted/45">
                        <span className="text-[11.5px] font-medium text-foreground/70">
                          {formatVolumeKg(group.volume)}
                        </span>
                        <span className="px-1.5 text-muted/20">·</span>
                        {group.sets.length} {group.sets.length === 1 ? 'set' : 'sets'}
                      </span>
                    </div>
                    <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full bg-slate-500"
                        style={{ width: `${Math.max(2, (group.volume / maxVolume) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside>
              <SectionTitle>Session</SectionTitle>
              <dl>
                <ContextRow label="Focus" value={lifting.focus ? lifting.focus : '—'} />
                <ContextRow label="Volume" value={formatVolumeKg(lifting.total_volume_kg)} />
                <ContextRow label="Working sets" value={String(lifting.sets.length)} />
                {lifting.program_name && <ContextRow label="Programme" value={lifting.program_name} />}
                <ContextRow
                  label="Est. load"
                  value={lifting.estimated_tss ? `${lifting.estimated_tss.toFixed(1)} TSS` : '—'}
                />
              </dl>
            </aside>
          </div>

          <section className="mt-9">
            <SectionTitle aside={`${lifting.sets.length} sets · heaviest first`}>Sets</SectionTitle>
            <div className="divide-y divide-white/[0.045] border-y border-white/[0.045]">
              {groups.map((group) => (
                <div key={group.name} className="py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-[12.5px] font-medium text-foreground/90">{group.name}</h3>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted/45">
                      {group.sets.length} {group.sets.length === 1 ? 'set' : 'sets'} · top {group.top?.weight_kg ?? '—'} kg
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[...group.sets]
                      .sort((a, b) => (b.weight_kg ?? 0) - (a.weight_kg ?? 0))
                      .map((set) => (
                        <span
                          key={set.id}
                          className="inline-flex items-baseline gap-1 rounded-md border border-white/[0.055] bg-white/[0.02] px-2 py-1 text-[11px] tabular-nums"
                        >
                          <span className="font-medium text-foreground/80">{set.weight_kg ?? 0}</span>
                          <span className="text-muted/40">kg ×</span>
                          <span className="text-foreground/80">{set.reps ?? '—'}</span>
                          {set.rpe != null && <span className="ml-0.5 text-[10px] text-caution/80">@{set.rpe}</span>}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="mt-8 rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center text-[11.5px] text-muted/50">
          This session has no set log — it was synced from {source} without a linked lifting session.
        </div>
      )}
    </div>
  );
}
