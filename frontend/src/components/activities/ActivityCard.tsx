'use client';

import Link from 'next/link';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { WeatherBadge } from '@/components/cycling/WeatherBadge';
import { formatDistance, formatDuration } from '@/lib/utils';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { STRENGTH_TYPES } from '@/lib/sportUtils';
import type { Activity, ActivitySource } from '@/lib/api';

// ── Source Badges ────────────────────────────────────────────────────────────

function SourceBadges({ sources }: { sources?: ActivitySource[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {sources.map((s) => (
        <span
          key={s.id}
          className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full text-white ${PROVIDER_COLORS[s.provider] || 'bg-gray-500'}`}
          title={`${s.provider}: ${s.provider_name || s.provider_activity_id}`}
        >
          <ProviderIcon provider={s.provider} /> {s.provider}
        </span>
      ))}
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
}) {
  const isStrength = STRENGTH_TYPES.includes(activity.sport_type);

  return (
    <Card
      onClick={onSelect}
      className={isSelected ? 'border-accent/50' : ''}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showBulkCheckbox && (
            <label
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
              title="Select for bulk action"
            >
              <input
                type="checkbox"
                checked={isBulkSelected}
                onChange={onToggleBulk}
                className="w-4 h-4 rounded border-surface-light bg-surface-light text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
              />
            </label>
          )}
          {showCompareCheckbox && !showBulkCheckbox && (
            <label
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
              title="Select for comparison"
            >
              <input
                type="checkbox"
                checked={isCompareSelected}
                onChange={onToggleCompare}
                className="w-4 h-4 rounded border-surface-light bg-surface-light text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
              />
            </label>
          )}
          <Badge variant={getSportBadgeVariant(activity.sport_type)}>
            {activity.sport_type}
          </Badge>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-white">{activity.name}</p>
              <SourceBadges sources={activity.sources} />
            </div>
            <p className="text-xs text-muted">
              {new Date(activity.start_date).toLocaleString()}
              {activity.route_name && (
                <span className="ml-2 text-accent">{'\u{1F4CD}'} {activity.route_name}</span>
              )}
              {activity.route_id && (
                <Link
                  href="/routes"
                  className="ml-2 text-accent/70 hover:text-accent transition-colors"
                  title={`View route: ${activity.route_name || 'Route'}`}
                >
                  View route →
                </Link>
              )}
              <WeatherBadge
                temperature={activity.weather_temperature ?? null}
                conditions={activity.weather_conditions ?? null}
                wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
              />
            </p>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-6 text-right">
          {!isStrength && activity.distance_meters && (
            <div>
              <p className="text-sm text-slate-300">{formatDistance(activity.distance_meters)}</p>
              <p className="text-xs text-muted">Distance</p>
            </div>
          )}
          {activity.duration_seconds && (
            <div>
              <p className="text-sm text-slate-300">{formatDuration(activity.duration_seconds)}</p>
              <p className="text-xs text-muted">Duration</p>
            </div>
          )}
          {!isStrength && activity.average_power && (
            <div>
              <p className="text-sm text-yellow-400">{activity.average_power} W</p>
              <p className="text-xs text-muted">Avg Power</p>
            </div>
          )}
          {activity.tss !== undefined && activity.tss !== null && (
            <div>
              <p className="text-sm text-blue-400">{activity.tss}</p>
              <p className="text-xs text-muted">TSS</p>
            </div>
          )}
        </div>
      </div>

      {/* Linked Lifting Session indicator */}
      {activity.linked_lifting_session && (
        <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">Lifting</span>
            <span className="text-sm text-white">{activity.linked_lifting_session.focus || 'Lifting Session'}</span>
          </div>
          <div className="flex gap-4 text-xs text-muted">
            <span>{new Date(activity.linked_lifting_session.session_date).toLocaleDateString()}</span>
            <span>{activity.linked_lifting_session.set_count} sets</span>
            {activity.linked_lifting_session.total_volume_kg && (
              <span>{Math.round(activity.linked_lifting_session.total_volume_kg).toLocaleString()} kg volume</span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
