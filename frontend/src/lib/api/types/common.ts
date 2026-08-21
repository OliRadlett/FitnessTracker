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
}

export interface ChartSeries {
  name: string;
  data: (number | null)[];
  color?: string;
}

export interface ReferenceArea {
  y1: number;
  y2: number;
  color?: string;
  opacity?: number;
  label?: string;
}

export interface ChartData {
  chart_type: 'line' | 'bar' | 'scatter' | 'area' | 'pie';
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
