/**
 * `/quality` — opens the Generic Feature Quality Prompt as the session's next
 * user message.
 *
 * The prompt itself is not written in code: it lives in `prompt.md` next to this
 * file, verbatim except for eleven `{{FIELD}}` tokens in its Inputs block. That
 * keeps the proven text editable as text, and keeps this module to the work a
 * command actually has — parse the invocation, validate it, and submit the
 * result.
 *
 * Three public entry points, one operation:
 *  - the `/quality` slash command (typed in the composer);
 *  - `POST /plugins/feature-quality/start`, which the composer control calls so
 *    the form submits through the very same command;
 *  - `POST /plugins/feature-quality/preview` and `/status`, which show the exact
 *    message before it is sent and the run's evidence afterwards.
 *
 * Raw web routes do not inherit the Connection's authentication fence, so each
 * route applies `connection.requestRejection(req)` itself.
 *
 * Four inputs are required (FEATURE, SURFACE, USER JOB, OWNER) and both entry
 * points enforce the same rule, because a form that blocks what the command
 * accepts is a lie about the contract. The other seven may stay placeholders,
 * and the prompt's own "When to ask" section resolves them.
 */
import { readFileSync } from 'node:fs'
import { appendInputsLine, assertInputsBlock, normalizeNewlines } from './lib/template.mjs'
import { describeRun, isValidSlug, resolveRun, slugify, writeRun } from './lib/state.mjs'

export const name = 'feature-quality'
export const inject = ['commands']

const COMMAND_NAME = 'quality'
const STATUS_COMMAND_NAME = 'quality-status'
const START_ROUTE = '/plugins/feature-quality/start'
const PREVIEW_ROUTE = '/plugins/feature-quality/preview'
const STATUS_ROUTE = '/plugins/feature-quality/status'
const MAX_INPUT_CHARS = 8000
const MAX_BODY_BYTES = 256 * 1024
const PROMPT_URL = new URL('./prompt.md', import.meta.url)
const DEFAULTS_URL = new URL('./defaults.json', import.meta.url)
/**
 * `FEATURE_QUALITY_DEFAULTS` names a different presets file. The labs use it so a
 * check does not change meaning when the repository's own presets are edited.
 */
const DEFAULTS_PATH = process.env.FEATURE_QUALITY_DEFAULTS
const DEFAULT_ROUTE = '/plugins/feature-quality/defaults'

/**
 * `tier: 'required'` fields gate submission; the rest may stay placeholders.
 * `why` is shown by the control and quoted in the command's error, so the rule
 * explains itself at the point it refuses.
 */
