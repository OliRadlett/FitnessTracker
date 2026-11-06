/**
 * The lab: one command that answers "is the delivered message the asset?"
 *
 * It does not test the plugin's intent. It renders the message the plugin would
 * submit for each fixture and compares it with `prompt.md`, line by line,
 * outside the Inputs block. Anything the plugin writes there is, by the contract,
 * a defect — the tool owns the Inputs values and nothing else.
 *
 *   node eval/harness.mjs
 *
 * Exit code 1 means the gate is not met.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = new URL('./', import.meta.url)
const root = new URL('../', here)
const module = await import(pathToFileURL(fileURLToPath(new URL('index.js', root))).href)
const template = readFileSync(new URL('prompt.md', root), 'utf8')
const fixtures = JSON.parse(readFileSync(new URL('fixtures.json', here), 'utf8'))

const OPEN = 'Inputs\n```\n'

/** Split a message into the text outside the Inputs block and the block's lines. */
function splitInputs(text) {
  const start = text.indexOf(OPEN)
  if (start === -1) return { outside: text, inputs: [] }
  const bodyStart = start + OPEN.length
  const close = text.indexOf('```', bodyStart)
  if (close === -1) return { outside: text, inputs: [] }
  return {
    outside: `${text.slice(0, start)}${text.slice(close)}`,
    inputs: text.slice(bodyStart, close).split('\n').filter((line) => line !== ''),
  }
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

const templateParts = splitInputs(template)
const templateInputs = new Set(templateParts.inputs.map((line) => line.slice(0, line.indexOf(':') + 1)))

let failures = 0
const rows = []

for (const fixture of fixtures) {
  const parsed = module.parseInvocation(fixture.input)
  if (parsed.error !== undefined) {
    console.error(`${fixture.name}: parse error ${parsed.error}`)
    failures += 1
    continue
  }
  const built = module.buildPrompt(template, parsed.values)
  const parts = splitInputs(built)
  const outside = diffLines(templateParts.outside, parts.outside)
  const addedInputs = parts.inputs.filter((line) => !templateInputs.has(line.slice(0, line.indexOf(':') + 1)))
  const supplied = Object.values(parsed.values).filter((value) => value !== undefined).length
  const missing = 11 - supplied

  const outsideOk = outside.length === 0
  // The block may carry exactly one added line: the placeholder marker.
  const inputsOk = addedInputs.every((line) => line.startsWith('UNFILLED:'))
  const markerOk = missing === 0 ? addedInputs.length === 0 : addedInputs.length === 1
  const ok = outsideOk && inputsOk && markerOk
  if (!ok) failures += 1

  rows.push({
    fixture: fixture.name,
    supplied: `${supplied}/11`,
    outsideDelta: outside.length,
    inputsDelta: addedInputs.length,
    verdict: ok ? 'pass' : 'FAIL',
  })

  if (!ok) {
    console.error(`\n${fixture.name}: ${outside.length} line(s) written outside the Inputs block`)
    for (const change of outside.slice(0, 12)) console.error(`  ${change.op} ${change.line.slice(0, 120)}`)
    if (!inputsOk) console.error(`  unexpected added input line(s): ${JSON.stringify(addedInputs)}`)
    if (!markerOk) console.error(`  expected ${missing === 0 ? 'no' : 'one'} placeholder marker, found ${addedInputs.length}`)
  } else if (addedInputs.length === 1) {
    console.log(`${fixture.name}: ${addedInputs[0]}`)
  }
}

console.log('\nfixture       supplied  outsideΔ  inputsΔ  verdict')
for (const row of rows) {
  console.log(`${row.fixture.padEnd(13)} ${row.supplied.padEnd(9)} ${String(row.outsideDelta).padEnd(9)} ${String(row.inputsDelta).padEnd(8)} ${row.verdict}`)
}
console.log(`\ngate: ${failures === 0 ? 'met' : `NOT met (${failures} fixture${failures === 1 ? '' : 's'})`}`)
process.exit(failures === 0 ? 0 : 1)
