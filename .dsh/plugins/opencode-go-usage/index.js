/**
 * OpenCode Go usage — Host half.
 *
 * Serves one same-origin JSON route for the Client meter:
 *   GET /plugins/opencode-go-usage/usage[?force=1]
 *
 * The API key never leaves this process: it is resolved per request through the
 * credentials service (or an explicit `apiKey` in the plugin config) and is
 * never logged, cached, or written into a response.
 */

const DEFAULT_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'
const ROUTE_PATH = '/plugins/opencode-go-usage/usage'
const CACHE_MS = 60_000
const REQUEST_TIMEOUT_MS = 12_000
const WINDOWS = ['rolling', 'weekly', 'monthly']

function brief(value) {
  const text = value instanceof Error ? value.message : String(value ?? '')
  return text.trim().slice(0, 200) || 'unknown'
}

function normaliseWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const percent = Number(raw.percent)
  return {
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent * 10) / 10)) : 0,
    resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
  }
}

/** Resolve the bearer token without ever returning it to the caller. */
async function resolveKey(ctx, config) {
  const configured = config && typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  if (configured !== '') return configured

  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined

  const ref = config && typeof config.credentialRef === 'string' && config.credentialRef.trim() !== ''
    ? config.credentialRef.trim()
    : 'OPENCODE_GO_API_KEY'

  try {
    const resolved = await credentials.resolve(ref)
    if (resolved === undefined || resolved === null) return undefined
    const value = typeof resolved === 'string'
      ? resolved
      : resolved.value ?? resolved.secret ?? resolved.token
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

async function fetchUsage(ctx, config) {
  const key = await resolveKey(ctx, config)
  if (key === undefined) return { ok: false, error: 'no-key' }

  const endpoint = config && typeof config.endpoint === 'string' && config.endpoint.trim() !== ''
    ? config.endpoint.trim()
    : DEFAULT_ENDPOINT

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (error) {
    return { ok: false, error: 'network', detail: brief(error) }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return { ok: false, error: 'http', detail: `HTTP ${response.status}` }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: 'parse' }
  }

  const usage = payload && typeof payload === 'object' ? payload.usage : undefined
  if (usage === null || typeof usage !== 'object') return { ok: false, error: 'bad-response' }

  const windows = {}
  for (const name of WINDOWS) {
    const window = normaliseWindow(usage[name])
    if (window === null) return { ok: false, error: 'bad-response', detail: `missing ${name}` }
    windows[name] = window
  }

  return { ok: true, fetchedAt: Date.now(), windows }
}

/**
 * One coalescing cache per plugin instance: concurrent browsers share a single
 * upstream request, a failed refresh keeps the last good snapshot visible.
 */
function createReader(ctx, config) {
  let snapshot = null
  let snapshotAt = 0
  let pending = null

  return async function read(force) {
    const fresh = snapshot !== null && Date.now() - snapshotAt < CACHE_MS
    if (fresh && force !== true) return { ...snapshot, source: 'cache' }
    if (pending !== null) return pending

    pending = (async () => {
      const result = await fetchUsage(ctx, config)
      if (result.ok) {
        snapshot = result
        snapshotAt = Date.now()
        return { ...result, source: 'live' }
      }
      if (snapshot !== null) {
        return { ...snapshot, source: 'stale', error: result.error, detail: result.detail }
      }
      return result
    })()

    try {
      return await pending
    } finally {
      pending = null
    }
  }
}

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const read = createReader(ctx, config)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      let body
      try {
        const url = new URL(req.url || ROUTE_PATH, 'http://localhost')
        body = await read(url.searchParams.get('force') === '1')
      } catch (error) {
        body = { ok: false, error: 'internal', detail: brief(error) }
      }
      body.serverTime = Date.now()
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(body))
    },
  }), 'opencode-go-usage: quota route')
}
