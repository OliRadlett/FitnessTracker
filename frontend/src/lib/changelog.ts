export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  bullets: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '2026-09-10',
    date: '2026-09-10',
    title: 'Video Uploads Go Live',
    bullets: [
      'R2 video uploads end-to-end — upload set recordings from the Video Bank with a progress bar; playback streams from Cloudflare R2 and deleting a video removes its file too',
      'URL / YouTube / Vimeo mode removed — videos are uploads-only now, and the Video Bank filters simplified to match',
      'Firefox upload fix — creating and listing videos no longer fails with a NetworkError after the progress bar completes',
    ],
  },
  {
    version: '2026-09-09',
    date: '2026-09-09',
    title: 'Strength Videos + Route Polish',
    bullets: [
      '3D route terrain (3.16) — drape any route over a real Copernicus DEM heightmap in three.js; colour the path by elevation or gradient, orbit/zoom/pan, toggle from the route Map & Profile tab',
      'Strength video system — Video Bank page with exercise/date filters; upload set recordings to R2 with a progress bar and stream them back on any device',
      'Mobile route detail — tapping a route on mobile now opens a slide-up bottom sheet instead of doing nothing',
      'Save filters as smart collection — the routes filter bar now has a "Save as Collection" button that creates a reusable smart collection from your active filters',
      'Mobile UI pass — larger touch targets, better accessibility labels, and PWA/offline polish across maps, charts, and 3D views',
    ],
  },
  {
    version: '2026-09-08',
    date: '2026-09-08',
    title: 'Analytics, Segments & 3D Replay',
    bullets: [
      'Post-sync background activity analysis — ride analytics (zones, decoupling, climbing, TSS breakdown) are precomputed at Strava sync time and cached in Activity.context',
      'Ride segment analysis — climb segments detected from route elevation profiles with leaderboard-of-self efforts and PR tracking',
      '3D ride replay — three.js fly-through of your ride with synced power/HR overlay; side-by-side 3D comparison in the activities page',
      'Adaptive training suggestions — weekly AI-powered advice based on TSB, recovery, conformity, health alerts, and weakness analysis with one-tap day apply',
      'Health alert tuning — per-user disable/snooze/threshold preferences; new performance decline, sleep consistency, and resting HR elevation alerts',
      'Race-day prep PDF — downloadable report with TSB readiness, conformity score, taper checklist, fuel plan, and weather forecast',
      'Stale-data refresh UX — manual refresh button with last-updated indicator across the app',
      'Activity context enrichment — expanded activity cards with ride analytics badges (zones, decoupling, climbing) without extra API calls',
    ],
  },
  {
    version: '2026-09-07',
    date: '2026-09-07',
    title: 'Platform & Integrations',
    bullets: [
      'Unit & locale preferences — switch between metric/imperial, date formats, and 12/24h time throughout the app',
      'Web push notifications — subscribe to browser notifications for PRs, health alerts, goal milestones, and plan reminders',
      'PWA offline support — install the app, view a cached dashboard while offline, Live Lift works fully offline with sync-on-reconnect',
      'Full JSON data export + account deletion — download all your data or permanently delete your account (GDPR compliance)',
      'Onboarding wizard — 4-step setup guide on first run covering preferences, connections, fitness profile, and goals',
      'Notifications page — full notification history with read/unread filters, type filters, and mark-all-read',
      'Race results — log finish time, placing, and notes on events; race-day notification on the morning of your event',
      'Body-weight logging — quick-add weigh-in from the cycling page or dashboard; editable history with 7-day rolling average',
      'Dedicated health page — recovery, HRV, resting HR, respiratory rate, sleep intelligence, and health alert history in one place',
      'Global search — Ctrl+P / Cmd+P command palette across activities, routes, lifting sessions, exercises, goals, and events',
    ],
  },
  {
    version: '2026-09-06',
    date: '2026-09-06',
    title: 'Live Lift Hardening & Navigation Fixes',
    bullets: [
      'Live Lift hardening — more resilient auth, same-device session resume, and training-plan prefill when starting a lift',
      'Sidebar navigation — active states fixed so you can always tell where you are',
      'Route merging — loop-aware tolerance and density-aware heatmaps for cleaner merged views',
    ],
  },
  {
    version: '2026-09-02',
    date: '2026-09-02',
    title: 'Merged Routes & Home Heatmap',
    bullets: [
      'Merged route view — overlapping rides combine into single routes with per-source polylines',
      'Home heatmap — ride-frequency heatmap centred on your home location, on by default',
      'Cycling effort estimates — intensity-aware time predictions per route',
      'Bigger route fetches — 200 routes per page load so long route lists no longer have gaps',
    ],
  },
  {
    version: '2026-08-31',
    date: '2026-08-31',
    title: 'Reliability: Routes Page & Whoop Dates',
    bullets: [
      'Routes page loads reliably — fixed the route-ordering + service-worker fault behind its NetworkError',
      'Whoop dates corrected — recovery and sleep now anchor to local bedtime instead of drifting a day',
    ],
  },
  {
    version: '2026-08-30',
    date: '2026-08-30',
    title: 'Session Linking Fix',
    bullets: [
      'Linking a lifting session to its activity works again — the linkable-activities lookup no longer errors',
    ],
  },
  {
    version: '2026-08-29',
    date: '2026-08-29',
    title: 'Audit Fixes: Downloads, Sync & Loading',
    bullets: [
      'GPX route downloads fixed',
      'App-update prompt — you now get asked to reload when a new version is waiting instead of running stale code',
      'Whoop recovery backfill — gaps outside the sync window now heal on their own',
      'Activity totals count every activity, not just the loaded page',
      'Power data, route visibility, and default training-plan selection fixed',
    ],
  },
  {
    version: '2026-08-28',
    date: '2026-08-28',
    title: 'Activities Overhaul & Routes Redesign',
    bullets: [
      'Activities page overhaul — enriched cards with analytics badges, plus Timeline and Patterns tabs',
      'Routes redesign — tags, smart/manual collections, quality scoring, and effort estimation',
      'Live Lift finish flow hardened against double-submits and lost sets',
      'Whoop sleep dates aligned with recovery cycles',
    ],
  },
  {
    version: '2026-08-27',
    date: '2026-08-27',
    title: 'Phase 7: Nutrition, Plans & UI Overhaul',
    bullets: [
      'Nutrition actuals — log what you really ate against the plan, with plan-completion tracking',
      'Route auto-link — activities link to known routes on their own',
      'Workout preview — see TSS, duration, and load before committing a planned session to today',
      'Activities & Routes pages visually overhauled',
      'Bulletproof pass — harder error handling, safer syncs, and tighter security throughout',
    ],
  },
  {
    version: '2026-08-26',
    date: '2026-08-26',
    title: 'In-App Notifications & Sync Hardening',
    bullets: [
      'In-app notifications — health alerts, PRs, goal milestones, and plan reminders land in the app, not just push',
      'Sync hardening — connection health tracking with automatic reconnect prompts, safer concurrent syncs, and queued Strava webhooks',
      'Live-sync safety — lifting sessions and sets carry idempotency keys so retries never duplicate your work',
      'Cross-page links — sessions, activities, plans, and PRs link to each other throughout the app',
    ],
  },
  {
    version: '2026-08-25',
    date: '2026-08-25',
    title: 'Dashboard Revamp, Charts & Bulk Export',
    bullets: [
      'Today tab revamp — readiness, todays plan, and form chart with explanatory tooltips',
      'Charts overhaul — goal projections drawn directly on your trend charts',
      'Bulk actions — multi-select activities and export them to CSV in one go',
      'Mobile responsive polish + PWA groundwork across the app',
      'Strava backfill streams live progress instead of hanging silently',
      'Training plans — warmup templates, session copy, and session types',
    ],
  },
  {
    version: '2026-08-24',
    date: '2026-08-24',
    title: 'Roadmap Phases 1–6: Goals, Live Tracking & Training',
    bullets: [
      'Semantic goals — set outcome goals with automatic data-driven check-ins',
      'Live Lift tracker — mobile-first in-session logging with Whoop strain enrichment',
      'Training page overhaul — visual plan builder, weekly view, and plan-vs-actual conformity',
      'Ride fueling — per-ride carb and hydration plans from duration and intensity',
      'Route weather — forecasts attached to activities and events, with bad-weather alerts on event days',
      'Incremental syncs — scheduled syncs fetch only new data instead of full re-syncs',
      'OAuth reliability — connect flows identify you correctly and route back to the right environment',
      '39 audit bugs fixed across the backend and frontend',
    ],
  },
  {
    version: '2026-08-23',
    date: '2026-08-23',
    title: 'Deploy Pipeline & CI',
    bullets: [
      'One-push deploys — pre-built images, automatic migrations, and production routing from a single merge to prod',
      'Integration tests run in CI on every push to main and prod',
    ],
  },
  {
    version: '2026-08-21',
    date: '2026-08-21',
    title: 'AI Analysis & Backfills',
    bullets: [
      'On-demand AI analysis — Gemini-powered write-ups for activities, lifting sessions, health, events, and the cycling dashboard',
      'Strava stream backfill — missing per-second power/HR/cadence streams fill in automatically, weekly and on demand',
      '199 automated browser tests covering the core flows',
    ],
  },
  {
    version: '2026-08-20',
    date: '2026-08-20',
    title: 'Session Analysis & Wiki',
    bullets: [
      'Lifting session analysis — volume breakdown, set progression, rep drop-off, and PR proximity per session',
      'In-app wiki documenting every page and feature',
      'Dashboard tabs for switching between training views',
    ],
  },
  {
    version: '2026-08-19',
    date: '2026-08-19',
    title: 'Dev & Deploy Foundations',
    bullets: [
      'Secure local development over HTTPS mirroring the production setup',
      'Database migrations run automatically on backend startup',
    ],
  },
  {
    version: '2026-08-18',
    date: '2026-08-18',
    title: 'Production Launch & Audit',
    bullets: [
      'FitTrack deployed to production with automatic TLS and one-command releases',
      'Sign-in gated by an email allowlist',
      'Backup and restore for the full database',
      'Project-wide audit completed — security hardening, analytics, gamification, training plans, and file imports',
    ],
  },
  {
    version: '2026-08-17',
    date: '2026-08-17',
    title: 'FitTrack Begins',
    bullets: [
      'Initial tracker for powerlifting + cycling: activities, lifting sessions, dashboard trends, and calendar',
      'Whoop integration started — recovery, sleep, and workouts flow in next to Strava rides',
    ],
  },
];