export const FIELDS = [
  {
    key: 'FEATURE',
    label: 'FEATURE',
    aliases: ['feature', 'name'],
    fallback: '[name]',
    tier: 'required',
    why: 'every phase is scoped to it, and it names the run',
  },
  {
    key: 'SURFACE',
    label: 'SURFACE',
    aliases: ['surface'],
    fallback: '[page / flow / API / algorithm / integration]',
    tier: 'required',
    why: 'the prompt picks a different artifact and harness per surface',
  },
  {
    key: 'USER_JOB',
    label: 'USER JOB',
    aliases: ['user job', 'userjob', 'job'],
    fallback: '[what the user is trying to get done]',
    tier: 'required',
    why: 'a diagnosis of quality is a diagnosis of a job',
  },
  {
    key: 'CURRENT_STATE',
    label: 'CURRENT STATE',
    aliases: ['current state', 'current', 'state'],
    fallback: '[links to the current page, screenshots, plans, code]',
    tier: 'optional',
    why: 'Phase 0 reads it; the agent can find it in the repository',
  },
  {
    key: 'REAL_FIXTURE',
    label: 'REAL FIXTURE',
    aliases: ['real fixture', 'fixture', 'data'],
    fallback: '[one real ride / week / account / dataset, with source]',
    tier: 'optional',
    why: 'the prompt forbids synthetic fixtures replacing it, and Phase 0 can locate one',
  },
  {
    key: 'REFERENCES',
    label: 'REFERENCES',
    aliases: ['references', 'reference', 'refs'],
    fallback: '[3\u20135 links or frames that show "good"]',
    tier: 'optional',
    why: 'Phase 0.5 saves them as frames',
  },
  {
    key: 'ANTI_REFERENCES',
    label: 'ANTI-REFERENCES',
    aliases: ['anti-references', 'anti references', 'antireferences', 'anti', 'anti-refs'],
    fallback: '[1\u20132 links or frames that show what to avoid]',
    tier: 'optional',
    why: 'the contract names one; Phase 0 can propose it',
  },
  {
    key: 'EXTERNAL_SOURCES',
    label: 'EXTERNAL SOURCES',
    aliases: ['external sources', 'external', 'sources', 'source'],
    fallback: '[APIs, map providers, models, data sources, if any]',
    tier: 'optional',
    why: 'Phase 3 only runs when quality depends on an external source',
  },
  {
    key: 'PRODUCTION_LIMITS',
    label: 'PRODUCTION LIMITS',
    aliases: ['production limits', 'limits', 'constraints'],
    fallback: '[known constraints: keys, cost, mobile, offline, ToS]',
    tier: 'optional',
    why: 'a constraint the agent cannot see is asked for in Phase 6',
  },
  {
    key: 'FIRST_LOOK',
    label: 'FIRST LOOK',
    aliases: ['first look', 'firstlook', 'look', 'date'],
    fallback: '[date or "5\u201310 working days from start"]',
    tier: 'optional',
    why: 'a checkpoint can be agreed inside Phase 1',
  },
  {
    key: 'OWNER',
    label: 'OWNER',
    aliases: ['owner'],
    fallback: '[one person or agent accountable for the artifact]',
    tier: 'required',
    why: 'a quality contract without an accountable name is a wish',
  },
]

export const REQUIRED_LABELS = FIELDS.filter((field) => field.tier === 'required').map((field) => field.label)

/**
 * SURFACE is a closed set: the prompt's "Surface types and artifacts" table has
 * one row per value, and a URL in this field (which a real run did supply) picks
 * no row at all. Aliases exist so the form is forgiving without the value
 * becoming free text.
 */
export const SURFACES = [
  { value: 'page', aliases: ['page', 'ui', 'web', 'frontend'] },
  { value: 'flow', aliases: ['flow', 'interaction', 'ux'] },
  { value: 'API', aliases: ['api', 'backend', 'endpoint'] },
  { value: 'algorithm', aliases: ['algorithm', 'algo'] },
  { value: 'integration', aliases: ['integration', 'integrations', 'sync', 'provider'] },
]

const SURFACE_NAMES = SURFACES.map((surface) => surface.value)
const SURFACE_TEXT = `${SURFACE_NAMES.slice(0, -1).join(', ')} and ${SURFACE_NAMES[SURFACE_NAMES.length - 1]}`

