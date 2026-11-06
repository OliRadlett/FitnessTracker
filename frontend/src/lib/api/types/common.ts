// ─── Common ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  birth_date?: string | null;
  sex?: string | null;
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
  /** Render as a dashed continuation line (B-14 forecast overlays). */
  dashed?: boolean;
}

export interface ReferenceArea {
  y1: number;
  y2: number;
  color?: string;
  opacity?: number;
  label?: string;
  y_axis?: 'left' | 'right';
}

export interface ReferenceLine {
  x: string | number;
  label?: string;
  color?: string;
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
  /** vertical playhead marker (3D replay position on stream charts) — line charts only */
  reference_line?: ReferenceLine;
  /**
   * Opt in to the zoom brush. Off by default: the brush is 30 px of chrome that
   * appeared on any series over 20 points, and a control the reader has to
   * operate before seeing the data they already have. A chart that genuinely
   * benefits from zooming a dense window (a year of daily load) sets this true.
   */
  zoomable?: boolean;
}

export interface ChartParams {
  days?: number;
  weeks?: number;
  exercise_name?: string;
  days_b?: number;
}
