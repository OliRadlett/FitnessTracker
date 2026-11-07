/**
 * The delivery lab: one command that answers "is the delivered message the
 * asset, and does it say what is missing?"
 *
 * It does not test the plugin's intent. It renders the message the plugin would
 * submit for each fixture and compares it with `prompt.md`, line by line,
 * outside the Inputs block. Anything the plugin writes there is, by the
 * contract, a defect — the tool owns the Inputs values and nothing else.
 *
 * It also asserts the two properties that a green run must not be able to
 * fake: a CRLF template delivers the same text as an LF one, and an unfilled
 * input produces exactly one `UNFILLED:` line naming it.
 *
 *   node eval/harness.mjs
 *
 * Exit code 1 means the gate is not met.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeNewlines, splitInputsBlock } from '../lib/template.mjs'
import { DELIVERABLES } from '../lib/state.mjs'

const here = new URL('./', import.meta.url)
const root = new URL('../', here)
const module = await import(pathToFileURL(fileURLToPath(new URL('index.js', root))).href)
const template = readFileSync(new URL('prompt.md', root), 'utf8')
const fixtures = JSON.parse(readFileSync(new URL('fixtures.json', here), 'utf8'))

let failures = 0
function fail(message) {
  failures += 1
  console.error(`  FAIL  ${message}`)
}
function ok(message) {
  console.log(`  ok    ${message}`)
}

/** Longest-common-subsequence diff over lines; enough for a ~100-line document. */
function diffLines(left, right) {
  const a = left.split('\n')
  const b = right.split('\n')
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue }
    if (table[i + 1][j] >= table[i][j + 1]) out.push({ op: '-', line: a[i++] })
    else out.push({ op: '+', line: b[j++] })
  }
  while (i < a.length) out.push({ op: '-', line: a[i++] })
  while (j < b.length) out.push({ op: '+', line: b[j++] })
  return out
}

const templateParts = splitInputsBlock(template)
const templateLabels = new Set(templateParts.inputs.map((line) => line.slice(0, line.indexOf(':') + 1)))

console.log('delivery lab\n')

// --- the asset itself ---------------------------------------------------------
console.log('prompt.md')

{
  if (!templateParts.found) fail('prompt.md has no Inputs block')
  else ok(`Inputs block at line ${templateParts.openIndex + 1}, ${templateParts.inputs.length} lines`)

  if (normalizeNewlines(template) === template) ok('prompt.md is LF on disk')
  else fail('prompt.md is CRLF on disk — it is normalised at load, but the asset should be LF so every reader sees the same bytes')

  const tokens = [...template.matchAll(/\{\{([A-Z0-9_]+)\}\}/gu)].map((match) => match[1])
  const declared = module.FIELDS.map((field) => field.key)
  const missingTokens = declared.filter((key) => !tokens.includes(key))
  const strayTokens = tokens.filter((token) => !declared.includes(token))
  const duplicates = tokens.filter((token, index) => tokens.indexOf(token) !== index)
  if (missingTokens.length === 0) ok(`all ${declared.length} fields have a {{TOKEN}}`)
  else fail(`fields without a token: ${missingTokens.join(', ')}`)
  if (strayTokens.length === 0) ok('no token without a field')
  else fail(`tokens without a field: ${strayTokens.join(', ')}`)
  if (duplicates.length === 0) ok('each token appears once')
  else fail(`duplicate tokens: ${[...new Set(duplicates)].join(', ')}`)

  for (const deliverable of DELIVERABLES) {
    if (template.includes(deliverable.path)) ok(`prompt declares ${deliverable.path}`)
    else fail(`prompt does not declare the deliverable path ${deliverable.path}`)
  }

  // The prompt is the only channel every /quality session reads. If it stops
  // naming the tools, sessions silently hand-roll what the repo already ships.
  for (const route of ['tools/quality.mjs', 'tools/contact-sheet.mjs', 'templates/states.mjs']) {
    if (template.includes(route)) ok(`prompt names ${route}`)
    else fail(`prompt does not name ${route} — the tools become undiscoverable`)
  }
}

// --- delivery per fixture -----------------------------------------------------
console.log('\ndelivery')

const rows = []
for (const fixture of fixtures) {
  const before = failures
  const parsed = module.parseInvocation(fixture.input)
  if (parsed.error !== undefined) {
    fail(`${fixture.name}: parse error ${parsed.error}`)
    rows.push({ fixture: fixture.name, supplied: '—', outsideDelta: '—', inputsDelta: '—', verdict: 'FAIL' })
    continue
  }
  const built = module.buildPrompt(template, module.canonicalise(parsed.values))
  const parts = splitInputsBlock(built)
  const outside = diffLines(templateParts.outside, parts.outside)
  const addedInputs = parts.inputs.filter((line) => !templateLabels.has(line.slice(0, line.indexOf(':') + 1)))
  const supplied = Object.keys(parsed.values).length
  const unfilled = module.FIELDS.filter((field) => parsed.values[field.key] === undefined)
  const expectedMarker = unfilled.length === 0 ? 0 : 1

  if (outside.length === 0) ok(`${fixture.name}: nothing written outside the Inputs block`)
  else {
    fail(`${fixture.name}: ${outside.length} line(s) written outside the Inputs block`)
    for (const change of outside.slice(0, 8)) console.error(`        ${change.op} ${change.line.slice(0, 120)}`)
  }

  if (addedInputs.length !== expectedMarker) {
    fail(`${fixture.name}: expected ${expectedMarker} added input line(s), found ${addedInputs.length}`)
  } else if (expectedMarker === 1) {
    const marker = addedInputs[0]
    const named = marker.slice(marker.indexOf(':') + 1).split(',').map((part) => part.trim())
    const expectedNames = unfilled.map((field) => field.label)
    if (JSON.stringify(named) === JSON.stringify(expectedNames)) ok(`${fixture.name}: UNFILLED names exactly ${expectedNames.length} placeholder(s)`)
    else fail(`${fixture.name}: UNFILLED names ${JSON.stringify(named)}, expected ${JSON.stringify(expectedNames)}`)
  } else {
    ok(`${fixture.name}: every input supplied, no marker added`)
  }

  if (built.includes('\r')) fail(`${fixture.name}: delivered text contains a carriage return`)
  const leftover = built.match(/\{\{[A-Z0-9_]+\}\}/u)
  if (leftover === null) ok(`${fixture.name}: no {{TOKEN}} survives into the message`)
  else fail(`${fixture.name}: ${leftover[0]} survives into the message`)

  rows.push({
    fixture: fixture.name,
    supplied: `${supplied}/${module.FIELDS.length}`,
    outsideDelta: outside.length,
    inputsDelta: addedInputs.length,
    verdict: failures === before ? 'pass' : 'FAIL',
  })
}

