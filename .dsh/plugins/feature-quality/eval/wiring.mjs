/**
 * Wiring lab: the half `harness.mjs` cannot see.
 *
 * The text lab catches defects in the delivered prompt. Every defect that cost
 * this build its rounds lived elsewhere — a route that never registered, a 405
 * from the SPA fallback, an import that could not resolve, a button that wedged.
 * Those are wiring, and wiring is testable without the app: `apply()` needs a
 * context, not a browser.
 *
 *   node eval/wiring.mjs
 *
 * Exit code 1 means a contract the plugin depends on is broken.
 */
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = new URL('./', import.meta.url)
const root = new URL('../', here)
const plugin = await import(pathToFileURL(fileURLToPath(new URL('index.js', root))).href)
const template = readFileSync(new URL('prompt.md', root), 'utf8')

const ROUTE = '/plugins/feature-quality/start'
const SESSION = 'session-current'

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
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: got ${JSON.stringify(actual)}`)
}

/** A response object that records what the handler wrote. */
function fakeResponse() {
  const response = { status: 0, headers: {}, body: '' }
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers ?? {} }
  response.end = (body) => { response.body = body ?? '' }
  return response
}

/** A request carrying a JSON body. */
function fakeRequest(payload, url = ROUTE) {
  const request = Readable.from([JSON.stringify(payload ?? {})])
  request.method = 'POST'
  request.url = url
  request.headers = { 'content-type': 'application/json' }
  return request
}

/**
 * A Cordis-shaped context with the services this plugin touches. `execute` mirrors
 * the real command runtime: parse the line, run the registered handler.
 */
function createWorld(overrides = {}) {
  const commands = new Map()
  const routes = new Map()
  const followed = []
  const created = []
  const prompted = []
  const agents = new Map()

  const agent = {
    id: SESSION,
    session: { header: { cwd: 'C:/work' } },
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
    sessionController: {
      create: async (request) => {
        created.push(request)
        return { sessionId: 'session-new' }
      },
      prompt: async (request) => {
        prompted.push(request)
        return { accepted: true }
      },
    },
    commands: {
      register: (definition) => {
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
      execute: async (target, line) => {
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
  return { ctx, commands, routes, agents, agent, followed, created, prompted }
}

const expected = (input) => plugin.buildPrompt(template, plugin.parseInvocation(input).values)

console.log('wiring lab\n')

await check('registers exactly the /quality command', () => {
  const world = createWorld()
  assertEqual([...world.commands.keys()], ['quality'])
})

await check('registers the control route through ctx.inject', () => {
  const world = createWorld()
  assert(world.routes.has(ROUTE), `no route at ${ROUTE}`)
})

await check('current-session POST delivers the built prompt', async () => {
  const world = createWorld()
  const response = fakeResponse()
  await world.routes.get(ROUTE).handler(fakeRequest({ sessionId: SESSION, line: '/quality feature: Badge' }), response)
  assertEqual(response.status, 200)
  assertEqual(JSON.parse(response.body).ok, true)
  assertEqual(world.followed.length, 1)
  assertEqual(world.followed[0].content, [{ type: 'text', text: expected('feature: Badge') }])
  assertEqual(world.followed[0].role, 'user')
})

await check('new-session POST creates, then prompts, with the same text', async () => {
  const world = createWorld()
  const response = fakeResponse()
  await world.routes
    .get(ROUTE)
    .handler(fakeRequest({ sessionId: SESSION, line: '/quality feature: Badge', mode: 'new' }), response)
  assertEqual(response.status, 200)
  const body = JSON.parse(response.body)
  assertEqual(body.sessionId, 'session-new')
  assertEqual(world.created.length, 1)
  assertEqual(world.created[0].cwd, 'C:/work')
  assertEqual(world.prompted.length, 1)
  assertEqual(world.prompted[0].sessionId, 'session-new')
  assertEqual(world.prompted[0].mode, 'queue')
  assert(typeof world.prompted[0].requestId === 'string' && world.prompted[0].requestId.length > 0, 'requestId missing')
  assertEqual(world.prompted[0].content, [{ type: 'text', text: expected('feature: Badge') }])
  assertEqual(world.followed.length, 0, 'new session must not also deliver into the current one')
})

await check('rejects an unauthenticated request before doing anything', async () => {
  const world = createWorld({ connection: { requestRejection: () => 401 } })
  const response = fakeResponse()
  await world.routes.get(ROUTE).handler(fakeRequest({ sessionId: SESSION, line: '/quality feature: X' }), response)
  assertEqual(response.status, 401)
  assertEqual(world.followed.length, 0)
})

await check('rejects an unknown session', async () => {
  const world = createWorld()
  const response = fakeResponse()
  await world.routes.get(ROUTE).handler(fakeRequest({ sessionId: 'nope', line: '/quality feature: X' }), response)
  assertEqual(response.status, 409)
})

await check('rejects a line that is not this command', async () => {
  const world = createWorld()
  const response = fakeResponse()
  await world.routes.get(ROUTE).handler(fakeRequest({ sessionId: SESSION, line: '/other do it' }), response)
  assertEqual(response.status, 400)
})

await check('reports a command-handler failure as a readable error', async () => {
  const world = createWorld()
  world.agent.followup = async () => { throw new Error('boom') }
  const response = fakeResponse()
  await world.routes.get(ROUTE).handler(fakeRequest({ sessionId: SESSION, line: '/quality feature: X' }), response)
  const body = JSON.parse(response.body)
  assertEqual(body.ok, false)
  assert(body.error.includes('boom'), `error not surfaced: ${body.error}`)
})

// --- client half -------------------------------------------------------------
// The browser half was never executed by any check; the white, blank button was
// exactly the kind of defect that a single render would have caught.

console.log('\nclient half\n')

let loaded
globalThis.window = { __ModuleLoader__: { load: (definition) => { loaded = definition } } }
await import(pathToFileURL(fileURLToPath(new URL('client.js', root))).href)

await check('loads under the module loader and registers into the composer dock', () => {
  assert(loaded !== undefined, 'client.js never called window.__ModuleLoader__.load')
  assertEqual(loaded.id, '@local/feature-quality')
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: () => ({ current: undefined }),
    useEffect: () => {},
  }
  const client = loaded.factory((specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected require(${specifier})`)
  })
  assertEqual(client.inject, ['slots'])
  const registered = []
  client.apply({
    slots: {
      inject: (owner, create) => create(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  assertEqual(registered.length, 1)
  assertEqual(registered[0].options.name, 'conversation.input.dock')
  const tree = registered[0].component({ sessionId: 'session-1' })
  assertEqual(tree.type, 'div')
  assertEqual(tree.props['data-feature-quality'], 'collapsed')
})

console.log(`\n${failures === 0 ? 'wiring: pass' : `wiring: ${failures} failing`}`)
process.exit(failures === 0 ? 0 : 1)
