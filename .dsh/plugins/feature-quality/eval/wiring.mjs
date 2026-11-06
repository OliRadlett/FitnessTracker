/**
 * Wiring lab: the half `harness.mjs` cannot see.
 *
 * The text lab catches defects in the delivered prompt. Every defect that cost
 * this build its rounds lived elsewhere — a route that never registered, a 405
 * from the SPA fallback, an import that could not resolve, a button that wedged,
 * a form whose field list drifted from the host's. Those are wiring, and wiring
 * is testable without the app: `apply()` needs a context, and the control needs
 * React's hook contract, not a browser.
 *
 * The client checks below run the component under a small hook runtime, so the
 * form is actually opened, filled, previewed and submitted. A one-render smoke
 * test passed the white-button defect happily; a second render does not.
 *
 *   node eval/wiring.mjs
 *
 * Exit code 1 means a contract the plugin depends on is broken.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = new URL('./', import.meta.url)
const root = new URL('../', here)

// The run record must not land in the repository while a lab is running, and the
// presets must not change meaning when the repository's own file is edited.
const stateDir = mkdtempSync(join(tmpdir(), 'fq-state-'))
process.env.FEATURE_QUALITY_STATE_DIR = stateDir
const DEFAULTS = { OWNER: 'Preset Owner', FIRST_LOOK: '3 working days' }
const defaultsFile = join(mkdtempSync(join(tmpdir(), 'fq-defaults-')), 'defaults.json')
writeFileSync(defaultsFile, JSON.stringify(DEFAULTS), 'utf8')
process.env.FEATURE_QUALITY_DEFAULTS = defaultsFile

const plugin = await import(pathToFileURL(fileURLToPath(new URL('index.js', root))).href)
const stateModule = await import(pathToFileURL(fileURLToPath(new URL('lib/state.mjs', root))).href)
const template = readFileSync(new URL('prompt.md', root), 'utf8')

const SESSION = 'session-current'
const START = '/plugins/feature-quality/start'
const PREVIEW = '/plugins/feature-quality/preview'
const STATUS = '/plugins/feature-quality/status'
const DEFAULTS_ROUTE = '/plugins/feature-quality/defaults'
const GOOD_LINE = '/quality Badge | surface: page | job: scan routes | owner: Oli'

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}`)
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function assertEqual(actual, expected, message) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  assert(left === right, `${message}: got ${left}, expected ${right}`)
}

/** A response object that records what the handler wrote. */
function fakeResponse() {
  const response = { status: 0, headers: {}, body: '' }
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers ?? {} }
  response.end = (body) => { response.body = body ?? '' }
  return response
}

/** A request carrying a JSON body. */
function fakeRequest(payload) {
  const request = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)])
  request.method = 'POST'
  request.url = START
  request.headers = { 'content-type': 'application/json' }
  return request
}

/**
 * A Cordis-shaped context with the services this plugin touches. `execute`
 * mirrors the real command runtime: match the line, run the registered handler.
 */
