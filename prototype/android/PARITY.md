# Parity matrix — 20 desktop destinations → 5 phone tabs

> G9 says every in-app desktop destination must have a named phone destination.
> Pitch: parity of *features*, not of layouts. Each tab is designed for a thumb,
> then checked against the desktop surface for coverage.

Status key: **rendered** = exists as a frame in `qa/out/`; **specified** = named
and scoped here, not yet designed; **demoted** = deliberately lower in the
hierarchy, same features.

| # | Desktop route | Phone destination | Status | What changes on the phone |
|---|---|---|---|---|
| 1 | `/dashboard` | Today (tab, default) | rendered | One card + one week strip. The desktop's six KPI tiles collapse to the session and its history. |
| 2 | `/today` | Today (tab, default) | rendered | Same job as the dashboard — merged rather than kept as a second screen. |
| 3 | `/journal` | Today › Log (segmented) | specified | Chronological log; week grouping kept, filters move to a sheet. |
| 4 | `/activities` | Today › Log (segmented) | specified | Merged with the journal: two views of one log, not two destinations. |
| 5 | `/activities/{id}` | Log › Activity detail | specified | Tabs become a single scroll with sticky section chips. |
| 6 | `/training` | Train (tab) | specified | Plan spine first; the week editor is a drill-in, not the landing. |
| 7 | `/calendar` | Train › Calendar | specified | Same grid, day-detail becomes a sheet. |
| 8 | `/lifting` | Train › Lifting | specified | Sessions list + start; the desktop's tabbed detail collapses. |
| 9 | `/lifting/live` | Train › Live | rendered | Full-screen instrument, no tab bar. This is the phone's reason to exist. |
| 10 | `/lifting/videos` | Train › Videos | specified | Grid of thumbnails; review is full-screen landscape. |
| 11 | `/goals` | Train › Goals | specified | Cards, one expanded at a time. |
| 12 | `/cycling` | Ride (tab) | specified | Power/load summary plus the next ride; the deep analysis stays a drill-in. |
| 13 | `/routes` | Ride › Routes | specified | Map-first Browse (atlas), list as a bottom sheet. |
| 14 | `/segments` | Ride › Climbs | specified | Rows, not cards; the 20,451 px desktop-mobile page must not survive. |
| 15 | `/replay` | Ride › Replay | specified | Landscape 3D; portrait is a poster frame plus "rotate". |
| 16 | `/routes/duplicates` | Ride › Routes › Maintain | demoted | Admin job, settings-level, never on the main path. |
| 17 | `/health` | Body (tab) | specified | One expanded card at a time instead of a six-card grid. |
| 18 | `/analytics` | Body › Insights | specified | Season/insights drill-in; charts keep the desktop's fidelity. |
| 19 | `/settings` | You (tab) | specified | Grouped list, 48dp rows. |
| 20 | `/notifications` | You › Inbox | specified | Also surfaced as a badge on Today. |
| 21 | `/wiki` | You › Guide | specified | Searchable list. |

Count: 21 desktop routes (the audit said 20; `/activities/{id}` makes 21).
Five are rendered in this pass, sixteen are named. Nothing is dropped.

## Open parity risks

- **Log nested under Today** means the journal is two taps from a cold open.
  If that turns out to be the wrong call, Log becomes a tab and Body folds into
  Today — a swap, not a redesign.
- **Calendar inside Train** is a judgement call: it is a training calendar, but
  it is also the app's time index. Watch for it wanting to be a top-level mode.
- **Maintain** (`/routes/duplicates`) is the only demoted surface. Its desktop
  scan takes >120 s and belongs in a job, not a phone screen.
