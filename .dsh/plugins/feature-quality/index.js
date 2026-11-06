/**
 * `/quality` — opens the Generic Feature Quality Prompt as the session's next
 * user message.
 *
 * The prompt itself is not written in code: it lives in `prompt.md` next to this
 * file, verbatim except for eleven `{{FIELD}}` tokens in its Inputs block. That
 * keeps the proven text editable as text, and keeps this module to the work a
 * command actually has — parse the invocation, and submit the result.
 *
 * Two public entry points, one operation:
 *  - the `/quality` slash command (typed in the composer);
 *  - `POST /plugins/feature-quality/start`, which the composer control calls so
 *    the form submits through the very same command.
 *
 * Raw web routes do not inherit the Connection's authentication fence, so the
 * route applies `connection.requestRejection(req)` itself.
 */
import { readFileSync } from 'node:fs'

export const name = 'feature-quality'
export const inject = ['commands']

const COMMAND_NAME = 'quality'
const START_ROUTE = '/plugins/feature-quality/start'
const MAX_INPUT_CHARS = 8000
const MAX_BODY_BYTES = 256 * 1024
const PROMPT_URL = new URL('./prompt.md', import.meta.url)

const FIELDS = [
  {
    key: 'FEATURE',
    label: 'FEATURE',
    aliases: ['feature', 'name'],
    fallback: '[name]',
  },
  {
    key: 'SURFACE',
    label: 'SURFACE',
    aliases: ['surface'],
    fallback: '[page / flow / API / algorithm / integration]',
  },
  {
    key: 'USER_JOB',
    label: 'USER JOB',
    aliases: ['user job', 'userjob', 'job'],
    fallback: '[what the user is trying to get done]',
  },
  {
    key: 'CURRENT_STATE',
    label: 'CURRENT STATE',
    aliases: ['current state', 'current', 'state'],
    fallback: '[links to the current page, screenshots, plans, code]',
  },
  {
    key: 'REAL_FIXTURE',
    label: 'REAL FIXTURE',
    aliases: ['real fixture', 'fixture', 'data'],
    fallback: '[one real ride / week / account / dataset, with source]',
  },
  {
    key: 'REFERENCES',
    label: 'REFERENCES',
    aliases: ['references', 'reference', 'refs'],
    fallback: '[3\u20135 links or frames that show "good"]',
  },
  {
    key: 'ANTI_REFERENCES',
    label: 'ANTI-REFERENCES',
    aliases: ['anti-references', 'anti references', 'antireferences', 'anti', 'anti-refs'],
    fallback: '[1\u20132 links or frames that show what to avoid]',
  },
  {
    key: 'EXTERNAL_SOURCES',
    label: 'EXTERNAL SOURCES',
    aliases: ['external sources', 'external', 'sources', 'source'],
    fallback: '[APIs, map providers, models, data sources, if any]',
  },
  {
    key: 'PRODUCTION_LIMITS',
    label: 'PRODUCTION LIMITS',
    aliases: ['production limits', 'limits', 'constraints'],
    fallback: '[known constraints: keys, cost, mobile, offline, ToS]',
  },
  {
    key: 'FIRST_LOOK',
    label: 'FIRST LOOK',
    aliases: ['first look', 'firstlook', 'look', 'date'],
    fallback: '[date or "5\u201310 working days from start"]',
  },
  {
    key: 'OWNER',
    label: 'OWNER',
    aliases: ['owner'],
    fallback: '[one person or agent accountable for the artifact]',
  },
]