function createWorld(overrides = {}) {
  const commands = new Map()
  const routes = new Map()
  const followed = []
  const created = []
  const prompted = []
  const promptedSignals = []
  const agents = new Map()
  const workspace = overrides.cwd ?? mkdtempSync(join(tmpdir(), 'fq-repo-'))

  const agent = {
    id: SESSION,
    session: { header: { cwd: workspace } },
    followup: async (message) => { followed.push(message) },
  }
  agents.set(SESSION, agent)

  const services = {
    connection: overrides.connection ?? { requestRejection: () => undefined },
    agents: { get: (id) => agents.get(id) },
    webServer: {
      register: (route) => {
        assert(!routes.has(route.path), `duplicate route ${route.path}`)
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    // Modelled on the real controller: `prompt(request, signal)` touches the
    // signal before anything else. A stub that accepted one argument hid a
    // missing-signal crash that shipped to the composer.
    sessionController: {
      create: async (request) => {
        created.push(request)
        return { sessionId: 'session-new' }
      },
      prompt: async (request, signal) => {
        signal.throwIfAborted()
        promptedSignals.push({ aborted: signal.aborted })
        prompted.push(request)
        return { accepted: true }
      },
    },
    commands: {
      register: (definition) => {
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
      execute: async (target, line, attachments, signal) => {
        // The real runtime reads `signal.aborted` before dispatch.
        if (signal.aborted) throw new Error('command aborted')
        const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
        if (match === null) return undefined
        const definition = commands.get(match[1])
        if (definition === undefined) return undefined
        const result = await definition.handler({
          commandId: 'cmd-test-1',
          agent: target,
          rawInput: line.slice(match[0].length),
          attachments: [],
          signal: new AbortController().signal,
        })
        return { commandId: 'cmd-test-1', result }
      },
    },
  }

  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get: (name) => services[name],
    inject: (deps, callback) => {
      if (deps.every((dep) => services[dep] !== undefined)) return callback(ctx)
      return undefined
    },
    commands: services.commands,
  }

  plugin.apply(ctx)
  return { ctx, commands, routes, agents, agent, followed, created, prompted, promptedSignals, workspace }
}

async function callRoute(world, path, payload) {
  const route = world.routes.get(path)
  assert(route !== undefined, `no route at ${path}`)
  const response = fakeResponse()
  await route.handler(fakeRequest(payload), response)
  const body = response.body === '' ? undefined : JSON.parse(response.body)
  return { status: response.status, body }
}

const expectedText = (line) => plugin.buildPrompt(
  template,
  plugin.canonicalise(plugin.applyDefaults(plugin.parseInvocation(line.replace(/^\/quality/u, '')).values, DEFAULTS).values),
)

console.log('wiring lab\n')
console.log('host half')

await check('registers /quality and /quality-status, and nothing else', () => {
  const world = createWorld()
  assertEqual([...world.commands.keys()].sort(), ['quality', 'quality-status'])
})

await check('registers the control, preview and status routes through ctx.inject', () => {
  const world = createWorld()
  for (const path of [START, PREVIEW, STATUS]) assert(world.routes.has(path), `no route at ${path}`)
})

await check('current-session POST delivers the built prompt and records the run', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, START, { sessionId: SESSION, line: GOOD_LINE })
  assertEqual(status, 200)
  assertEqual(body.ok, true)
  assertEqual(body.slug, 'badge')
  assertEqual(world.followed.length, 1)
  assertEqual(world.followed[0].content, [{ type: 'text', text: expectedText(GOOD_LINE) }])
  assertEqual(world.followed[0].role, 'user')
  assert(existsSync(join(stateDir, 'badge.json')), 'run record was not written')
  const record = JSON.parse(readFileSync(join(stateDir, 'badge.json'), 'utf8'))
  assertEqual(record.slug, 'badge')
  assertEqual(record.surface, 'page')
  assertEqual(record.supplied, 5)
  assert(Array.isArray(record.unfilled) && record.unfilled.length === 6, `unfilled: ${JSON.stringify(record.unfilled)}`)
  assertEqual(record.presets, ['FIRST LOOK'])
  assertEqual(record.cwd, world.workspace)
})

await check('new-session POST creates, prompts, records, and leaves the current session alone', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, START, { sessionId: SESSION, line: GOOD_LINE, mode: 'new' })
  assertEqual(status, 200)
  assertEqual(body.sessionId, 'session-new')
  assertEqual(body.slug, 'badge')
  assertEqual(world.created.length, 1)
  assertEqual(world.created[0].cwd, world.workspace)
  assertEqual(world.prompted.length, 1)
  assertEqual(world.promptedSignals.length, 1, 'prompt was admitted without a signal')
  assertEqual(world.promptedSignals[0].aborted, false)
  assertEqual(world.prompted[0].sessionId, 'session-new')
  assertEqual(world.prompted[0].mode, 'queue')
  assert(typeof world.prompted[0].requestId === 'string' && world.prompted[0].requestId.length > 0, 'requestId missing')
  assertEqual(world.prompted[0].content, [{ type: 'text', text: expectedText(GOOD_LINE) }])
  assertEqual(world.followed.length, 0)
  const record = JSON.parse(readFileSync(join(stateDir, 'badge.json'), 'utf8'))
  assertEqual(record.sessionId, 'session-new')
})

await check('refuses a line missing a required input, before either delivery path', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, START, { sessionId: SESSION, line: '/quality Badge | surface: page' })
  assertEqual(status, 400)
  // OWNER is a preset in this lab's defaults file, so it is satisfied; USER JOB
  // is the one nobody supplied.
  assert(body.error.includes('USER JOB'), `error does not name USER JOB: ${body.error}`)
  assert(!body.error.includes('OWNER'), `a preset OWNER was reported missing: ${body.error}`)
  assertEqual(world.followed.length, 0)
  assertEqual(world.created.length, 0)
})

await check('the presets route serves the file the host loaded', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, DEFAULTS_ROUTE, {})
  assertEqual(status, 200)
  assertEqual(body.ok, true)
  assertEqual(body.defaults, DEFAULTS)
  assertEqual(body.presets.sort(), ['FIRST_LOOK', 'OWNER'])
})