/** Collapse a field to one line: the Inputs block is one line per field. */
function collapse(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/** Match a typed field name (`USER JOB`, `user-job`, `user_job`, `job`). */
function normalizeFieldName(value) {
  return String(value).toLowerCase().replace(/[\s_-]+/gu, ' ').trim()
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

/** Levenshtein distance, capped: only used to spot a near-miss field name. */
function editDistance(left, right) {
  if (left === right) return 0
  const a = [...left]
  const b = [...right]
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * A typo'd field name is prose, which silently joins FEATURE — a wrong brief is
 * worse than a rejected one. Name the likely field instead of guessing it.
 */
function nearestField(name) {
  if (name.length < 4) return undefined
  let best
  for (const [known, field] of FIELD_BY_NAME) {
    if (known.length < 4) continue
    const distance = editDistance(name, known)
    if (distance > 2 || distance === 0) continue
    if (best === undefined || distance < best.distance) best = { distance, field }
  }
  return best?.field
}

/**
 * Turn a slash-command line into Inputs values.
 *
 * Segments split on `|` or a newline. `key: value` fills a known field; every
 * other segment is part of the feature brief. Prose becomes FEATURE, appended
 * to an explicit `feature:` when both are given.
 *
 * @param rawInput - everything the user typed after `/quality`.
 * @returns `{ values, warnings }`, or `{ error }` when the line is unusable.
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
  const warnings = []
  for (const segment of text.split(/\r?\n|\|/u)) {
    const trimmed = segment.trim()
    if (trimmed.length === 0) continue
    const match = FIELD_SEGMENT.exec(trimmed)
    const field = match === null ? undefined : FIELD_BY_NAME.get(normalizeFieldName(match[1]))
    if (field === undefined) {
      prose.push(trimmed)
      if (match !== null) {
        const near = nearestField(normalizeFieldName(match[1]))
        if (near !== undefined) {
          warnings.push(`"${collapse(match[1])}" is not a field — did you mean ${near.label}? It was treated as prose.`)
        }
      }
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
  return { values, warnings }
}

/**
 * Read SURFACE as one or more of the five values.
 *
 * @param input - the typed value (`page`, `UI`, `page + API`, …).
 * @returns `{ ok, value }` canonicalised, or `{ ok: false, reason }`.
 */
export function parseSurface(input) {
  const text = collapse(input)
  if (text === '') return { ok: false, reason: 'SURFACE is empty.' }
  if (/^[a-z]+:\/\//iu.test(text)) {
    return {
      ok: false,
      reason: `SURFACE must be one of ${SURFACE_TEXT} — "${text}" is a URL. A URL belongs in CURRENT STATE.`,
    }
  }
  const tokens = text.split(/[+,/&]|\band\b/iu).map((token) => token.trim().toLowerCase()).filter((token) => token !== '')
  const chosen = []
  const unknown = []
  for (const token of tokens) {
    const surface = SURFACES.find((candidate) => (
      candidate.value.toLowerCase() === token || candidate.aliases.includes(token)
    ))
    if (surface === undefined) {
      if (!unknown.includes(token)) unknown.push(token)
      continue
    }
    if (!chosen.includes(surface.value)) chosen.push(surface.value)
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `SURFACE: ${unknown.map((token) => `"${token}"`).join(', ')} is not one of ${SURFACE_TEXT}.`,
    }
  }
  if (chosen.length === 0) {
    return { ok: false, reason: `SURFACE must be one of ${SURFACE_TEXT}.` }
  }
  return { ok: true, value: chosen.join(' + ') }
}

/**
 * Check the inputs against the contract the plugin enforces.
 *
 * @returns `{ missingRequired, surface }`; `surface.ok` is true when SURFACE is
 * absent, because absence is reported by `missingRequired`.
 */
export function validateValues(values) {
  const missingRequired = FIELDS
    .filter((field) => field.tier === 'required')
    .filter((field) => collapse(values?.[field.key]) === '')
    .map((field) => field.label)
  const surface = collapse(values?.SURFACE) === ''
    ? { ok: true, value: undefined }
    : parseSurface(values.SURFACE)
  return { missingRequired, surface }
}

/** The refusal both entry points share, so the rule reads the same in both. */
export function describeRequiredGap(missingRequired) {
  const list = missingRequired.length === 1
    ? missingRequired[0]
    : `${missingRequired.slice(0, -1).join(', ')} and ${missingRequired[missingRequired.length - 1]}`
  return `quality: ${list} ${missingRequired.length === 1 ? 'is' : 'are'} required before the prompt can start.\n`
    + 'Give them in one line, e.g.\n'
    + '  /quality Route quality badge | surface: page | job: decide which ride to repeat | owner: Oli\n'
    + 'The other seven inputs may stay placeholders — the prompt resolves them in Phase 0.'
}

/**
 * Canonicalise the values that have a closed vocabulary, without validating:
 * a bad SURFACE is left as typed so the refusal can quote it.
 */
export function canonicalise(values) {
  const next = { ...values }
  if (collapse(next.SURFACE) !== '') {
    const surface = parseSurface(next.SURFACE)
    if (surface.ok) next.SURFACE = surface.value
  }
  return next
}

/**
 * Read the preset values from `defaults.json` beside the prompt.
 *
 * A missing file means "no presets" — that is a legitimate configuration. A file
 * that exists and cannot be parsed is a startup error, because silently ignoring
 * it would deliver a prompt the author believes is pre-filled.
 *
 * @returns the file's text, or undefined when there is no file.
 */
function readDefaultsFile() {
  try {
    return readFileSync(DEFAULTS_PATH ?? DEFAULTS_URL, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`feature-quality: cannot read defaults.json (${describeThrown(error)})`)
  }
}

/**
 * Validate `defaults.json`: a flat object of `FIELD: "value"`.
 *
 * Only known fields are accepted, and each value is collapsed to one line like
 * every other input — a preset two lines long would break the Inputs block.
 *
 * @param text - the file's contents, or undefined when it does not exist.
 * @returns `{ values, warnings }`.
 */
export function parseDefaults(text) {
  if (text === undefined) return { values: {}, warnings: [] }
  let parsed
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    throw new Error(`feature-quality: defaults.json is not valid JSON (${describeThrown(error)})`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('feature-quality: defaults.json must be a JSON object of FIELD: "value"')
  }
  const values = {}
  const warnings = []
  for (const [key, value] of Object.entries(parsed)) {
    const field = FIELDS.find((candidate) => candidate.key === key)
    if (field === undefined) {
      warnings.push(`defaults.json: "${key}" is not an input; ignored`)
      continue
    }
    if (typeof value !== 'string' || collapse(value) === '') {
      warnings.push(`defaults.json: ${key} needs a non-empty string; ignored`)
      continue
    }
    values[field.key] = collapse(value)
  }
  return { values, warnings }
}

/**
 * Fill the inputs nobody supplied from the presets.
 *
 * A preset is a value the user would have typed, so it is supplied — it is not a
 * placeholder, and the `UNFILLED:` line must not name it. What it must not do is
 * hide: callers report `presets` in the receipt, and the control marks each one
 * and lets it be cleared.
 *
 * @param values - the parsed inputs.
 * @param defaults - the validated presets.
 * @returns `{ values, presets }` with preset labels in field order.
 */
export function applyDefaults(values, defaults) {
  const next = { ...values }
  const presets = []
  for (const field of FIELDS) {
    const preset = defaults?.[field.key]
    if (typeof preset !== 'string' || collapse(preset) === '') continue
    if (next[field.key] !== undefined) continue
    next[field.key] = collapse(preset)
    presets.push(field.label)
  }
  return { values: next, presets }
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
  const normalized = normalizeNewlines(template)
  const body = normalized.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (whole, key) => {
    const field = FIELDS.find((candidate) => candidate.key === key)
    if (field === undefined) return whole
    const value = values?.[field.key]
    return value === undefined ? field.fallback : value
  })
  const missing = FIELDS.filter((field) => values?.[field.key] === undefined)
  if (missing.length === 0) return body
  const labels = missing.map((field) => field.label).join(', ')
  return appendInputsLine(body, `UNFILLED:${''.padStart(11)}${labels}`)
}

/**
 * Everything both delivery paths need: the text, the slug, what is missing.
 *
 * @param template - the contents of `prompt.md`.
 * @param values - validated Inputs values.
 */
export function prepare(template, values) {
  const unfilled = FIELDS.filter((field) => values[field.key] === undefined).map((field) => field.label)
  return {
    text: buildPrompt(template, values),
    slug: slugify(values.FEATURE),
    supplied: FIELDS.length - unfilled.length,
    unfilled,
  }
}

/** The one-line receipt shown in the transcript after submission. */
export function describeSubmission(prepared, warnings = [], presets = []) {
  const head = `Quality prompt submitted — ${prepared.supplied}/${FIELDS.length} inputs supplied · run ${prepared.slug}`
  const missing = prepared.unfilled.length === 0 ? '' : ` Placeholders: ${prepared.unfilled.join(', ')}.`
  const tail = prepared.unfilled.length === 0 ? ' Phase 0 starts next.' : ''
  const presetNote = presets.length === 0 ? '' : ` Presets used: ${presets.join(', ')}.`
  const notes = warnings.length === 0 ? '' : ` ${warnings.join(' ')}`
  return `${head}.${missing}${tail}${presetNote}${notes}`
}

/** Record the run so `/quality-status` can report the brief, best-effort. */
function recordRun(values, prepared, extra) {
  try {
    return writeRun({
      slug: prepared.slug,
      feature: values.FEATURE,
      surface: values.SURFACE,
      supplied: prepared.supplied,
      unfilled: prepared.unfilled,
      createdAt: new Date().toISOString(),
      ...extra,
    })
  } catch (error) {
    return { error: describeThrown(error) }
  }
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
 * profile, so Node resolves imports against this plugin's own directory, where
 * the harness's packages do not exist.
 *
 * @param input - content blocks and the producer source.
 * @returns an immutable user-role message with a fresh identity.
 */
export function createUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: globalThis.crypto.randomUUID() }))
}

