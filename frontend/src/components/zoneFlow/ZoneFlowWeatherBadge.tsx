'use client';

/**
 * ZoneFlowWeatherBadge — compact per-route weather badge for the ZoneFlow list.
 *
 * Reads the route's own coordinates (start_lat/start_lng from the route
 * detail) and fetches the day forecast at that point via the existing weather
 * client (`getForecast(token, days, lat, lng)` — import-only reuse, no new
 * endpoint). Spec shape: `14°C · 30 km/h · ⚠ rain`.
 *
 * Degradation is shown, never blank: no coordinates → muted "no location";
 * backend 404 (no location set) → muted "weather unavailable". Both carry a
 * title tooltip explaining why.
 */

import { useQuery } from '@tanstack/react-query';
import { getForecast, useAuthFetch } from '@/lib/api';
import { weatherEmoji } from '@/lib/utils';

interface ZoneFlowWeatherBadgeProps {
  lat?: number | null;
  lng?: number | null;
  /** Route detail still loading — show a shimmer, not the no-location state. */
  loading?: boolean;
}

export function ZoneFlowWeatherBadge({ lat, lng, loading }: ZoneFlowWeatherBadgeProps) {
  const { token } = useAuthFetch();
  const hasCoords = lat != null && lng != null;

  const { data, isPending } = useQuery({
    queryKey: ['zoneflow-weather', lat, lng],
    queryFn: () => getForecast(token, 1, lat as number, lng as number),
    // Pitfall 11: auth queries wait for the token.
    enabled: !!token && hasCoords,
    staleTime: 600_000,
  });

  if (loading || isPending) {
    return (
      <span className="inline-flex items-center text-xs text-muted" aria-label="Loading weather">
        <span className="inline-block h-3 w-16 animate-pulse rounded bg-surface-light" />
      </span>
    );
  }

  if (!hasCoords) {
    return (
      <span
        className="inline-flex items-center text-xs text-muted tabular-nums"
        title="This route has no start location, so no weather can be shown."
      >
        🌫️ no location
      </span>
    );
  }

  const today = data?.days?.[0];
  if (!today) {
    return (
      <span
        className="inline-flex items-center text-xs text-muted tabular-nums"
        title="Weather is unavailable (no home location set or forecast failed). The route still works — check conditions before heading out."
      >
        🌫️ weather unavailable
      </span>
    );
  }

  const temp = Math.round(((today.temp_max ?? 0) + (today.temp_min ?? 0)) / 2);
  const wind = Math.round(today.wind_speed_max ?? 0);
  const rainProb = today.precipitation_probability ?? 0;
  const wet = rainProb >= 40 || (today.precipitation_sum ?? 0) >= 2;

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-foreground tabular-nums"
      title={`${today.conditions ?? 'Unknown'} · high ${Math.round(today.temp_max ?? temp)}°C / low ${Math.round(today.temp_min ?? temp)}°C · rain ${rainProb}%`}
    >
      <span aria-hidden="true">{weatherEmoji(today.conditions)}</span>
      <span>{temp}°C</span>
      <span aria-hidden="true">·</span>
      <span>💨 {wind} km/h</span>
      {wet && (
        <span className="text-warning font-medium" aria-label="Rain likely">
          ⚠ rain
        </span>
      )}
    </span>
  );
}