await check('a preset fills only what was not supplied', () => {
  const applied = plugin.applyDefaults({ OWNER: 'Oli' }, DEFAULTS)
  assertEqual(applied.values.OWNER, 'Oli', 'a preset overwrote a supplied value')
  assertEqual(applied.values.FIRST_LOOK, '3 working days')
  assertEqual(applied.presets, ['FIRST LOOK'])

  const none = plugin.applyDefaults({}, {})
  assertEqual(none.presets, [])
})

await check('defaults.json rejects unknown keys and blank values', () => {
  const parsed = plugin.parseDefaults(JSON.stringify({ OWNER: 'Oli', NOPE: 'x', FIRST_LOOK: '   ' }))
  assertEqual(parsed.values, { OWNER: 'Oli' })
  assert(parsed.warnings.some((warning) => warning.includes('NOPE')), `no warning for NOPE: ${JSON.stringify(parsed.warnings)}`)
  assert(parsed.warnings.some((warning) => warning.includes('FIRST_LOOK')), 'no warning for a blank value')
})

await check('refuses a URL in SURFACE, and points at CURRENT STATE', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, START, {
    sessionId: SESSION,
    line: '/quality Badge | surface: https://x.test/lifting | job: scan | owner: Oli',
  })
  assertEqual(status, 400)
  assert(body.error.includes('CURRENT STATE'), `error does not point at CURRENT STATE: ${body.error}`)
})

await check('preview returns the exact text, the slug and what is unfilled', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, PREVIEW, { line: GOOD_LINE })
  assertEqual(status, 200)
  assertEqual(body.ok, true)
  assertEqual(body.slug, 'badge')
  assertEqual(body.surface, 'page')
  assertEqual(body.unfilled.length, 6)
  assertEqual(body.presets, ['FIRST LOOK'])
  assert(!body.unfilled.includes('FIRST LOOK'), 'a preset was reported as unfilled')
  assertEqual(body.text, expectedText(GOOD_LINE))
  assert(body.blocked === undefined, `unexpected block: ${body.blocked}`)
})

await check('preview reports the block around the message, not instead of it', async () => {
  const world = createWorld()
  const { status, body } = await callRoute(world, PREVIEW, { line: '/quality Badge | surface: page' })
  assertEqual(status, 200)
  assert(typeof body.blocked === 'string' && body.blocked.includes('USER JOB'), 'blocked does not name USER JOB')
  assert(body.text.includes('UNFILLED:'), 'the message is missing its UNFILLED line')
})

await check('status scans the workspace and names the next deliverable', async () => {
  const world = createWorld()
  await callRoute(world, START, { sessionId: SESSION, line: GOOD_LINE })
  const empty = await callRoute(world, STATUS, { sessionId: SESSION })
  assertEqual(empty.status, 200)
  assertEqual(empty.body.found, true)
  assertEqual(empty.body.met, 0)
  assertEqual(empty.body.next.label, 'Contract')

  const plans = join(world.workspace, 'plans', 'quality', 'badge')
  mkdirSync(plans, { recursive: true })
  writeFileSync(join(plans, 'CONTRACT.md'), '# contract\n')
  writeFileSync(join(plans, 'DECISIONS.md'), '# decisions\n')
  const qa = join(world.workspace, 'prototype', 'badge', 'qa')
  mkdirSync(qa, { recursive: true })
  writeFileSync(join(qa, '01-frame.png'), Buffer.alloc(24))
  writeFileSync(join(qa, 'NOTES.txt'), 'not an artifact')

  const filled = await callRoute(world, STATUS, { sessionId: SESSION })
  assertEqual(filled.body.met, 4)
  const artifact = filled.body.deliverables.find((deliverable) => deliverable.key === 'artifact')
  assertEqual(artifact.count, 1, 'the artifact scan counted a non-artifact file')
  assertEqual(filled.body.next.label, 'Reference')
  assert(filled.body.run !== null && filled.body.run.slug === 'badge', 'status did not attach the run record')
})

await check('status rejects a slug that could escape the workspace', async () => {
  const world = createWorld()
  const { status } = await callRoute(world, STATUS, { sessionId: SESSION, slug: '../../etc' })
  assertEqual(status, 400)
})

await check('rejects an unauthenticated request before doing anything', async () => {
  const world = createWorld({ connection: { requestRejection: () => 401 } })
  const { status } = await callRoute(world, START, { sessionId: SESSION, line: GOOD_LINE })
  assertEqual(status, 401)
  assertEqual(world.followed.length, 0)
  const preview = await callRoute(world, PREVIEW, { line: GOOD_LINE })
  assertEqual(preview.status, 401)
})

