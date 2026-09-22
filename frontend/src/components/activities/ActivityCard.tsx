'use client';

import Link from 'next/link';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { WeatherBadge } from '@/components/activities/WeatherBadge';
import { formatDistance, formatDuration } from '@/lib/utils';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { STRENGTH_TYPES } from '@/lib/sportUtils';
import type { Activity, ActivitySource, ActivityContext } from '@/lib/api';
import { ActivityConnectionsBar } from '@/components/activities/ActivityConnectionsBar';
import { ActivityContextBadges, TssSourceBadge } from '@/components/activities/ActivityContextBadges';
import { ActivityHealthOverlay } from '@/components/activities/ActivityHealthOverlay';

// ── Source Badges ────────────────────────────────────────────────────────────

function SourceBadges({ sources }: { sources?: ActivitySource[] }) {
  if (!sources || sources.length === 0) return null;
  const unique = Array.from(new Map(sources.map(s => [s.provider, s])).values());
  // Badge budget (1.2): max 2 provider pills, overflow collapses to +n.
  const shown = unique.slice(0, 2);
  const overflow = unique.length - shown.length;
  return (
    <div className="flex items-center gap-1">
      {shown.map((s) => (
        <span
          key={s.id}
          className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full text-foreground ${PROVIDER_COLORS[s.provider] || 'bg-muted'}`}
          title={`${s.provider}: ${s.provider_name || s.provider_activity_id}`}
        >
          <ProviderIcon provider={s.provider} /> {s.provider}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full text-muted bg-muted/20"
          title={unique.slice(2).map((s) => `${s.provider}: ${s.provider_name || s.provider_activity_id}`).join('\n')}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── Activity Card ────────────────────────────────────────────────────────────

export function ActivityCard({
  activity,
  isSelected,
  onSelect,
  showCompareCheckbox,
  isCompareSelected,
  onToggleCompare,
  showBulkCheckbox,
  isBulkSelected,
  onToggleBulk,
  context,
}: {
  activity: Activity;
  isSelected: boolean;
  onSelect: () => void;
  showCompareCheckbox?: boolean;
  isCompareSelected?: boolean;
  onToggleCompare?: () => void;
  showBulkCheckbox?: boolean;
  isBulkSelected?: boolean;
  onToggleBulk?: () => void;
  context?: ActivityContext | null;
}) {
  const isStrength = STRENGTH_TYPES.includes(activity.sport_type);

  return (
    <Card
      onClick={onSelect}
      className={isSelected ? 'border-accent/50' : ''}
    >
      <div className="space-y-2">
        <div className="flex items-start gap-4">
          {(showBulkCheckbox || (showCompareCheckbox && !showBulkCheckbox)) && (
            <label
              className="flex items-center justify-center min-h-[44px] min-w-[44px] -my-2"
              onClick={(e) => e.stopPropagation()}
              title={showBulkCheckbox ? "Select for bulk action" : "Select for comparison"}
            >
              <input
                type="checkbox"
                checked={showBulkCheckbox ? isBulkSelected : isCompareSelected}
                onChange={showBulkCheckbox ? onToggleBulk : onToggleCompare}
                className="w-4 h-4 rounded border-surface-light bg-surface-light text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
              />
            </label>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={getSportBadgeVariant(activity.sport_type)}>
                {activity.sport_type}
              </Badge>
              <p className="font-medium text-foreground truncate">{activity.name}</p>
              <SourceBadges sources={activity.sources} />
            </div>
            <p className="text-xs text-muted mt-0.5">
              {new Date(activity.start_date).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {activity.route_name && (
                <span className="ml-2 text-accent">{'\u{1F4CD}'} {activity.route_name}</span>
              )}
              {activity.route_id && (
                <Link
                  href={`/routes?route=${activity.route_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-2 min-h-[44px] text-accent/70 hover:text-accent transition-colors inline-flex items-center gap-0.5"
                  title={`View route: ${activity.route_name || 'Route'}`}
                >
                  View route
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </Link>
              )}
              <WeatherBadge
                temperature={activity.weather_temperature ?? null}
                conditions={activity.weather_conditions ?? null}
                wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
                wind_direction={activity.weather_wind_direction ?? null}
                precipitation_mm={activity.weather_precipitation_mm ?? null}
              />
            </p>
          </div>
        </div>

        {/* Connections Bar — PR/Plan/AI/Fuel badges */}
        {context?.connections && Object.keys(context.connections).some(() => {
          const c = context.connections;
          return c.training_plan_day || (c.personal_records?.length ?? 0) > 0 || c.ai_analysis || c.fuel_plan || c.linked_lifting_session;
        }) && (
          <div onClick={(e) => e.stopPropagation()}>
            <ActivityConnectionsBar connections={context.connections} activityId={activity.id} />
          </div>
        )}

        {/* Stats row — enhanced with analytical metrics */}
        <div className="flex items-center gap-4 text-sm pl-0 flex-wrap">
          {!isStrength && activity.distance_meters ? (
            <span className="text-muted">{formatDistance(activity.distance_meters)}</span>
          ) : null}
          {activity.duration_seconds ? (
            <span className="text-muted">{formatDuration(activity.duration_seconds)}</span>
          ) : null}
          {!isStrength && activity.average_power ? (
            <span className="text-yellow-400">{activity.average_power} W</span>
          ) : null}
          {!isStrength && activity.normalized_power ? (
            <span className="text-yellow-400/70">{activity.normalized_power.toFixed(0)} W NP</span>
          ) : null}
          {!isStrength && activity.average_cadence ? (
            <span className="text-muted">{Math.round(activity.average_cadence)} rpm</span>
          ) : null}
          {!isStrength && activity.max_heartrate ? (
            <span className="text-warning">{Math.round(activity.max_heartrate)} bpm</span>
          ) : null}
          {!isStrength && activity.average_heartrate ? (
            <span className="text-warning/70">{Math.round(activity.average_heartrate)} bpm avg</span>
          ) : null}
          {activity.tss != null && activity.tss > 0 ? (
            <span className="text-blue-400 inline-flex items-center gap-1">
              {activity.tss} TSS
              {/* QW4 — power vs HR vs provider provenance */}
              <TssSourceBadge source={activity.tss_source ?? context?.ride_metrics?.tss_source} />
            </span>
          ) : null}
          {activity.rpe != null && activity.rpe > 0 ? (
            <span className="text-orange-400">RPE {activity.rpe}</span>
          ) : null}
          {!isStrength && activity.calories ? (
            <span className="text-muted">{Math.round(activity.calories)} cal</span>
          ) : null}
        </div>

        {/* Analytical context badges (IF/VI/decoupling/speed/climbing/EF/load) */}
        {context?.ride_metrics && (
          <div onClick={(e) => e.stopPropagation()}>
            <ActivityContextBadges context={context} />
          </div>
        )}

        {/* Health overlay (HRV/recovery/sleep from day before) */}
        {context?.health_overlay && (
          <div onClick={(e) => e.stopPropagation()}>
            <ActivityHealthOverlay health={context.health_overlay} />
          </div>
        )}
      </div>

      {/* Linked Lifting Session indicator */}
      {activity.linked_lifting_session && (
        <Link
          href={`/lifting?session=${activity.linked_lifting_session.id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg block transition-colors hover:border-purple-400/40"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">Lifting</span>
            <span className="text-sm text-foreground">{activity.linked_lifting_session.focus || 'Lifting Session'}</span>
          </div>
          <div className="flex gap-4 text-xs text-muted">
            <span>{new Date(activity.linked_lifting_session.session_date).toLocaleDateString()}</span>
            <span>{activity.linked_lifting_session.set_count} sets</span>
            {activity.linked_lifting_session.total_volume_kg && (
              <span>{Math.round(activity.linked_lifting_session.total_volume_kg).toLocaleString()} kg volume</span>
            )}
          </div>
        </Link>
      )}
    </Card>
  );
}