/** Collapse a field to one line: the Inputs block is one line per field. */
function collapse(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

/** Match a typed field name (`USER JOB`, `user-job`, `user_job`, `job`). */
function normalizeFieldName(value) {
  return value.toLowerCase().replace(/[\s_-]+/gu, ' ').trim()
}

const FIELD_BY_NAME = new Map()
for (const field of FIELDS) {
  FIELD_BY_NAME.set(normalizeFieldName(field.label), field)
  FIELD_BY_NAME.set(normalizeFieldName(field.key), field)
  for (const alias of field.aliases) FIELD_BY_NAME.set(normalizeFieldName(alias), field)
}

/** A `key: value` segment; anything else is prose that becomes the brief. */
const FIELD_SEGMENT = /^([A-Za-z][A-Za-z0-9 _-]{0,40}?)\s*[:=]\s*(.*)$/u

function describeThrown(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Turn a slash-command line into Inputs values.
 *
 * Segments split on `|` or a newline. `key: value` fills a known field; every
 * other segment is part of the feature brief. Prose becomes FEATURE, appended
 * to an explicit `feature:` when both are given.
 *
 * @param rawInput - everything the user typed after `/quality`.
 * @returns `{ values }`, or `{ error }` when the line is unusable.
 */
export function parseInvocation(rawInput) {
  const text = String(rawInput ?? '').trim()
  if (text.length > MAX_INPUT_CHARS) {
    return {
      error: `feature-quality: that is ${text.length} characters of input; the limit is ${MAX_INPUT_CHARS}. Put long context in a file and reference it as current: <path>.`,
    }
  }
  const values = {}
  const prose = []
  for (const segment of text.split(/\r?\n|\|/u)) {
    const trimmed = segment.trim()
    if (trimmed.length === 0) continue
    const match = FIELD_SEGMENT.exec(trimmed)
    const field = match === null ? undefined : FIELD_BY_NAME.get(normalizeFieldName(match[1]))
    if (field === undefined) {
      prose.push(trimmed)
      continue
    }
    const value = collapse(match[2])
    if (value.length === 0) continue
    values[field.key] = values[field.key] === undefined ? value : `${values[field.key]}; ${value}`
  }
  const brief = collapse(prose.join(' '))
  if (brief.length > 0) {
    values.FEATURE = values.FEATURE === undefined ? brief : `${values.FEATURE} \u2014 ${brief}`
  }
  return { values }
}

/**
 * Append one line inside the Inputs block, before its closing fence.
 *
 * The block is the only region this tool is entitled to write: `prompt.md`'s
 * prose is the proven asset and is delivered unchanged.
 */
function appendInputsLine(text, line) {
  const marker = 'Inputs\n```\n'
  const start = text.indexOf(marker)
  if (start === -1) return text
  const bodyStart = start + marker.length
  const close = text.indexOf('```', bodyStart)
  if (close === -1) return text
  return `${text.slice(0, close)}${line}\n${text.slice(close)}`
}

/**
 * Fill `prompt.md` from the supplied inputs.
 *
 * A missing input keeps its original bracketed description. When any input is
 * missing, one `UNFILLED:` line joins the block naming them — data, not
 * instruction: the prompt's own "When to ask, and when not to" section already
 * says what to do with a missing reference, fixture or first-look date, and this
 * module does not add a rule to it. With every input supplied the block carries
 * no addition at all.
 *
 * @param template - the contents of `prompt.md`.
 * @param values - the parsed Inputs values.
 * @returns the message to submit.
 */
export function buildPrompt(template, values) {
  const body = template.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (whole, key) => {
    const field = FIELDS.find((candidate) => candidate.key === key)
    if (field === undefined) return whole
    const value = values[field.key]
    return value === undefined ? field.fallback : value
  })
  const missing = FIELDS.filter((field) => values[field.key] === undefined)
  if (missing.length === 0) return body
  const labels = missing.map((field) => field.label).join(', ')
  return appendInputsLine(body, `UNFILLED:${''.padStart(11)}${labels}`)
}

/** The one-line receipt shown in the transcript after submission. */
export function describeSubmission(values) {
  const supplied = FIELDS.filter((field) => values[field.key] !== undefined).length
  const missing = FIELDS.filter((field) => values[field.key] === undefined).map((field) => field.label)
  const head = `Quality prompt submitted \u2014 ${supplied}/${FIELDS.length} inputs supplied`
  if (missing.length === 0) return `${head}. Phase 0 starts next.`
  return `${head}. Placeholders: ${missing.join(', ')}.`
}

/** Recursively freeze a value, as `@deepseek-ai/dsh-llm`'s message helpers do. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

/**
 * A user message in the shape the agent expects.
 *
 * This is the published `createUserMessage` from `@deepseek-ai/dsh-llm` —
 * `deepFreeze(structuredClone({ ...input, role: 'user', id: randomUUID() }))` —
 * inlined on purpose: this bundle is installed from a directory outside the
 * profile, so Node resolves imports against `C:\Projects\dsh-plugins\…`, where
 * the harness's own packages do not exist.
 *
 * @param input - content blocks and the producer source.
 * @returns an immutable user-role message with a fresh identity.
 */
export function createUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: globalThis.crypto.randomUUID() }))
}

function loadTemplate() {
  try {
    return readFileSync(PROMPT_URL, 'utf8')
  } catch (error) {
    throw new Error(`feature-quality: cannot read prompt.md beside index.js (${describeThrown(error)})`)
  }
}

/** The command handler; the route reaches it through `ctx.commands.execute`. */
function commandHandler(template) {
  return async (invocation) => {
    const parsed = parseInvocation(invocation.rawInput)
    if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
    const text = buildPrompt(template, parsed.values)
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    try {
      await invocation.agent.followup(message)
    } catch (error) {
      return { kind: 'error', text: `feature-quality: submitting the prompt failed (${describeThrown(error)}).` }
    }
    return { kind: 'success', text: describeSubmission(parsed.values) }
  }
}

function respondJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/** Bounded JSON body reader: the route never buffers an oversized request. */
function readJsonRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
      if (error !== undefined) {
        chunks.length = 0
        req.resume()
        reject(error)
        return
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (raw === '') {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('body must be a JSON object'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new Error('body is not valid JSON'))
      }
    }
    const onData = (chunk) => {
      // Chunks are Buffers on a real server request, but a stream may emit text.
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > MAX_BODY_BYTES) finish(new Error('body is too large'))
      else chunks.push(part)
    }
    const onEnd = () => finish(undefined)
    const onError = () => finish(new Error('request body failed'))
    const onAborted = () => finish(new Error('request aborted'))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('aborted', onAborted)
  })
}