await check('rejects an unknown session', async () => {
  const world = createWorld()
  const { status } = await callRoute(world, START, { sessionId: 'nope', line: GOOD_LINE })
  assertEqual(status, 409)
})

await check('rejects a line that is not this command', async () => {
  const world = createWorld()
  const { status } = await callRoute(world, START, { sessionId: SESSION, line: '/other do it' })
  assertEqual(status, 400)
})

await check('reports a command-handler failure as a readable error', async () => {
  const world = createWorld()
  world.agent.followup = async () => { throw new Error('boom') }
  const { body } = await callRoute(world, START, { sessionId: SESSION, line: GOOD_LINE })
  assertEqual(body.ok, false)
  assert(body.error.includes('boom'), `error not surfaced: ${body.error}`)
})

await check('/quality refuses the same gap as the route', async () => {
  const world = createWorld()
  const execution = await world.ctx.commands.execute(world.agent, '/quality Badge | surface: page', [], new AbortController().signal)
  assertEqual(execution.result.kind, 'error')
  assert(execution.result.text.includes('USER JOB'), 'the command refusal does not name USER JOB')
  assertEqual(world.followed.length, 0)
})

await check('/quality-status prints the scan for the workspace', async () => {
  const world = createWorld()
  const empty = await world.ctx.commands.execute(world.agent, '/quality-status', [], new AbortController().signal)
  assertEqual(empty.result.kind, 'success')
  assert(empty.result.text.includes('none recorded'), `unexpected: ${empty.result.text}`)

  await world.ctx.commands.execute(world.agent, GOOD_LINE, [], new AbortController().signal)
  const named = await world.ctx.commands.execute(world.agent, '/quality-status badge', [], new AbortController().signal)
  assertEqual(named.result.kind, 'success')
  assert(named.result.text.includes('Quality run: badge'), `unexpected: ${named.result.text}`)
  assert(named.result.text.includes('Next: Contract'), `next deliverable not named: ${named.result.text}`)
  assert(named.result.text.includes('not machine-checkable'), 'the P0 caveat is missing')
})

console.log('\nscan')

await check('a missing workspace is reported, not invented', () => {
  const scan = stateModule.scanRun(undefined, 'badge', undefined)
  assertEqual(scan.met, 0)
  assertEqual(scan.deliverables[0].detail, 'no working directory')
  assert(scan.note.includes('not machine-checkable'), 'the P0 caveat is missing')
})

await check('the slug is derived from the feature and bounded', () => {
  assertEqual(stateModule.slugify('Ride quality badge on the routes page'), 'ride-quality-badge-on-the-routes-page')
  assertEqual(stateModule.slugify('  Élite —  Sprint  '), 'elite-sprint')
  assertEqual(stateModule.slugify(''), 'feature')
  assert(stateModule.slugify('x'.repeat(200)).length <= 48, 'slug is not bounded')
})

await check('a run record written with a byte-order mark is still found', () => {
  // A BOM-prefixed JSON file parses as nothing and reports "no run recorded yet"
  // for a run that exists — discovered when a shell-written fixture carried one.
  const slug = 'bom-record'
  writeFileSync(join(stateDir, `${slug}.json`), `\ufeff${JSON.stringify({
    version: 1,
    slug,
    feature: 'BOM',
    surface: 'page',
    supplied: 4,
    unfilled: [],
    createdAt: '2026-11-06T00:00:00.000Z',
    cwd: 'C:/nonexistent',
  }, null, 2)}\n`, 'utf8')
  const record = stateModule.readRun(slug)
  assert(record !== undefined, 'the BOM-prefixed record was not read')
  assertEqual(record.slug, slug)
})

await check('the artifact scan is bounded and ignores non-artifacts', () => {
  const repo = mkdtempSync(join(tmpdir(), 'fq-repo-'))
  try {
    const qa = join(repo, 'prototype', 'badge', 'qa')
    mkdirSync(qa, { recursive: true })
    for (let index = 0; index < 30; index += 1) writeFileSync(join(qa, `frame-${index}.png`), Buffer.alloc(4))
    writeFileSync(join(qa, 'notes.txt'), 'x')
    const scan = stateModule.scanRun(repo, 'badge', undefined)
    const artifact = scan.deliverables.find((deliverable) => deliverable.key === 'artifact')
    assertEqual(artifact.count, 30, 'artifact count is wrong')
    assert(artifact.samples.length <= 5, 'samples are not bounded')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

// --- client half -------------------------------------------------------------
// The browser half was once checked by one render, and shipped a white, blank
// button. It is checked here under a hook runtime that supports state, effects
// and event handlers, so the form is opened, filled, previewed and submitted.

console.log('\nclient half')

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : undefined) },
    json: async () => payload,
  }
}

