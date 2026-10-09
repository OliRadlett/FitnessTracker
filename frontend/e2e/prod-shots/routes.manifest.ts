/**
 * Central route manifest for the PROD screenshot pipeline.
 *
 * Source: t1 inventory (18 page.tsx under app/(app)/ + public login `/`
 * + dev-only /dev/replay which is NOT on prod and is excluded).
 *
 * Sidebar order mirrors `frontend/src/components/ui/Sidebar.tsx` so t3
 * captures in nav order. `tabs` are client-side states the capture spec
 * reaches by clicking (no form submits, no mutations). `notes` flag states
 * that need a real prod row id at runtime (deep-links) — the spec captures
 * the base route always and attempts the deep-link variant only if it can
 * discover an id on the page (first card), never with a hardcoded id.
 *
 * All paths are relative to the prod baseURL
 * (https://oliradlett.co.uk/fittrack, Caddy `/fittrack*` → frontend).
 * Auth-gated: every (app) route bounces to `/` when the session cookie is
 * gone (AppLayout + `enabled: !!token` on queries); only `/` is public.
 */

export type ShotTarget = {
  /** Stable slug used for the screenshot filename. */
  slug: string;
  /** Path including the /fittrack base prefix, e.g. `/fittrack/dashboard`. */
  path: string;
  /** nav section from Sidebar.tsx (Overview/Train/Resources/hidden/public). */
  section: string;
  /** Client-side tab/click states to capture after the base shot. */
  tabs?: string[];
  notes?: string;
};

export const PROD_SHOT_TARGETS: ShotTarget[] = [
  // ── Public ──────────────────────────────────────────────────────────
  { slug: '00-login', path: '/fittrack', section: 'public', notes: 'Only public route. Captured in a fresh context WITHOUT storageState.' },

  // ── Overview ────────────────────────────────────────────────────────
  { slug: '01-dashboard', path: '/fittrack/dashboard', section: 'Overview', tabs: ['Today', 'Weekly', 'Monthly'], notes: 'Tabs: 📅 Today (default) / 📊 Weekly / 📆 Monthly. Onboarding wizard suppressed via localStorage.' },
  { slug: '02-today', path: '/fittrack/today', section: 'Overview', notes: 'Unified daily verdict (§1): five engines + consensus[] incl. available:false rows.' },
  { slug: '03-calendar', path: '/fittrack/calendar', section: 'Overview', notes: 'Month grid + DayDetailPanel (links ?activity= / ?session= at runtime only).' },
  { slug: '04-notifications', path: '/fittrack/notifications', section: 'Overview' },

  // ── Train ───────────────────────────────────────────────────────────
  { slug: '05-training', path: '/fittrack/training', section: 'Train', tabs: ['Weekly', 'Plan', 'Events'], notes: 'WeeklyView + WorkoutPlanner + EventResultPanel. DO NOT click Generate/Save (POST).' },
  { slug: '06-goals', path: '/fittrack/goals', section: 'Train', notes: 'Goal cards fetch /{id}/projection per goal. DO NOT create/check-in (POST).' },
  { slug: '07-activities', path: '/fittrack/activities', section: 'Train', notes: 'Deep-links ?activity= ?replay= (?t= playhead) via useDeepLink (no Suspense). Detail/replay variants only with runtime-discovered id.' },
  { slug: '08-lifting', path: '/fittrack/lifting', section: 'Train', tabs: ['Sessions', 'PRs', 'Volume', 'Plans'], notes: 'Deep-links ?session= ?tab= ?pr= /s_*. DO NOT start Live Session, log sets, or edit plans.' },
  { slug: '09-lifting-live', path: '/fittrack/lifting/live', section: 'Train', notes: 'Read-only capture of the idle state ONLY. DO NOT start/complete a workout (POST).' },
  { slug: '10-lifting-videos', path: '/fittrack/lifting/videos', section: 'Train', notes: 'Video list idle state. DO NOT upload or trigger analysis (POST).' },
  { slug: '11-cycling', path: '/fittrack/cycling', section: 'Train', tabs: ['Overview', 'Power', 'FTP', 'VO2max'], notes: 'PowerCurve/FTP/VO2max sections load eagerly. DO NOT click Recalculate/Backfill (POST).' },
  { slug: '12-health', path: '/fittrack/health', section: 'Train', notes: 'Readiness + sleep-debt/consistency/bedtime cards, health alerts. Read-only.' },
  { slug: '13-routes', path: '/fittrack/routes', section: 'Train', notes: 'Deep-link ?route=. List + detail variant (runtime id only). DO NOT sync/merge/quarantine (POST/PATCH).' },
  { slug: '14-routes-duplicates', path: '/fittrack/routes/duplicates', section: 'hidden', notes: 'Hidden page (no sidebar entry). DO NOT merge (POST) — capture list state only.' },
  { slug: '15-segments', path: '/fittrack/segments', section: 'Train', notes: 'Climb list (geo_cluster_id grouping). Read-only.' },
  { slug: '16-analytics', path: '/fittrack/analytics', section: 'Train', notes: 'AthleteInsights (B-15/B-16). Read-only.' },

  // ── Resources ───────────────────────────────────────────────────────
  { slug: '17-wiki', path: '/fittrack/wiki', section: 'Resources' },
  { slug: '18-settings', path: '/fittrack/settings', section: 'Resources', notes: 'OAuth callback params ?connected= ?error= handled then stripped. DO NOT connect/disconnect providers or save preferences.' },
];

/** Viewports required by the t2 contract. */
export const PROD_SHOT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
