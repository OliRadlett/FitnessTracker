'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { RouteData } from '@/lib/api/types';
import { formatRelativeTime, weatherEmoji } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

export function RouteWeatherCard({ route }: { route: RouteData }) {
  const { authFetch } = useAuthFetch();

  // Get weather for route start location
  const { data: weather, isPending, isError } = useQuery({
    queryKey: ['route-weather', route.id],
    queryFn: () => authFetch<{
      current?: {
        temperature: number | null;
        conditions: string | null;
        wind_speed_kmh: number | null;
        wind_direction: string | null;
        precipitation_mm: number | null;
      };
      forecast?: { days: Array<{ date: string; conditions: string; temp_max: number; temp_min: number; wind_speed_max: number; precipitation_probability: number }> };
    }>(`/api/v1/weather/route/${route.id}`),
    staleTime: 300_000,
  });

  if (isError) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs text-muted uppercase tracking-wider">Weather</h4>

      {isPending && (
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-surface-light rounded w-3/4" />
          <div className="h-3 bg-surface-light rounded w-1/2" />
        </div>
      )}

      {!isPending && weather?.current && (
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {weatherEmoji(weather.current.conditions)}
            </span>
            <div>
              <p className="text-lg font-medium text-white">
                {weather.current.temperature != null
                  ? `${Math.round(weather.current.temperature)}°C`
                  : '—'}
              </p>
              <p className="text-xs text-muted">
                {weather.current.conditions || 'Unknown'}
              </p>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
            {weather.current.wind_speed_kmh != null && (
              <div>
                <span className="text-white">💨 {Math.round(weather.current.wind_speed_kmh)} km/h</span>
                {weather.current.wind_direction && ` ${weather.current.wind_direction}`}
              </div>
            )}
            {weather.current.precipitation_mm != null && (
              <div>🌧️ {Math.round(weather.current.precipitation_mm)} mm</div>
            )}
          </div>
        </div>
      )}

      {!isPending && weather?.forecast && weather.forecast.days && weather.forecast.days.length > 0 && (
        <div>
          <h5 className="text-xs text-muted mb-2">7-Day Forecast</h5>
          <div className="space-y-1.5">
            {weather.forecast.days.slice(0, 7).map((day) => {
              const isBest = day.precipitation_probability < 20 && day.wind_speed_max < 25;
              return (
                <div
                  key={day.date}
                  className={`flex items-center justify-between py-1.5 px-2 rounded text-xs ${
                    isBest ? 'bg-positive/10 border border-positive/20' : 'hover:bg-surface-light/30'
                  }`}
                >
                  <span className="text-muted w-20">
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span className="w-5 text-center">{weatherEmoji(day.conditions)}</span>
                  <span className="text-muted w-12 text-right">
                    {Math.round(day.temp_min)}–{Math.round(day.temp_max)}°
                  </span>
                  <div className="flex items-center gap-2">
                    {isBest && (
                      <Badge variant="positive" className="text-xs">
                        Best
                      </Badge>
                    )}
                    <span className="text-muted w-12 text-right">
                      💧 {day.precipitation_probability}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