const statusPayload = {
  ok: true,
  found: true,
  slug: 'badge',
  met: 1,
  total: 7,
  deliverables: [{ key: 'contract', id: 'P1', label: 'Contract', path: 'plans/quality/badge/CONTRACT.md', exists: true, detail: '9 bytes' }],
  next: { id: 'P2', label: 'Lab', path: 'prototype/badge' },
  note: 'P0 (the diagnosis) has no file of its own and is not machine-checkable.',
}

function installStorage() {
  const map = new Map()
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  return map
}

function installFetch(overrides = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url: address, body, method: init.method })
    const responder = overrides[address]
    if (responder !== undefined) return responder(body, calls)
    if (address.endsWith('/defaults')) return jsonResponse({ ok: true, defaults: DEFAULTS, presets: Object.keys(DEFAULTS) })
    if (address.endsWith('/status')) return jsonResponse(statusPayload)
    if (address.endsWith('/preview')) {
      return jsonResponse({ ok: true, text: 'DELIVERED PREVIEW TEXT', slug: 'badge', supplied: 4, unfilled: ['REFERENCES'], missingRequired: [], surface: 'page' })
    }
    if (address.endsWith('/start')) {
      // The host returns the created session only on the new-session path.
      return jsonResponse({
        ok: true,
        ...(body?.mode === 'new' ? { sessionId: 'session-new' } : {}),
        text: 'Quality prompt submitted \u2014 4/11 inputs supplied \u00b7 run badge.',
        slug: 'badge',
        status: statusPayload,
      })
    }
    return jsonResponse({ error: 'not found' }, 404)
  }
  return calls
}

/**
 * A hook runtime with React's contract: state, refs, effects and re-render.
 * The component closes over the React object it was built with, so the factory
 * is handed this one and every render runs against the same slots.
 */