/**
 * The composer control's entry point: run the same command for one session.
 *
 * The raw web server dispatches on pathname alone (`WebServer.match`), so the
 * route is reached by any method and carries no method contract of its own. It
 * is registered through `ctx.inject`, because this row can activate before the
 * web-app layer mounts the server — registering in `apply` would silently leave
 * the path unclaimed, and the SPA fallback would answer 405 to the control's POST.
 *
 * @param ctx - the Cordis context owning this row.
 * @param server - the live web server whose exact-path table takes the route.
 * @returns the route disposer.
 */
function registerStartRoute(ctx, server, template) {
  return server.register({
    kind: 'exact',
    path: START_ROUTE,
    handler: async (req, res) => {
      const connection = ctx.get('connection')
      const rejection = connection === undefined ? 503 : connection.requestRejection(req)
      if (rejection !== undefined) {
        respondJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable' : 'unauthorized' })
        return
      }
      let payload
      try {
        payload = await readJsonRequest(req)
      } catch (error) {
        respondJson(res, 400, { error: describeThrown(error) })
        return
      }
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
      const line = typeof payload.line === 'string' ? payload.line : ''
      if (sessionId === '' || !(line === `/${COMMAND_NAME}` || line.startsWith(`/${COMMAND_NAME} `))) {
        respondJson(res, 400, { error: `sessionId and a /${COMMAND_NAME} line are required` })
        return
      }
      const agent = ctx.get('agents')?.get(sessionId)
      if (agent === undefined) {
        respondJson(res, 409, { error: 'That session is not attached to this harness any more.' })
        return
      }
      try {
        // The prompt's own instruction is "paste it as the first message of a new
        // session". `mode: 'new'` honours that; anything else delivers into the
        // session the control lives in.
        if (payload.mode === 'new') {
          const sessionController = ctx.get('sessionController')
          if (sessionController === undefined) {
            respondJson(res, 503, { error: 'This harness cannot create a session.' })
            return
          }
          const parsed = parseInvocation(line.slice(`/${COMMAND_NAME}`.length))
          if (parsed.error !== undefined) {
            respondJson(res, 400, { error: parsed.error })
            return
          }
          const request = {}
          const cwd = agent.session?.header?.cwd
          if (typeof cwd === 'string' && cwd !== '') request.cwd = cwd
          const created = await sessionController.create(request)
          await sessionController.prompt({
            requestId: globalThis.crypto.randomUUID(),
            sessionId: created.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: buildPrompt(template, parsed.values) }],
          })
          respondJson(res, 200, {
            ok: true,
            sessionId: created.sessionId,
            text: `Started a new session with the prompt as its first message. Open it from the sidebar.`,
          })
          return
        }
        const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
        if (execution === undefined) {
          respondJson(res, 409, { error: `/${COMMAND_NAME} is not registered for that session.` })
          return
        }
        if (execution.result.kind === 'error') {
          respondJson(res, 200, { ok: false, error: execution.result.text })
          return
        }
        respondJson(res, 200, { ok: true, text: execution.result.text ?? 'Quality prompt submitted.' })
      } catch (error) {
        ctx.logger.warn?.(`feature-quality: start route failed: ${describeThrown(error)}`)
        respondJson(res, 500, { error: `The prompt could not be submitted (${describeThrown(error)}).` })
      }
    },
  })
}

/**
 * Register the slash command and the composer control's route for the lifetime
 * of this plugin row.
 * @param ctx - the Cordis context owning the row.
 */
export function apply(ctx) {
  const template = loadTemplate()
  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: COMMAND_NAME,
      description: 'Open the Generic Feature Quality Prompt: diagnose the quality ceiling, agree a contract, build one artifact, decide.',
      input: {
        hint: '<brief> | feature: <name> | surface: <surface> | job: \u2026 | fixture: \u2026 | owner: \u2026',
      },
      handler: commandHandler(template),
    })
    return () => dispose()
  }, 'feature-quality: /quality command')
  // The web server mounts with the browser-surface layer, which can activate
  // after this row; wait for it instead of racing it.
  ctx.inject(['webServer'], (webCtx) => {
    const scope = webCtx ?? ctx
    const server = scope.webServer ?? ctx.get('webServer')
    if (server === undefined) {
      ctx.logger.warn?.('feature-quality: web server is not resolvable; the composer control is unavailable')
      return
    }
    scope.effect(() => registerStartRoute(ctx, server, template), 'feature-quality: composer control route')
    ctx.logger.info?.(`feature-quality: composer control served at ${START_ROUTE}`)
  })
  ctx.logger.info?.(`feature-quality: /${COMMAND_NAME} ready (prompt.md, ${FIELDS.length} inputs)`)
}
