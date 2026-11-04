/**
 * The golden fixture, typed.
 *
 * Every value the artifact shows comes from `fixtures/raw/*.json` — the 38 payloads
 * captured from the owner's production database on 2026-11-04 (see qa/capture-before.mjs).
 * Nothing here is invented; where a derivation is needed (a week, a strip, a stance) it is
 * computed from those payloads and named after its source.
 */

const modules = import.meta.glob('../../fixtures/raw/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const RAW: Record<string, unknown> = Object.fromEntries(
  Object.entries(modules).map(([p, v]) => [p.split('/').pop()!.replace(/\.json$/, ''), v]),
);

function pick<T>(name: string): T {
  if (!(name in RAW)) throw new Error(`fixture payload missing: ${name}`);
  return RAW[name] as T;
}

/* ── Wire types (only the fields the artifact reads) ───────────────────────────── */

export interface EngineRow {
  engine: string;
  stance: string | null;
  confidence: string | null;
  available: boolean;
  reason: string | null;
  note: string | null;
  analyzed_at: string | null;
}

export interface Verdict {
  should_rest: boolean;
  headline: string;
  reasons: string[];
  consensus: EngineRow[];
}

export interface TodayPayload {
  today_activities: unknown[];
  today_lifting_sessions: unknown[];
  today_tss: number;
  today_volume_kg: number;
  today_distance_meters: number;
  today_duration_seconds: number;
  latest_recovery: number | null;
  latest_hrv_ms: number | null;
  latest_strain: number | null;
  latest_sleep_hours: number | null;
  current_ctl: number | null;
  current_atl: number | null;
  current_tsb: number | null;
  active_alerts: number;
  verdict: Verdict | null;
}

export interface LoadPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface Readiness {
  recovery_score: number | null;
  readiness: string;
  hrv_ms: number | null;
  resting_hr: number | null;
  message: string | null;
  date: string;
}

export interface Activity {
  id: string;
  name: string;
  sport_type: string;
  start_date: string;
  distance_meters: number;
  duration_seconds: number;
  tss: number | null;
}

export interface LiftingSession {
  id: string;
  session_date: string;
  focus: string | null;
  duration_seconds: number | null;
  total_volume_kg: number | null;
  estimated_tss: number | null;
  notes: string | null;
}

export interface Goal {
  metric: string;
  filter_json: { exercise?: string } | null;
  starting_value: number;
  target_value: number;
  current_value: number;
  target_date: string | null;
  status: string;
  direction: string;
}

export interface MonthRow {
  month: string;
  total_tss: number;
  lifting_volume_kg: number;
  total_distance_meters: number;
  total_time_seconds: number;
  lifting_sessions: number;
  cardio_sessions: number;
  pr_count: number;
  avg_recovery: number | null;
}

export interface YearlySummary {
  year: number;
  total_activities: number;
  total_distance_m: number;
  total_time_s: number;
  total_tss: number;
  total_lifting_sessions: number;
  total_lifting_volume_kg: number;
  avg_recovery: number | null;
  avg_hrv_ms: number | null;
  highlights: {
    best_month_tss: string;
    best_month_tss_value: number;
    longest_ride: { value: number; unit: string; start_date: string; name: string };
    heaviest_lift: { value: number; unit: string; start_date: string; name: string };
    total_prs: number;
    pr_highlights: { exercise_name: string; achieved_date: string; improvement_pct: number; duration_label?: string }[];
  };
  year_over_year: {
    activities_delta: number;
    distance_delta_m: number;
    tss_delta: number;
    prs_delta: number;
  };
}

export interface Analysis {
  analysis_type: string;
  analysis_date: string;
  analysis_text: string;
  model_used: string;
  created_at: string;
}

export interface Deficiency {
  weaknesses: {
    category: string;
    type: string;
    severity: string;
    detail: string;
    recommendation: string | null;
  }[];
  summary: { total_weaknesses: number; high: number; medium: number; strengths: number };
  computed_at: string;
}