function createRuntime() {
  const states = []
  const refs = []
  const effects = []
  let cursor = 0
  let dirty = false
  let pending = []
  let tree
  let component
  let props = {}

  const react = {
    createElement: (type, elementProps, ...children) => ({
      type,
      props: elementProps ?? {},
      children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
    }),
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
        dirty = true
        // React re-renders on setState; the runtime does too, on the next tick,
        // so a check can await a request and read the tree without flushing.
        queueMicrotask(() => {
          if (dirty) flush()
        })
      }
      return [states[index], set]
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index]
    },
    useEffect(fn, deps) {
      const index = cursor
      cursor += 1
      const key = deps === undefined ? 'always' : JSON.stringify(deps)
      const record = effects[index]
      if (record === undefined || record.key !== key) {
        effects[index] = { key, fn, cleanup: record?.cleanup }
        pending.push(index)
      }
    },
  }

  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}))
    if (node.children === undefined) return node
    return { ...node, children: node.children.map(expand) }
  }

  function flush() {
    if (component === undefined) throw new Error('no component mounted')
    let guard = 0
    do {
      dirty = false
      cursor = 0
      pending = []
      tree = expand(component(props))
      for (const index of pending) {
        const record = effects[index]
        if (typeof record.cleanup === 'function') record.cleanup()
        const cleanup = record.fn()
        record.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
    } while (dirty && (guard += 1) < 25)
    return tree
  }

  function find(node, predicate) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    for (const child of node.children ?? []) {
      const found = find(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }

  function text(node) {
    if (node === null || node === undefined || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(text).join('')
    return (node.children ?? []).map(text).join('')
  }

  return {
    react,
    setComponent(next, nextProps) {
      component = next
      props = nextProps ?? {}
      dirty = true
    },
    mount() {
      dirty = true
      return flush()
    },
    flush,
    find,
    text,
    get tree() { return tree },
    unmount() {
      for (const record of effects) if (typeof record?.cleanup === 'function') record.cleanup()
    },
  }
}

let loaded

function mountControl(controlProps, options = {}) {
  const runtime = createRuntime()
  const opened = options.opened ?? []
  const client = loaded.factory((specifier) => {
    if (specifier === 'react') return runtime.react
    throw new Error(`unexpected require(${specifier})`)
  })
  const registered = []
  const pluginContext = {
    // Mirrors the app: `uiWorkspace` is a Cordis service the control may reach.
    get: (name) => (name === 'uiWorkspace'
      ? { openSession: (sessionId) => { opened.push(sessionId) } }
      : undefined),
    slots: {
      inject: (owner, create) => create(),
      register: (registration, component) => {
        registered.push({ options: registration, component })
        return () => {}
      },
    },
  }
  client.apply(pluginContext)
  assertEqual(registered.length, 1, 'the control did not register exactly one component')
  assertEqual(registered[0].options.name, 'conversation.input.dock', 'wrong slot')
  runtime.setComponent(registered[0].component, controlProps)
  runtime.opened = opened
  return runtime
}

function openControl(runtime) {
  runtime.mount()
  const trigger = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-trigger'] === true)
  assert(trigger !== undefined, 'no trigger')
  trigger.props.onClick()
  runtime.flush()
}

function setField(runtime, key, value) {
  const field = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === key)
  assert(field !== undefined, `no field ${key}`)
  field.props.onChange({ target: { value } })
  runtime.flush()
}

function fillRequired(runtime) {
  setField(runtime, 'FEATURE', 'Badge')
  setField(runtime, 'SURFACE', 'page')
  setField(runtime, 'USER_JOB', 'scan routes')
  setField(runtime, 'OWNER', 'Oli')
}

const settle = async (times = 5) => {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

globalThis.window = {
  __ModuleLoader__: { load: (definition) => { loaded = definition } },
  // The control listens for Escape and Ctrl/Cmd+Enter while it is open.
  addEventListener: () => {},
  removeEventListener: () => {},
}
await import(pathToFileURL(fileURLToPath(new URL('client.js', root))).href)

await check('loads under the module loader and registers into the composer dock', () => {
  assert(loaded !== undefined, 'client.js never called window.__ModuleLoader__.load')
  assertEqual(loaded.id, '@local/feature-quality')
  installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  const tree = runtime.mount()
  assertEqual(tree.type, 'div')
  assertEqual(tree.props['data-feature-quality'], 'collapsed')
})

await check('the client field list matches the host field list', () => {
  const source = readFileSync(new URL('client.js', root), 'utf8')
  const start = source.indexOf('const FIELDS = [')
  const end = source.indexOf('const TEXT =', start)
  assert(start !== -1 && end !== -1, 'could not locate the client FIELDS table')
  const entries = [...source.slice(start, end).matchAll(/\{\s*key: '([A-Z_]+)',\s*label: '([A-Z -]+)',\s*tier: '([a-z]+)'/gu)]
    .map((match) => ({ key: match[1], label: match[2], tier: match[3] }))
  const host = plugin.FIELDS.map((field) => ({ key: field.key, label: field.label, tier: field.tier }))
  assertEqual(entries, host, 'the two field lists have drifted')
})

await check('opens with the presets filled, marked, and the gap still named', async () => {
  installStorage()
  const calls = installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()

  assert(calls.some((call) => call.url.endsWith('/defaults')), 'the control never asked the host for presets')
  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  assert(submit !== undefined, 'no submit button')
  assertEqual(submit.props.disabled, true)
  assertEqual(runtime.text(submit), 'Fill 3 required')
  const meter = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-meter'] === true)
  assertEqual(runtime.text(meter), '1 of 4 required')
  const gap = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-gap'] === true)
  assert(gap !== undefined, 'the gap line is missing while three required inputs are empty')
  assert(runtime.text(gap).includes('FEATURE, SURFACE, USER JOB'), `gap reads: ${runtime.text(gap)}`)
  assert(!runtime.text(gap).includes('OWNER'), 'a preset OWNER was reported missing')
  const count = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-count'] === true)
  assertEqual(runtime.text(count), '2/11 filled')
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-message'] === true), undefined, 'the message is shown before it is asked for')

  const owner = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === 'OWNER')
  assertEqual(owner.props.value, 'Preset Owner')
  const badge = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'OWNER')
  assert(badge !== undefined, 'the preset OWNER is not marked')
  // FIRST LOOK lives behind the optional disclosure, so the mark is asserted there.
  runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-optional-toggle'] === true).props.onClick()
  runtime.flush()
  assert(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'FIRST_LOOK') !== undefined, 'the preset FIRST LOOK is not marked')
})

await check('clearing a preset returns the field to its placeholder', async () => {
  installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()

  const badge = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'OWNER')
  badge.props.onClick()
  runtime.flush()

  const owner = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === 'OWNER')
  assertEqual(owner.props.value, '')
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'OWNER'), undefined, 'the badge survived the clear')
  const meter = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-meter'] === true)
  assertEqual(runtime.text(meter), '0 of 4 required')
  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  assertEqual(runtime.text(submit), 'Fill 4 required')
})

