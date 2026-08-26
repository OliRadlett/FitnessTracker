// ─── Common ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}

export interface Connection {
  id: string;
  provider: string;
  provider_user_id: string;
  created_at: string;
  status: 'active' | 'needs_reauth' | string;
  last_synced_at?: string | null;
  last_refreshed_at?: string | null;
  last_error_at?: string | null;
  last_error?: string | null;
  consecutive_failures?: number;
}

export interface ChartSeries {
  name: string;
  data: (number | null)[];
  color?: string;
  y_axis?: 'left' | 'right';
}

export interface ReferenceArea {
  y1: number;
  y2: number;
  color?: string;
  opacity?: number;
  label?: string;
  y_axis?: 'left' | 'right';
}

export interface ChartData {
  chart_type: 'line' | 'bar' | 'scatter' | 'area' | 'pie' | 'heatmap';
  title: string;
  labels: string[];
  series: ChartSeries[];
  x_label?: string;
  y_label?: string;
  insights?: string[];
  reference_areas?: ReferenceArea[];
}

export interface ChartParams {
  days?: number;
  weeks?: number;
  exercise_name?: string;
  days_b?: number;
}