/* ── The fixture ──────────────────────────────────────────────────────────────── */

export interface DashboardFixture {
  today: TodayPayload;
  load: LoadPoint[];
  readiness: Readiness;
  sleepDebt: {
    debt_hours: number;
    avg_sleep_hours: number;
    days_below_target: number;
    target_hours: number;
  };
  bedtime: { suggested_bedtime: string; confidence: string; message: string };
  sleepConsistency: { consistency_score: number; avg_bedtime: string; std_minutes: number; days_analyzed: number };
  whoopWeekly: {
    avg_recovery: number;
    avg_recovery_trend: string;
    total_strain: number;
    total_strain_trend: string;
    avg_sleep_hours: number;
    sleep_consistency: number;
    days_with_data: number;
    best_recovery_day: { date: string; score: number };
    worst_recovery_day: { date: string; score: number };
  };
  activities: Activity[];
  sessions: LiftingSession[];
  goals: Goal[];
  months: MonthRow[];
  yearly: YearlySummary;
  streaks: {
    current_streak_days: number;
    longest_streak_days: number;
    weekly_consistency_pct: number;
    monthly_sessions: { month: string; sessions: number }[];
  };
  weeklyTss: { labels: string[]; data: number[]; insight: string | null };
  hrvSeries: { labels: string[]; data: (number | null)[] };
  tssDaily: { labels: string[]; data: number[]; insight: string | null };
  cyclingAnalysis: Analysis | null;
  healthAnalysis: Analysis | null;
  deficiency: Deficiency;
  weight: { entries: { date: string; weight_kg: number }[] };
  plan: null;
  events: unknown[];
  syncedMinutesAgo: number;
  staleProvider: string | null;
}

export function loadFixture(): DashboardFixture {
  const today = pick<TodayPayload>('dashboard-today');
  const load = pick<{ data: LoadPoint[]; current_ctl: number; current_atl: number; current_tsb: number }>(
    'cycling-training-load-days-90',
  ).data;
  const consistency = pick<{ labels: string[]; series: { data: number[] }[]; insights: string[] }>(
    'charts-consistency-heatmap-days-90',
  );
  const hrv = pick<{ labels: string[]; series: { data: (number | null)[] }[] }>(
    'charts-hrv-trend-detailed-days-90',
  );
  const weeklyTss = pick<{ labels: string[]; series: { data: number[] }[]; insights: string[] }>(
    'charts-weekly-tss-weeks-13',
  );
  const monthly = pick<MonthRow[]>('dashboard-monthly-summary-months-12');

  const cycling = pick<Analysis>('cycling-llm-analysis-latest');
  const health = pick<Analysis>('metrics-health-ai-analysis');

  return {
    today,
    load,
    readiness: pick<Readiness>('metrics-readiness'),
    sleepDebt: pick('metrics-sleep-debt-days-7'),
    bedtime: pick<{ suggested_bedtime: string; confidence: string; message: string }>(
      'metrics-optimal-bedtime',
    ),
    sleepConsistency: pick('metrics-sleep-consistency-days-7'),
    whoopWeekly: pick('dashboard-whoop-weekly'),
    activities: pick<Activity[]>('activities-limit-5'),
    sessions: pick<LiftingSession[]>('lifting-sessions-limit-5'),
    goals: pick<Goal[]>('goals'),
    months: monthly,
    yearly: pick<YearlySummary>('dashboard-yearly-summary-2026'),
    streaks: pick('dashboard-streaks'),
    weeklyTss: {
      labels: weeklyTss.labels,
      data: weeklyTss.series[0]?.data ?? [],
      insight: weeklyTss.insights[0] ?? null,
    },
    hrvSeries: { labels: hrv.labels, data: hrv.series[0]?.data ?? [] },
    tssDaily: {
      labels: consistency.labels,
      data: consistency.series[0]?.data ?? [],
      insight: consistency.insights[0] ?? null,
    },
    cyclingAnalysis: cycling,
    healthAnalysis: health,
    deficiency: pick<Deficiency>('deficiency-weeks-8'),
    weight: pick('metrics-weight-days-90'),
    // The real fixture has no active plan and no upcoming events. That is the state the
    // redesign has to survive, so it is not papered over.
    plan: null,
    events: pick<unknown[]>('events-upcoming-only-true'),
    syncedMinutesAgo: 22,
    staleProvider: 'Wahoo',
  };
}