await check('typing over a preset keeps the value and drops the mark', async () => {
  installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()

  setField(runtime, 'OWNER', 'Oli')
  const owner = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === 'OWNER')
  assertEqual(owner.props.value, 'Oli')
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'OWNER'), undefined, 'the badge survived typing')
  runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-optional-toggle'] === true).props.onClick()
  runtime.flush()
  assert(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'FIRST_LOOK') !== undefined, 'an untouched preset lost its mark')
})

await check('a draft wins over the presets', async () => {
  const storage = installStorage()
  storage.set('dsh.feature-quality.draft.v2', JSON.stringify({ values: { FEATURE: 'My brief' }, freshSession: true }))
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()

  const feature = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === 'FEATURE')
  assertEqual(feature.props.value, 'My brief')
  const owner = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === 'OWNER')
  assertEqual(owner.props.value, '', 'a preset overwrote a draft')
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-preset'] === 'OWNER'), undefined, 'a preset was marked over a draft')
})

await check('with no presets file the form is pristine', async () => {
  installStorage()
  installFetch({ [DEFAULTS_ROUTE]: () => jsonResponse({ ok: true, defaults: {}, presets: [] }) })
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()

  const meter = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-meter'] === true)
  assertEqual(runtime.text(meter), '0 of 4 required')
  const gap = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-gap'] === true)
  assert(runtime.text(gap).includes('Four inputs start it'), `gap reads: ${runtime.text(gap)}`)
  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  assertEqual(runtime.text(submit), 'Fill 4 required')
})

await check('the seven optional inputs start collapsed and open on demand', async () => {
  installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()

  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === 'CURRENT_STATE'), undefined, 'an optional field is visible while collapsed')
  const toggle = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-optional-toggle'] === true)
  assert(toggle !== undefined, 'no optional disclosure')
  assert(runtime.text(toggle).includes('7 optional inputs'), `toggle reads: ${runtime.text(toggle)}`)
  assert(runtime.text(toggle).includes('1 filled'), `toggle reads: ${runtime.text(toggle)}`)

  toggle.props.onClick()
  runtime.flush()
  for (const key of ['CURRENT_STATE', 'REAL_FIXTURE', 'REFERENCES', 'ANTI_REFERENCES', 'EXTERNAL_SOURCES', 'PRODUCTION_LIMITS', 'FIRST_LOOK']) {
    assert(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-field'] === key) !== undefined, `${key} did not appear`)
  }
})

await check('fills the required four: Start enables, the draft is kept', async () => {
  const storage = installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  await settle()
  fillRequired(runtime)

  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  assertEqual(submit.props.disabled, false)
  assertEqual(runtime.text(submit), 'Start prompt')
  const meter = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-meter'] === true)
  assertEqual(runtime.text(meter), '\u2713 4 of 4 required')
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-gap'] === true), undefined, 'the gap line survived a complete form')
  const count = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-count'] === true)
  assertEqual(runtime.text(count), '5/11 filled')
  assert(storage.has('dsh.feature-quality.draft.v2'), 'the draft was not persisted')
  const draft = JSON.parse(storage.get('dsh.feature-quality.draft.v2'))
  assertEqual(draft.values.OWNER, 'Oli')
})

await check('previews the exact message the host would submit, behind a toggle', async () => {
  installStorage()
  const calls = installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  fillRequired(runtime)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await settle()
  runtime.flush()

  const previewCalls = calls.filter((call) => call.url.endsWith('/preview'))
  assert(previewCalls.length >= 1, 'the preview route was never called')
  // The first call is the empty form on open; the last one carries the inputs.
  assert(previewCalls.some((call) => call.body.line.includes('FEATURE: Badge')), `preview lines: ${JSON.stringify(previewCalls.map((call) => call.body.line))}`)
  const summary = runtime.find(runtime.tree, (node) => {
    const text = runtime.text(node)
    return typeof node?.props?.style === 'object' && text.includes('What will be sent')
  })
  assert(summary !== undefined, 'no preview summary row')
  assert(runtime.text(summary).includes('badge'), `the summary does not name the run: ${runtime.text(summary)}`)
  assert(runtime.text(summary).includes('4/11'), `the summary does not count the inputs: ${runtime.text(summary)}`)
  assert(runtime.text(summary).includes('1 placeholder'), `the summary does not count the placeholders: ${runtime.text(summary)}`)

  const toggle = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-message-toggle'] === true)
  assert(toggle !== undefined, 'no message toggle')
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-message'] === true), undefined, 'the message is open before it is asked for')
  toggle.props.onClick()
  runtime.flush()
  const message = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-message'] === true)
  assert(message !== undefined, 'no preview message rendered')
  assertEqual(runtime.text(message), 'DELIVERED PREVIEW TEXT')
})

