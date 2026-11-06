/**
 * The tools lab: `quality.mjs` and `contact-sheet.mjs`.
 *
 * The plugin's commands and its CLI must agree about where a run lives, so the
 * checks below compare the two rather than trusting a second literal. The rest is
 * the gate's own behaviour: `new` scaffolds, `check` refuses a half-written
 * contract, and a completed run passes.
 *
 *   node eval/tools.mjs
 *
 * Exit code 1 means a tool regressed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DELIVERABLES } from '../lib/state.mjs'

const here = new URL('./', import.meta.url)
const root = new URL('../', here)
const tools = fileURLToPath(new URL('tools/', root))
const QUALITY = join(tools, 'quality.mjs')
const SHEET = join(tools, 'contact-sheet.mjs')

let failures = 0
function check(name, fn) {
  try {
    fn()
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
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

/** Run a tool, returning status plus stdout/stderr without throwing. */
function run(script, args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

const workspace = mkdtempSync(join(tmpdir(), 'fq-tools-'))
const slug = 'route-quality-badge'
const plans = join(workspace, 'plans', 'quality', slug)
const lab = join(workspace, 'prototype', slug)

console.log('tools lab\n')

check('new scaffolds the deliverable paths the prompt names', () => {
  const result = run(QUALITY, ['new', 'Route quality badge', '--surface', 'page', '--owner', 'Oli', '--job', 'decide which ride to repeat', '--cwd', workspace])
  assertEqual(result.status, 0, 'new failed')
  for (const path of [
    join(plans, 'CONTRACT.md'),
    join(plans, 'REFERENCE.md'),
    join(plans, 'DECISIONS.md'),
    join(lab, 'qa', 'states.mjs'),
  ]) assert(existsSync(path), `${path} was not written`)
  const contract = readFileSync(join(plans, 'CONTRACT.md'), 'utf8')
  assert(contract.includes('slug: route-quality-badge'), 'the slug was not substituted')
  assert(contract.includes('OWNER:           Oli'), 'the owner was not substituted')
  assert(contract.includes('ARTIFACT:        [one sentence'), 'the contract template lost its placeholders')
})

check('new refuses to overwrite a run without --force', () => {
  const result = run(QUALITY, ['new', 'Route quality badge', '--cwd', workspace])
  assertEqual(result.status, 1, 'new overwrote an existing run')
  assert(result.stderr.includes('use --force'), `stderr reads: ${result.stderr}`)
  const forced = run(QUALITY, ['new', 'Route quality badge', '--cwd', workspace, '--force'])
  assertEqual(forced.status, 0, 'new --force failed')
})

check('check refuses the scaffold: seven placeholders, no artifact, no first look', () => {
  const result = run(QUALITY, ['check', slug, '--cwd', workspace])
  assertEqual(result.status, 1, 'the scaffold passed the gate')
  for (const field of ['ARTIFACT', 'GATE', 'KILL CRITERION']) {
    assert(result.stdout.includes(field), `the gate does not name ${field}: ${result.stdout}`)
  }
  assert(result.stdout.includes('First look'), 'the gate does not report the missing first look')
})

check('check passes a completed run, and production is not a gate', () => {
  writeFileSync(join(plans, 'CONTRACT.md'), [
    'ARTIFACT:        A route badge on the routes page',
    'REFERENCE:       reference/01-strava.png — the scanned row',
    'GATE:            legible at 320px and in dark mode',
    'NON-GOALS:       no badge on the map',
    'GOLDEN FIXTURE:  routes/2026-10-18',
    'FIRST LOOK:      5 working days',
    'KILL CRITERION:  needs two lines at 320px',
    'OWNER:           Oli',
  ].join('\n'), 'utf8')
  writeFileSync(join(plans, 'FIRST-LOOK.md'), '# First look\n', 'utf8')
  writeFileSync(join(lab, 'qa', '01-frame.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const result = run(QUALITY, ['check', slug, '--cwd', workspace, '--json'])
  assertEqual(result.status, 0, `the completed run failed: ${result.stdout}${result.stderr}`)
  const body = JSON.parse(result.stdout)
  assertEqual(body.ok, true)
  assertEqual(body.contract.placeholders, [])
  assert(body.missingDeliverables.length === 0, `unexpected missing: ${JSON.stringify(body.missingDeliverables)}`)
  assert(result.stdout.includes('production') === false, 'the JSON should describe the gate, not the file list')
})

check('the CLI and the plugin scan agree on every deliverable path', () => {
  const result = run(QUALITY, ['status', slug, '--cwd', workspace, '--json'])
  assertEqual(result.status, 0, `status failed: ${result.stderr}`)
  const body = JSON.parse(result.stdout)
  const paths = body.deliverables.map((entry) => entry.path)
  assertEqual(paths, DELIVERABLES.map((entry) => entry.path.replace('<slug>', slug)), 'the CLI reports paths the plugin does not know')
})

check('check rejects a slug that cannot exist', () => {
  const result = run(QUALITY, ['check', '../escape', '--cwd', workspace])
  assertEqual(result.status, 2, 'an invalid slug was not a usage error')
})

check('contact-sheet builds one labelled page from images', () => {
  const shots = join(workspace, 'shots')
  mkdirSync(shots, { recursive: true })
  const one = join(shots, '01.png')
  const two = join(shots, '02.png')
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(one, pixel)
  writeFileSync(two, pixel)
  const out = join(workspace, 'sheet.png')
  const result = run(SHEET, ['--out', out, '--title', 'Two frames', '--label', 'first', '--label', 'second', one, two])
  if (result.status !== 0 && /no browser could start|Playwright is not installed/iu.test(result.stderr)) {
    console.log('        (skipped: no browser available)')
    return
  }
  assertEqual(result.status, 0, `contact-sheet failed: ${result.stderr}`)
  assert(existsSync(out), 'no sheet was written')
  const bytes = readFileSync(out)
  assert(bytes.subarray(1, 4).toString('latin1') === 'PNG', 'the sheet is not a PNG')
  // Two 660px tiles plus gaps and padding: wider than a single tile at minimum.
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assert(width > 1200 && height > 200, `sheet is ${width}×${height}`)
  assert(existsSync(`${out}.html`), 'the sheet html was not kept for inspection')
})

try {
  rmSync(workspace, { recursive: true, force: true })
} catch {
  // A locked temp directory is not a test failure.
}
console.log(`\n${failures === 0 ? 'tools: pass' : `tools: ${failures} failing`}`)
process.exit(failures === 0 ? 0 : 1)