/* ── Derivations (each names its source payload) ──────────────────────────────── */

export type Stance = 'train' | 'easy' | 'rest';

export interface DayContext {
  date: string;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  hrv: number | null;
  /** Only the readiness payload carries a composite score, and only for its own date. */
  recovery: number | null;
  /** True when the pinned day is the day the readiness payload was computed for. */
  isToday: boolean;
}

/**
 * The numbers that belong to the day being looked at.
 *
 * This is the honest core of the redesign: pinning the clock has to change the
 * answer. Reading `today.current_tsb` regardless of the pin would make three
 * different days produce one verdict — the exact failure the old page has.
 */
export function contextFor(f: DashboardFixture, now: string): DayContext {
  const point = f.load.find((p) => p.date === now) ?? null;
  const hrvIndex = f.hrvSeries.labels.indexOf(now);
  const hrv = hrvIndex >= 0 ? (f.hrvSeries.data[hrvIndex] ?? null) : null;
  const isToday = f.readiness.date === now;
  return {
    date: now,
    ctl: point?.ctl ?? null,
    atl: point?.atl ?? null,
    tsb: point?.tsb ?? null,
    hrv,
    recovery: isToday ? (f.readiness.recovery_score ?? null) : null,
    isToday,
  };
}

export interface StanceReading {
  stance: Stance;
  /** The sentence under the stance word. Composed from fields, never a fixed string. */
  reason: string;
  basis: string[];
}

/**
 * The verdict, re-stated honestly.
 *
 * The API returns `headline: "Go ahead with today's plan."` even when `projection`
 * reports "no active plan" — a sentence that is false about its own payload. The lab
 * composes the stance from the fields it can verify instead of echoing the string.
 */
export function readStance(f: DashboardFixture, ctx: DayContext): StanceReading {
  const tsb = ctx.tsb ?? 0;
  const recovery = ctx.recovery;
  const engines = f.today.verdict?.consensus ?? [];
  const alive = engines.filter((e) => e.available).length;
  const silence = engines.length - alive;

  const basis: string[] = [];
  basis.push(`form ${fmtSigned(tsb)}`);
  if (recovery !== null) basis.push(`recovery ${Math.round(recovery)}%`);
  if (ctx.hrv !== null) basis.push(`HRV ${Math.round(ctx.hrv)} ms`);

  let stance: Stance = 'train';
  let reason: string;

  if (f.today.verdict?.should_rest) {
    stance = 'rest';
    reason = 'A rest-day signal fired.';
  } else if (tsb < -20) {
    stance = 'easy';
    reason = `Form is ${fmtSigned(tsb)} — deep enough that hard work costs more than it gives.`;
  } else if (tsb > 15) {
    stance = 'train';
    reason = `Form is ${fmtSigned(tsb)}${recovery !== null ? ` with ${Math.round(recovery)}% recovery` : ''} — there is room to load.`;
  } else {
    reason = `Form is ${fmtSigned(tsb)}${recovery !== null ? ` and recovery is ${Math.round(recovery)}%` : ''} — a normal training day.`;
  }

  if (silence > 0) {
    reason += ` ${alive} of ${engines.length} engines contributed; ${silence} ${silence === 1 ? 'is' : 'are'} silent.`;
  }
  return { stance, reason, basis };
}