// --- line endings cannot change the delivery ----------------------------------
console.log('\ncross-platform')

{
  const values = module.parseInvocation(
    'feature: Line endings | surface: page | job: same text | owner: Oli | refs: https://a.test',
  ).values
  const lf = module.buildPrompt(normalizeNewlines(template), values)
  const crlf = module.buildPrompt(normalizeNewlines(template).replace(/\n/gu, '\r\n'), values)
  const mixed = module.buildPrompt(
    normalizeNewlines(template).replace(/\n/gu, '\r\n').replace('Role\r\n', 'Role\r'),
    values,
  )
  if (crlf === lf) ok('a CRLF template delivers byte-identical text')
  else fail('a CRLF template changes the delivered text')
  if (mixed === lf) ok('a mixed CRLF/CR template delivers byte-identical text')
  else fail('a mixed CRLF/CR template changes the delivered text')
  if (module.buildPrompt(normalizeNewlines(template), { ...values, OWNER: undefined }).includes('UNFILLED:')) {
    ok('the UNFILLED marker survives a CRLF template')
  } else {
    fail('the UNFILLED marker is lost on a CRLF template — this is the Windows/autocrlf defect')
  }
}

// --- the rules the two entry points share -------------------------------------
console.log('\ncontract')

{
  const empty = module.validateValues({})
  if (empty.missingRequired.length === 4) ok('an empty form reports four required fields')
  else fail(`an empty form reports ${empty.missingRequired.length} required fields: ${empty.missingRequired.join(', ')}`)

  const surface = module.parseSurface('UI + api')
  if (surface.ok && surface.value === 'page + API') ok('SURFACE aliases canonicalise (UI + api → page + API)')
  else fail(`SURFACE aliases did not canonicalise: ${JSON.stringify(surface)}`)

  const url = module.parseSurface('https://oliradlett.co.uk/fittrack/lifting')
  if (!url.ok && url.reason.includes('CURRENT STATE')) ok('a URL in SURFACE is refused, and points at CURRENT STATE')
  else fail(`a URL in SURFACE was not refused with a useful reason: ${JSON.stringify(url)}`)

  const typo = module.parseInvocation('feature: X | surfce: page | owner: me')
  if (typo.warnings.some((warning) => warning.includes('SURFACE'))) ok('a near-miss field name is named in a warning')
  else fail('a near-miss field name was silently treated as prose')

  const preview = module.previewLine(template, '/quality feature: Badge | surface: https://x.test | job: scan | owner: Oli')
  if (preview.ok && typeof preview.blocked === 'string' && preview.blocked.includes('SURFACE')) {
    ok('the preview blocks a bad surface even when every required field is present')
  } else {
    fail('the preview did not block a bad surface')
  }

  // The repository's own presets: every key must be a field, or `parseDefaults`
  // warns and the file silently shrinks (a label key like "FIRST LOOK" did this).
  const defaultsText = readFileSync(new URL('../defaults.json', here), 'utf8')
  const defaults = module.parseDefaults(defaultsText)
  const fieldKeys = new Set(module.FIELDS.map((field) => field.key))
  const unknown = Object.keys(defaults.values).filter((key) => !fieldKeys.has(key))
  if (defaults.warnings.length === 0 && unknown.length === 0) {
    ok(`defaults.json is clean (${Object.keys(defaults.values).length} presets, all field keys)`)
  } else {
    fail(`defaults.json: ${[...defaults.warnings, ...unknown.map((key) => `${key} is not a field`)].join('; ')}`)
  }
  const presetLine = module.buildPrompt(template, module.applyDefaults({}, defaults.values).values)
  if (presetLine.includes('OWNER:            ') && !presetLine.includes('[one person or agent accountable')) {
    ok('a preset replaces its placeholder in the delivered text')
  } else {
    fail('a preset did not replace its placeholder')
  }
}

console.log('\nfixture       supplied  outsideΔ  inputsΔ  verdict')
for (const row of rows) {
  console.log(`${row.fixture.padEnd(13)} ${row.supplied.padEnd(9)} ${String(row.outsideDelta).padEnd(9)} ${String(row.inputsDelta).padEnd(8)} ${row.verdict}`)
}
console.log(`\ngate: ${failures === 0 ? 'met' : `NOT met (${failures} failure${failures === 1 ? '' : 's'})`}`)
process.exit(failures === 0 ? 0 : 1)