await check('submits the line, closes the panel and shows the receipt', async () => {
  const storage = installStorage()
  const calls = installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  fillRequired(runtime)

  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  await submit.props.onClick()
  await settle()
  runtime.flush()

  const startCall = calls.find((call) => call.url.endsWith('/start'))
  assert(startCall !== undefined, 'the start route was never called')
  assertEqual(startCall.body.mode, 'new')
  assert(startCall.body.line.startsWith('/quality FEATURE: Badge'), `line reads: ${startCall.body.line}`)
  assert(startCall.body.line.includes('SURFACE: page'), 'the surface is missing from the line')
  assertEqual(runtime.tree.props['data-feature-quality'], 'collapsed')
  assert(runtime.text(runtime.tree).includes('Opened a new session'), `receipt reads: ${runtime.text(runtime.tree)}`)
  assertEqual(runtime.opened, ['session-new'], 'the new session was never handed to the workspace')
  assert(!storage.has('dsh.feature-quality.draft.v2'), 'the draft was not cleared on submit')
})

await check('a current-session submit does not take over the main pane', async () => {
  installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  fillRequired(runtime)

  // Untick "New session": the prompt goes to the session the composer is in.
  const fresh = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-fresh'] === true)
  fresh.props.onChange({ target: { checked: false } })
  runtime.flush()

  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  await submit.props.onClick()
  await settle()
  runtime.flush()
  assertEqual(runtime.opened, [], 'a current-session submit opened another session')
})

await check('shows the run count once the host reports one', async () => {
  installStorage()
  installFetch()
  const runtime = mountControl({ sessionId: 'session-1' })
  runtime.mount()
  await settle()
  runtime.flush()
  const badge = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-run'] === true)
  assert(badge !== undefined, 'no run badge after a status response')
  assertEqual(runtime.text(badge), 'run 1/7')
})

await check('opens when no run has been recorded yet', async () => {
  // The live GUI hit this on a fresh profile: `/status` answers `found: false`
  // with no slug, the open panel read `slug.toUpperCase()`, and the dock entry
  // crashed out of the composer. A lab fixture that only ever supplies a run
  // cannot see it.
  installStorage()
  installFetch({ [STATUS]: () => jsonResponse({ ok: true, found: false, reason: 'no run recorded yet', cwd: null }) })
  const runtime = mountControl({ sessionId: 'session-1' })
  runtime.mount()
  await settle()
  runtime.flush()
  assertEqual(runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-run'] === true), undefined, 'a badge was drawn for a run that does not exist')
  openControl(runtime)
  await settle()
  assertEqual(runtime.tree.props['data-feature-quality'], 'open')
  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  assert(submit !== undefined, 'the panel did not render')
})

await check('a host refusal is shown, and the panel stays open', async () => {
  installStorage()
  installFetch({
    [START]: () => jsonResponse({ error: 'quality: OWNER is required before the prompt can start.' }, 400),
  })
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  fillRequired(runtime)
  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  await submit.props.onClick()
  await settle()
  runtime.flush()
  assertEqual(runtime.tree.props['data-feature-quality'], 'open')
  assert(runtime.text(runtime.tree).includes('OWNER is required'), 'the refusal is not shown')
})

await check('an HTML answer means the route did not register, and says so', async () => {
  installStorage()
  installFetch({
    [START]: () => ({
      ok: false,
      status: 405,
      headers: { get: () => 'text/html; charset=utf-8' },
      json: async () => ({}),
    }),
  })
  const runtime = mountControl({ sessionId: 'session-1' })
  openControl(runtime)
  fillRequired(runtime)
  const submit = runtime.find(runtime.tree, (node) => node?.props?.['data-feature-quality-submit'] === true)
  await submit.props.onClick()
  await settle()
  runtime.flush()
  assert(runtime.text(runtime.tree).includes('has not registered it'), `unexpected message: ${runtime.text(runtime.tree)}`)
})

console.log(`\n${failures === 0 ? 'wiring: pass' : `wiring: ${failures} failing`}`)
try {
  rmSync(stateDir, { recursive: true, force: true })
} catch {
  // A locked temp directory is not a test failure.
}
process.exit(failures === 0 ? 0 : 1)