export interface EngineView {
  key: string;
  label: string;
  state: 'contributing' | 'silent' | 'broken';
  detail: string;
  stance: string | null;
}

const ENGINE_LABELS: Record<string, string> = {
  rest_day_suggestion: 'Rest-day',
  adaptive: 'Adaptive plan',
  deficiency: 'Weakness',
  cross_domain: 'Cross-domain',
  projection: 'Plan projection',
  session_mix: 'Session mix',
};

/**
 * A raw Python exception is not product copy. It is still information — the engine is
 * broken and the athlete should be able to see that — so it becomes a `broken` row with
 * a human sentence, and the exception itself is only in the tooltip/title.
 */
export function readEngines(f: DashboardFixture): EngineView[] {
  const engines = f.today.verdict?.consensus ?? [];
  return engines.map((e) => {
    const label = ENGINE_LABELS[e.engine] ?? e.engine;
    if (e.available) {
      const detail = e.note ?? (e.stance ? `${e.stance}${e.confidence ? ` · ${e.confidence} confidence` : ''}` : 'contributed');
      return { key: e.engine, label, state: 'contributing', detail, stance: e.stance };
    }
    const looksBroken = !!e.reason && /Error|Exception|Traceback/.test(e.reason);
    return {
      key: e.engine,
      label,
      state: looksBroken ? 'broken' : 'silent',
      detail: humaniseReason(e.reason),
      stance: null,
      ...(looksBroken ? { raw: e.reason } : {}),
    } as EngineView;
  });
}

function humaniseReason(reason: string | null): string {
  if (!reason) return 'said nothing';
  if (/Error|Exception|Traceback/.test(reason)) return 'engine failed — reported, not hidden';
  if (/no analysis yet/i.test(reason)) return 'no weekly run yet';
  if (/no active plan/i.test(reason)) return 'no plan running';
  if (/no classified sessions/i.test(reason)) return 'no labelled sessions';
  if (/not computed/i.test(reason)) return 'input missing';
  return reason;
}

export interface DayCell {
  date: string;
  tss: number;
  ctl: number | null;
  tsb: number | null;
  hrv: number | null;
  label: string; // Mon, Tue…
}

