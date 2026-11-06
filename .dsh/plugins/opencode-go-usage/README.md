# OpenCode Go Usage

A quiet quota meter for the DSH Web UI. It sits under the composer as a single
low-contrast line — `5h 8% · wk 30% · mo 17%` — and opens into a detail card on
hover, focus or click.

## What it shows

| Where | Detail |
| --- | --- |
| Pill | The three OpenCode Go windows (`5h`, `wk`, `mo`) as a micro bar plus percentage. Bars stay neutral grey until a window passes 70% (amber) or 90% (red). |
| Card | Per window: exact percentage, progress bar, reset countdown (`Resets in 1h 52m · 02:11`), the reset clock in your own timezone, a 20-minute burn pace (`At this pace, full in ~3h`), and a sparkline of recent samples. |
| Footer | Last successful fetch, and a manual **Refresh**. |

Countdowns tick while the card is open. Samples are kept in `localStorage`, so
the last snapshot paints instantly on reload and the sparkline survives restarts.

Behaviour worth knowing:

- Refreshes every 2 minutes, and again when a hidden tab becomes visible if the
  data is older than 45 seconds. Hidden tabs do not poll.
- The Host caches upstream for 60 seconds and coalesces concurrent readers, so
  several open windows cost one request.
- If a refresh fails, the last known values stay on screen with a warning dot and
  a note; an expired key or missing credential is reported in the card.
- Keyboard: <kbd>Tab</kbd> opens, <kbd>Esc</kbd> closes, the pill exposes
  `aria-haspopup`/`aria-expanded`.

## Credentials

The API key never reaches the browser. The Host resolves it per request through
the credentials service:

```yaml
# ~/.dsh/.credentials.yaml
refs:
  OPENCODE_GO_API_KEY: oc_sk_...
```

Or set `OPENCODE_GO_API_KEY` in the environment. Alternatively set `apiKey`
directly in the plugin config when you would rather keep the key in the profile.

## Configuration

```yaml
- id: opencode-go-usage
  name: opencode-go-usage
  config:
    credentialRef: OPENCODE_GO_API_KEY   # credential record to resolve
    endpoint: https://opencode.ai/zen/go/v1/usage   # override for a proxy
    apiKey: ''                           # optional inline key; prefer credentialRef
```

## Routes

`GET /plugins/opencode-go-usage/usage` returns:

```json
{
  "ok": true,
  "source": "live",
  "fetchedAt": 1793837378661,
  "serverTime": 1793837382173,
  "windows": {
    "rolling": { "status": "ok", "percent": 8, "resetsAt": "2026-11-05T02:11:08.000Z" },
    "weekly":  { "status": "ok", "percent": 30, "resetsAt": "2026-11-09T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 17, "resetsAt": "2026-11-24T13:57:49.000Z" }
  }
}
```

`source` is `live`, `cache` or `stale` (the last two are served without a new
upstream call). `?force=1` skips the 60-second cache. The route is bound to the
loopback web server that already serves this UI; it carries no key material.

## Layout

```
opencode-go-usage/
├── package.json       # dsh.bundle patch + dsh.client(web) manifest
├── cordis.patch.yml   # plugin row
├── index.js           # Host: credential resolution, 60s cache, JSON route
├── client.js          # Client: __ModuleLoader__ factory, composer-dock meter
├── locale/en.json     # plugin-manager metadata
├── locale/zh.json
└── icon.svg
```

## Notes

- Reads the documented public endpoint `GET /zen/go/v1/usage`. OpenCode exposes
  only the three current windows there — no history or per-model breakdown — so
  everything historical in the card is derived from this plugin's own samples.
- No build step and no dependencies: the Client half is plain JavaScript loaded
  by the browser module table.
