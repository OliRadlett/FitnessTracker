'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Activity, ActivitySource } from '@/lib/api';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { WeatherBadge } from '@/components/activities/WeatherBadge';
import { ActivityContextBadges, TssSourceBadge } from '@/components/activities/ActivityContextBadges';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { formatDistance, formatDuration, getActiveLocale } from '@/lib/utils';
import { STRENGTH_TYPES } from '@/lib/sportUtils';
import { ChevronDown, MapPin } from 'lucide-react';

/** Compact provider pills (max 2 + overflow) — the entry is a row, not a card. */
function SourcePills({ sources }: { sources?: ActivitySource[] }) {
  if (!sources || sources.length === 0) return null;
  const unique = Array.from(new Map(sources.map((s) => [s.provider, s])).values());
  const shown = unique.slice(0, 2);
  const overflow = unique.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1">
      {shown.map((s) => (
        <span
          key={s.id}
          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs text-foreground ${PROVIDER_COLORS[s.provider] || 'bg-muted'}`}
          title={`${s.provider}: ${s.provider_name || s.provider_activity_id}`}
        >
          <ProviderIcon provider={s.provider} /> {s.provider}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center rounded-full bg-muted/20 px-1.5 py-0.5 text-xs text-muted"
          title={unique.slice(2).map((s) => s.provider).join(', ')}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

/** One metric with its label, so the row scans without guessing units. */
function Metric({ value, label, className = 'text-foreground' }: { value: string; label: string; className?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={`text-sm font-semibold tabular-nums ${className}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </span>
  );
}

const ZONE_COLORS = [
  'bg-slate-500/70',
  'bg-sky-500/70',
  'bg-emerald-500/70',
  'bg-yellow-500/70',
  'bg-orange-500/70',
  'bg-red-500/70',
  'bg-fuchsia-500/70',
];

/**
 * A single diary entry — the rich signal the old Activities card carried
 * (weather, route, power/HR, TSS provenance, ride context, linked lift),
 * rendered as a scannable row with an in-place expand rather than a card.
 */
export function JournalEntry({ activity }: { activity: Activity }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isStrength = STRENGTH_TYPES.includes(activity.sport_type);
  const rideContext = activity.ride_context ?? null;
  const zones = rideContext?.power_zones ?? [];
  const hasExpand = Boolean(rideContext) || Boolean(activity.linked_lifting_session);
  const detailHref = `/activities?activity=${activity.id}`;

  const time = new Date(activity.start_date).toLocaleTimeString(getActiveLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={() => router.push(detailHref)}
      className="group flex cursor-pointer gap-3 border-b border-surface-light/40 px-1 py-3 transition-colors last:border-b-0 hover:bg-surface-light/20"
    >
      {/* Time gutter — anchors the diary line */}
      <div className="hidden w-11 shrink-0 pt-0.5 text-right sm:block">
        <span className="text-xs tabular-nums text-muted">{time}</span>
      </div>

      <div className="min-w-0 flex-1">
        {/* Title line */}
        <div className="flex items-center gap-2">
          <Badge variant={getSportBadgeVariant(activity.sport_type)}>{activity.sport_type}</Badge>
          <Link
            href={detailHref}
            onClick={stop}
            className="min-w-0 truncate font-medium text-foreground transition-colors group-hover:text-accent"
          >
            {activity.name}
          </Link>
        </div>

        {/* Meta line — provenance, route, weather */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SourcePills sources={activity.sources} />
          {activity.route_id ? (
            <Link
              href={`/routes?route=${activity.route_id}`}
              onClick={stop}
              className="inline-flex min-h-[24px] items-center gap-0.5 text-xs text-accent/70 transition-colors hover:text-accent"
              title={`View route: ${activity.route_name || 'Route'}`}
            >
              <MapPin className="h-3 w-3" aria-hidden /> {activity.route_name || 'Route'}
            </Link>
          ) : activity.route_name ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-accent">
              <MapPin className="h-3 w-3" aria-hidden /> {activity.route_name}
            </span>
          ) : null}
          <WeatherBadge
            temperature={activity.weather_temperature ?? null}
            conditions={activity.weather_conditions ?? null}
            wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
            wind_direction={activity.weather_wind_direction ?? null}
            precipitation_mm={activity.weather_precipitation_mm ?? null}
          />
        </div>

        {/* Metric line */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {!isStrength && activity.distance_meters ? (
            <Metric value={formatDistance(activity.distance_meters)} label="dist" />
          ) : null}
          {activity.duration_seconds ? (
            <Metric value={formatDuration(activity.duration_seconds)} label="time" />
          ) : null}
          {!isStrength && activity.elevation_gain_meters ? (
            <Metric value={`${Math.round(activity.elevation_gain_meters)} m`} label="elev" className="text-muted" />
          ) : null}
          {!isStrength && activity.average_power ? (
            <Metric value={`${Math.round(activity.average_power)} W`} label="avg" className="text-yellow-400" />
          ) : null}
          {!isStrength && activity.normalized_power ? (
            <Metric value={`${Math.round(activity.normalized_power)} W`} label="NP" className="text-yellow-400/80" />
          ) : null}
          {!isStrength && activity.average_heartrate ? (
            <Metric value={`${Math.round(activity.average_heartrate)}`} label="bpm" className="text-warning/80" />
          ) : null}
          {activity.tss != null && activity.tss > 0 ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="text-sm font-semibold tabular-nums text-blue-400">{Math.round(activity.tss)}</span>
              <span className="text-xs text-muted">TSS</span>
              <TssSourceBadge source={activity.tss_source ?? rideContext?.tss_source} />
            </span>
          ) : null}
          {activity.rpe != null && activity.rpe > 0 ? (
            <Metric value={`${activity.rpe}`} label="RPE" className="text-orange-400" />
          ) : null}
        </div>

        {/* In-place expand — ride context, power zones, deeper links */}
        {hasExpand && open && (
          <div className="mt-3 space-y-3 rounded-lg bg-surface-light/20 p-3" onClick={stop}>
            <ActivityContextBadges
              context={{ sport_type: activity.sport_type, ride_metrics: rideContext, load_context: null }}
            />

            {zones.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted">Power zones</p>
                {zones.map((zone, i) => (
                  <div key={zone.zone_name} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate text-xs text-muted">{zone.zone_label || zone.zone_name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-light/60">
                      <div
                        className={`h-full rounded-full ${ZONE_COLORS[i % ZONE_COLORS.length]}`}
                        style={{ width: `${Math.min(100, Math.max(1, zone.pct))}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted">
                      {formatDuration(zone.seconds)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {activity.linked_lifting_session && (
              <Link
                href={`/lifting?session=${activity.linked_lifting_session.id}`}
                onClick={stop}
                className="block text-xs text-accent transition-colors hover:text-accent-hover"
              >
                Linked lift: {activity.linked_lifting_session.focus || 'Session'} ·{' '}
                {activity.linked_lifting_session.set_count} sets
                {activity.linked_lifting_session.total_volume_kg
                  ? ` · ${Math.round(activity.linked_lifting_session.total_volume_kg).toLocaleString()} kg`
                  : ''}
              </Link>
            )}

            <Link
              href={detailHref}
              onClick={stop}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-hover"
            >
              Open full analysis →
            </Link>
          </div>
        )}
      </div>

      {/* Expand toggle */}
      {hasExpand && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-label={open ? 'Hide details' : 'Show details'}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg text-muted transition-colors hover:bg-surface-light/40 hover:text-foreground"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    </div>
  );
}