function loadTemplate() {
  let raw
  try {
    raw = readFileSync(PROMPT_URL, 'utf8')
  } catch (error) {
    throw new Error(`feature-quality: cannot read prompt.md beside index.js (${describeThrown(error)})`)
  }
  return assertInputsBlock(raw)
}

/** The command handler; the route reaches it through `ctx.commands.execute`. */
function commandHandler(template, defaults) {
  return async (invocation) => {
    const parsed = parseInvocation(invocation.rawInput)
    if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
    const applied = applyDefaults(parsed.values, defaults)
    const { missingRequired, surface } = validateValues(applied.values)
    if (missingRequired.length > 0) {
      return { kind: 'error', text: describeRequiredGap(missingRequired) }
    }
    if (!surface.ok) return { kind: 'error', text: `quality: ${surface.reason}` }
    applied.values.SURFACE = surface.value
    const prepared = prepare(template, applied.values)
    const message = createUserMessage({ content: [{ type: 'text', text: prepared.text }], source: { kind: 'user' } })
    try {
      await invocation.agent.followup(message)
    } catch (error) {
      return { kind: 'error', text: `feature-quality: submitting the prompt failed (${describeThrown(error)}).` }
    }
    recordRun(applied.values, prepared, {
      cwd: invocation.agent?.session?.header?.cwd,
      sessionId: invocation.agent?.id,
      line: `/${COMMAND_NAME} ${invocation.rawInput ?? ''}`.trim(),
      presets: applied.presets,
    })
    return { kind: 'success', text: describeSubmission(prepared, parsed.warnings, applied.presets) }
  }
}