/** Last `n` days ending at `now`, joined across load and HRV on the shared date key. */
export function dayWindow(f: DashboardFixture, now: string, n: number): DayCell[] {
  const loadByDate = new Map(f.load.map((p) => [p.date, p]));
  const hrvByDate = new Map(f.hrvSeries.labels.map((d, i) => [d, f.hrvSeries.data[i] ?? null]));
  const out: DayCell[] = [];
  const end = new Date(`${now}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const p = loadByDate.get(key);
    out.push({
      date: key,
      tss: p?.tss ?? 0,
      ctl: p?.ctl ?? null,
      tsb: p?.tsb ?? null,
      hrv: hrvByDate.get(key) ?? null,
      label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()],
    });
  }
  return out;
}

export interface RecentRow {
  id: string;
  kind: 'ride' | 'lift';
  title: string;
  date: string;
  primary: string;
  secondary: string;
  load: number | null;
}

export function recentRows(f: DashboardFixture, now: string, limit = 4): RecentRow[] {
  const rows: RecentRow[] = [];
  for (const a of f.activities) {
    const isLift = a.sport_type === 'strength';
    rows.push({
      id: a.id,
      kind: isLift ? 'lift' : 'ride',
      title: a.name,
      date: a.start_date.slice(0, 10),
      primary: isLift ? fmtDuration(a.duration_seconds) : `${(a.distance_meters / 1000).toFixed(1)} km`,
      secondary: isLift ? 'strength' : fmtDuration(a.duration_seconds),
      load: a.tss ?? null,
    });
  }
  for (const s of f.sessions) {
    rows.push({
      id: s.id,
      kind: 'lift',
      title: s.focus ?? 'Lifting',
      date: s.session_date,
      primary: s.total_volume_kg ? `${Math.round(s.total_volume_kg).toLocaleString()} kg` : '—',
      secondary: s.duration_seconds ? fmtDuration(s.duration_seconds) : 'lifting',
      load: s.estimated_tss ?? null,
    });
  }
  return rows
    .filter((r) => r.date <= now)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

/**
 * Which days carried a session, and of what kind.
 *
 * The load row can only be cycling TSS: a strength activity carries `tss: 0` in
 * the payload, so a lift day would otherwise look like a rest day. This tick row
 * is the honest way to show "something happened here" without inventing a lift
 * load the data does not have.
 */
export function activityMarks(
  f: DashboardFixture,
  now: string,
  days: number,
): Record<string, 'lift' | 'ride'> {
  const from = dayWindow(f, now, days)[0]?.date;
  const out: Record<string, 'lift' | 'ride'> = {};
  if (!from) return out;
  for (const a of f.activities) {
    const d = a.start_date.slice(0, 10);
    if (d < from || d > now) continue;
    out[d] = a.sport_type === 'strength' ? 'lift' : 'ride';
  }
  for (const s of f.sessions) {
    if (s.session_date < from || s.session_date > now) continue;
    out[s.session_date] = 'lift';
  }
  return out;
}

export interface WeekTotals {
  tss: number;
  sessions: number;
  distanceKm: number;
  liftVolumeKg: number;
  days: number;
}

/** The trailing 7 days ending at `now`, from the daily TSS series + the month table. */
export function weekTotals(f: DashboardFixture, now: string): WeekTotals {
  const days = dayWindow(f, now, 7);
  const tss = days.reduce((s, d) => s + d.tss, 0);
  const sessions = days.filter((d) => d.tss > 0).length;
  const distanceKm = f.activities
    .filter((a) => a.start_date.slice(0, 10) >= days[0].date && a.start_date.slice(0, 10) <= now)
    .reduce((s, a) => s + a.distance_meters / 1000, 0);
  const liftVolumeKg = f.sessions
    .filter((s) => s.session_date >= days[0].date && s.session_date <= now)
    .reduce((s, x) => s + (x.total_volume_kg ?? 0), 0);
  return { tss, sessions, distanceKm, liftVolumeKg, days: 7 };
}

/**
 * Repair UTF-8 text that was decoded as Latin-1 before it reached the database.
 *
 * `deficiency.weaknesses[0].recommendation` really does contain "Build aerobic base
 * first — mostly Z2 riding": the em dash arrived as three mojibake characters. This
 * is a real data defect, surfaced and repaired at the display boundary rather than
 * rendered as garbage.
 *
 * Patterns are written as \u escapes on purpose — this function must survive any
 * encoding round-trip on the file that holds it.
 */
const MOJIBAKE: [RegExp, string][] = [
  [/\u00e2\u20ac\u201d/g, '\u2014'], // — -> em dash
  [/\u00e2\u20ac\u201c/g, '\u2013'], // – -> en dash
  [/\u00e2\u20ac\u2122/g, '\u2019'], // ’ -> right single quote
  [/\u00e2\u20ac\u0153/g, '\u201c'], // “ -> left double quote
  [/\u00e2\u20ac/g, '\u201d'], //      ”  -> right double quote
  [/\u00e2\u02c6\u2019/g, '\u2212'], // − -> minus sign
  [/\u00c3\u2014/g, '\u00d7'], //      ×  -> multiplication sign
  [/\u00c2\u00b7/g, '\u00b7'], //      ·  -> middle dot
  [/\u00c2/g, ''], //                  stray 
];

export function clean(s: string | null | undefined): string {
  if (!s) return '';
  let out = s;
  for (const [pattern, replacement] of MOJIBAKE) out = out.replace(pattern, replacement);
  return out;
}

export function fmtSigned(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtMonth(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

/** Days between two ISO dates, positive when `later` is after `earlier`. */
export function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T12:00:00Z`);
  const b = Date.parse(`${later}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
