// ─── Weather ─────────────────────────────────────────────────────────────────

export interface CurrentWeather {
  temperature: number;
  apparent_temperature: number;
  humidity: number;
  precipitation_mm: number;
  wind_speed_kmh: number;
  wind_direction: string;
  conditions: string;
  latitude: number;
  longitude: number;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD
  weather_code: number;
  conditions: string;
  temp_max: number;
  temp_min: number;
  precipitation_probability: number | null;
  precipitation_sum: number;
  wind_speed_max: number;
  wind_direction_deg: number | null;
  humidity_mean: number | null;
  pressure_mean: number | null;
}

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  days: ForecastDay[];
}

export interface ActivityWeather {
  temperature: number | null;
  conditions: string | null;
  wind_speed_kmh: number | null;
  wind_direction: string | null;
  wind_direction_deg: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  precipitation_mm: number | null;
}