/** `/quality-status` — the same scan the control shows, in the transcript. */
function statusCommandHandler() {
  return async (invocation) => {
    // This command takes a slug, not the prompt's inputs, so it must not go
    // through the field parser: `slug: x` there would become prose and land in
    // FEATURE, which is a different run's identity.
    const raw = collapse(invocation.rawInput).replace(/^slug\s*[:=]\s*/iu, '')
    const named = raw === '' ? undefined : raw.toLowerCase()
    if (named !== undefined && !isValidSlug(named)) {
      return { kind: 'error', text: `quality-status: "${named}" is not a slug (lowercase letters, digits and hyphens).` }
    }
    const state = resolveRun({ cwd: invocation.agent?.session?.header?.cwd, slug: named })
    return { kind: 'success', text: describeRun(state) }
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

function isQualityLine(line) {
  return line === `/${COMMAND_NAME}` || line.startsWith(`/${COMMAND_NAME} `)
}

/**
 * Build the preview for a line: the exact text, and why it would be blocked.
 *
 * The text is produced even when the line is blocked, because the control's job
 * is to show what is missing *in context*, not to hide the message.
 *
 * @returns `{ ok: true, ... }` or `{ ok: false, error }`.
 */
export function previewLine(template, line, defaults = {}) {
  if (!isQualityLine(line)) {
    return { ok: false, error: `line must start with /${COMMAND_NAME}` }
  }
  const parsed = parseInvocation(line.slice(`/${COMMAND_NAME}`.length))
  if (parsed.error !== undefined) return { ok: false, error: parsed.error }
  const applied = applyDefaults(parsed.values, defaults)
  const { missingRequired, surface } = validateValues(applied.values)
  const prepared = prepare(template, canonicalise(applied.values))
  const problems = []
  if (missingRequired.length > 0) problems.push(describeRequiredGap(missingRequired))
  if (!surface.ok) problems.push(`quality: ${surface.reason}`)
  return {
    ok: true,
    text: prepared.text,
    slug: prepared.slug,
    supplied: prepared.supplied,
    unfilled: prepared.unfilled,
    presets: applied.presets,
    missingRequired,
    surface: surface.ok ? (surface.value ?? null) : null,
    ...(problems.length === 0 ? {} : { blocked: problems.join('\n\n') }),
  }
}

/**
 * The three routes. The raw web server dispatches on pathname alone
 * (`WebServer.match`), so a route is reached by any method and carries no method
 * contract of its own; the body is read when one is present.
 *
 * Registration waits for `webServer` through `ctx.inject`, because this row can
 * activate before the web-app layer mounts the server — registering in `apply`
 * would silently leave the path unclaimed, and the SPA fallback would answer 405
 * to the control's POST.
 */
function registerRoutes(ctx, server, template, defaults) {
  const disposeStart = server.register({
    kind: 'exact',
    path: START_ROUTE,
    handler: async (req, res) => {
      if (!admit(ctx, req, res)) return
      let payload
      try {
        payload = await readJsonRequest(req)
      } catch (error) {
        respondJson(res, 400, { error: describeThrown(error) })
        return
      }
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
      const line = typeof payload.line === 'string' ? payload.line : ''
      if (sessionId === '' || !isQualityLine(line)) {
        respondJson(res, 400, { error: `sessionId and a /${COMMAND_NAME} line are required` })
        return
      }
      const agent = ctx.get('agents')?.get(sessionId)
      if (agent === undefined) {
        respondJson(res, 409, { error: 'That session is not attached to this harness any more.' })
        return
      }
      // Validate before either path runs, so the control's error is the command's
      // error and not a post-hoc failure inside the agent.
      const preview = previewLine(template, line, defaults)
      if (!preview.ok || preview.blocked !== undefined) {
        respondJson(res, 400, { error: preview.ok ? preview.blocked : `quality: ${preview.error}` })
        return
      }
      try {
        // The prompt's own instruction is "paste it as the first message of a new
        // session". `mode: 'new'` honours that; anything else delivers into the
        // A raw web route carries no caller signal, and the session controller's
        // `prompt(request, signal)` requires one — it calls `signal.throwIfAborted()`
        // before it does anything else. A missing signal is not a cancellation,
        // it is a crash: `Cannot read properties of undefined (reading
        // 'throwIfAborted')`. One signal covers admission and the command path.
        const signal = new AbortController().signal
        // The prompt's own instruction is "paste it as the first message of a new
        // session". `mode: 'new'` honours that; anything else delivers into the
        // session the control lives in.
        if (payload.mode === 'new') {
          const sessionController = ctx.get('sessionController')
          if (sessionController === undefined) {
            respondJson(res, 503, { error: 'This harness cannot create a session.' })
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
            content: [{ type: 'text', text: preview.text }],
          }, signal)
          const parsed = parseInvocation(line.slice(`/${COMMAND_NAME}`.length))
          const values = canonicalise(parsed.values)
          recordRun(values, preview, {
            cwd: typeof cwd === 'string' ? cwd : undefined,
            sessionId: created.sessionId,
            line,
          })
          respondJson(res, 200, {
            ok: true,
            sessionId: created.sessionId,
            slug: preview.slug,
            text: 'Started a new session with the prompt as its first message. Open it from the sidebar.',
            status: resolveRun({ cwd: request.cwd, slug: preview.slug }),
          })
          return
        }
        const execution = await ctx.commands.execute(agent, line, [], signal)
        if (execution === undefined) {
          respondJson(res, 409, { error: `/${COMMAND_NAME} is not registered for that session.` })
          return
        }
        if (execution.result.kind === 'error') {
          respondJson(res, 200, { ok: false, error: execution.result.text })
          return
        }
        respondJson(res, 200, {
          ok: true,
          slug: preview.slug,
          text: execution.result.text ?? 'Quality prompt submitted.',
          status: resolveRun({ cwd: agent.session?.header?.cwd, slug: preview.slug }),
        })
      } catch (error) {
        ctx.logger.warn?.(`feature-quality: start route failed: ${describeThrown(error)}`)
        respondJson(res, 500, { error: `The prompt could not be submitted (${describeThrown(error)}).` })
      }
    },
  })

  const disposePreview = server.register({
    kind: 'exact',
    path: PREVIEW_ROUTE,
    handler: async (req, res) => {
      if (!admit(ctx, req, res)) return
      let payload
      try {
        payload = await readJsonRequest(req)
      } catch (error) {
        respondJson(res, 400, { error: describeThrown(error) })
        return
      }
      const line = typeof payload.line === 'string' ? payload.line : ''
      const preview = previewLine(template, line, defaults)
      if (!preview.ok) {
        respondJson(res, 400, { error: `quality: ${preview.error}` })
        return
      }
      respondJson(res, 200, preview)
    },
  })

  // The control asks for the presets before it opens, so the form and the
  // command see one set of values from one file.
  const disposeDefaults = server.register({
    kind: 'exact',
    path: DEFAULT_ROUTE,
    handler: async (req, res) => {
      if (!admit(ctx, req, res)) return
      respondJson(res, 200, { ok: true, defaults, presets: Object.keys(defaults) })
    },
  })

  const disposeStatus = server.register({
    kind: 'exact',
    path: STATUS_ROUTE,
    handler: async (req, res) => {
      if (!admit(ctx, req, res)) return
      let payload
      try {
        payload = await readJsonRequest(req)
      } catch (error) {
        respondJson(res, 400, { error: describeThrown(error) })
        return
      }
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
      const agent = sessionId === '' ? undefined : ctx.get('agents')?.get(sessionId)
      const cwd = agent?.session?.header?.cwd ?? (typeof payload.cwd === 'string' ? payload.cwd : undefined)
      const slug = typeof payload.slug === 'string' ? payload.slug.trim() : ''
      if (slug !== '' && !isValidSlug(slug)) {
        respondJson(res, 400, { error: `"${slug}" is not a slug` })
        return
      }
      respondJson(res, 200, { ok: true, ...resolveRun({ cwd, slug: slug === '' ? undefined : slug }) })
    },
  })

  return () => {
    disposeStart()
    disposePreview()
    disposeStatus()
    disposeDefaults()
  }
}

/** The fence every route applies: Host/Origin, then the login cookie. */
function admit(ctx, req, res) {
  const connection = ctx.get('connection')
  const rejection = connection === undefined ? 503 : connection.requestRejection(req)
  if (rejection === undefined) return true
  respondJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable' : 'unauthorized' })
  return false
}

/**
 * Register the slash commands and the control's routes for the lifetime of this
 * plugin row.
 * @param ctx - the Cordis context owning the row.
 */
export function apply(ctx) {
  const template = loadTemplate()
  const { values: defaults, warnings: defaultWarnings } = parseDefaults(readDefaultsFile())
  for (const warning of defaultWarnings) ctx.logger.warn?.(`feature-quality: ${warning}`)
  ctx.effect(() => {
    const disposeQuality = ctx.commands.register({
      name: COMMAND_NAME,
      description: 'Open the Generic Feature Quality Prompt: diagnose the quality ceiling, agree a contract, build one artifact, decide.',
      input: {
        hint: '<brief> | surface: <page|flow|API|algorithm|integration> | job: \u2026 | fixture: \u2026 | owner: \u2026',
      },
      handler: commandHandler(template, defaults),
    })
    const disposeStatusCommand = ctx.commands.register({
      name: STATUS_COMMAND_NAME,
      description: 'Show the quality run for this workspace: which deliverables exist, and what is next.',
      input: { hint: '[slug: <slug>]' },
      handler: statusCommandHandler(),
    })
    return () => {
      disposeQuality()
      disposeStatusCommand()
    }
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
    scope.effect(() => registerRoutes(ctx, server, template, defaults), 'feature-quality: composer control routes')
    ctx.logger.info?.(`feature-quality: composer control served at ${START_ROUTE}, ${PREVIEW_ROUTE}, ${STATUS_ROUTE}, ${DEFAULT_ROUTE}`)
  })
  ctx.logger.info?.(`feature-quality: /${COMMAND_NAME} ready (prompt.md, ${FIELDS.length} inputs, ${REQUIRED_LABELS.length} required, ${Object.keys(defaults).length} presets)`)
}
