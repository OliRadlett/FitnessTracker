export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  bullets: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '2026-09-09',
    date: '2026-09-09',
    title: 'Strength Videos + Route Polish',
    bullets: [
      '3D route terrain (3.16) — drape any route over a real Copernicus DEM heightmap in three.js; colour the path by elevation or gradient, orbit/zoom/pan, toggle from the route Map & Profile tab',
      'Strength video system — record or link YouTube/Vimeo videos to lifting sessions and PRs; Video Bank page with exercise/date/source filters',
      'Mobile route detail — tapping a route on mobile now opens a slide-up bottom sheet instead of doing nothing',
      'Save filters as smart collection — the routes filter bar now has a "Save as Collection" button that creates a reusable smart collection from your active filters',
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
];
