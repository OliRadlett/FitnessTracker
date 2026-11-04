import type { ReplayResponse } from '@/lib/api/types/relive';
import type { PoseName, Ride, RideHighlights } from './types';

/**
 * Adapt the backend's snake_case replay contract to the viewer's `Ride`.
 * The streams, highlights and weather shapes are already identical; only the
 * top-level names and stats/bounds differ.
 */
export function replayToRide(response: ReplayResponse): Ride {
  const r = response.ride;
  return {
    id: r.id,
    activityId: r.activity_id,
    name: r.name,
    date: r.date,
    timezone: r.timezone,
    poseLabels: (r.pose_labels ?? undefined) as
      | Partial<Record<PoseName, string>>
      | undefined,
    stats: {
      distanceM: r.stats.distance_m,
      movingS: r.stats.moving_s,
      elapsedS: r.stats.elapsed_s,
      elevationGainM: r.stats.elevation_gain_m,
      ascentM: r.stats.ascent_m,
      descentM: r.stats.descent_m,
      avgSpeedMps: r.stats.avg_speed_mps,
      avgHr: r.stats.avg_hr,
      avgPowerW: r.stats.avg_power_w,
      calories: r.stats.calories,
      pauseCount: r.stats.pause_count,
      pauseS: r.stats.pause_s,
    },
    weather: {
      temperature_c: r.weather.temperature_c,
      conditions: r.weather.conditions,
      wind_speed_kmh: r.weather.wind_speed_kmh,
      wind_direction_deg: r.weather.wind_direction_deg,
      precipitation_mm: r.weather.precipitation_mm,
    },
    bounds: {
      minLat: r.bounds.min_lat,
      maxLat: r.bounds.max_lat,
      minLng: r.bounds.min_lng,
      maxLng: r.bounds.max_lng,
    },
    streams: {
      t: r.streams.t,
      d: r.streams.d,
      lat: r.streams.lat,
      lng: r.streams.lng,
      alt: r.streams.alt,
      v: r.streams.v,
      hr: r.streams.hr,
      grade: r.streams.grade,
      watts: r.streams.watts,
      cadence: r.streams.cadence,
    },
    keyPoints: r.key_points,
    highlights: r.highlights as unknown as RideHighlights,
  };
}
