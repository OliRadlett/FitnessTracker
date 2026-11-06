#!/usr/bin/env node
/**
 * The quality run's command line: scaffold it, gate it, read it.
 *
 *   node .dsh/plugins/feature-quality/tools/quality.mjs new "Route quality badge" --surface page --owner Oli
 *   node .dsh/plugins/feature-quality/tools/quality.mjs check [slug] [--cwd DIR] [--json]
 *   node .dsh/plugins/feature-quality/tools/quality.mjs status [slug] [--cwd DIR] [--json]
 *
 * `new` writes the deliverable paths the prompt names, so a run starts in the
 * right shape instead of inventing one. `check` is the mechanical part of the
 * gate: the contract's eight fields filled, the reference and decisions written,
 * and at least one artifact rendered. It exits 1 when the run cannot claim that.
 *
 * This is a wrapper over `lib/state.mjs`, not a second definition of the layout:
 * the paths, the slug and the artifact scan come from the same module the
 * `/quality-status` command uses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  describeRun,
  isValidSlug,
  readRun,
  resolveRun,
  scanRun,
  slugify,
} from '../lib/state.mjs'

/** The eight fields of the prompt's Phase 1 contract block. */
export const CONTRACT_FIELDS = [
  'ARTIFACT',
  'REFERENCE',
  'GATE',
  'NON-GOALS',
  'GOLDEN FIXTURE',
  'FIRST LOOK',
  'KILL CRITERION',
  'OWNER',
]

const TEMPLATES = new URL('../templates/', import.meta.url)

function usage(message) {
  if (message !== undefined) console.error(`quality: ${message}`)
  console.error([
    'usage:',
    '  quality.mjs new <feature> [--surface page] [--job "..."] [--owner "Oli"] [--cwd DIR] [--force]',
    '  quality.mjs check [slug] [--cwd DIR] [--json]',
    '  quality.mjs status [slug] [--cwd DIR] [--json]',
  ].join('\n'))
  process.exit(2)
}

function parse(argv) {
  const flags = { cwd: process.cwd(), force: false, json: false, surface: 'page', job: undefined, owner: undefined, words: [], slug: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--cwd') { flags.cwd = resolve(argv[index += 1] ?? '.'); continue }
    if (argument === '--surface') { flags.surface = argv[index += 1] ?? flags.surface; continue }
    if (argument === '--job') { flags.job = argv[index += 1]; continue }
    if (argument === '--owner') { flags.owner = argv[index += 1]; continue }
    if (argument === '--force') { flags.force = true; continue }
    if (argument === '--json') { flags.json = true; continue }
    if (argument === '--help' || argument === '-h') usage()
    if (argument.startsWith('-')) usage(`unknown flag ${argument}`)
    flags.words.push(argument)
  }
  return flags
}

function readTemplate(name) {
  return readFileSync(new URL(name, TEMPLATES), 'utf8')
}

function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/gu, (whole, key) => values[key] ?? whole)
}

/** Write a file, creating parents; refuse an existing file unless forced. */
function writeFile(path, content, force) {
  if (existsSync(path) && !force) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return true
}

/** The eight contract fields, and whether each is filled. */
export function readContract(text) {
  const found = {}
  for (const line of String(text ?? '').split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z -]{2,24}):\s*(.*)$/u.exec(line.trim())
    if (match === null) continue
    const key = match[1].trim().toUpperCase()
    if (!CONTRACT_FIELDS.includes(key)) continue
    found[key] = match[2].trim()
  }
  const missing = CONTRACT_FIELDS.filter((field) => found[field] === undefined)
  const placeholders = CONTRACT_FIELDS.filter((field) => {
    const value = found[field]
    return value !== undefined && (value === '' || /^\[.*\]$/u.test(value))
  })
  return { found, missing, placeholders }
}

function commandNew(flags) {
  const feature = flags.words.join(' ').trim()
  if (feature === '') usage('new needs a feature name')
  const slug = slugify(feature)
  const contractPath = join(flags.cwd, 'plans', 'quality', slug, 'CONTRACT.md')
  const labPath = join(flags.cwd, 'prototype', slug)
  const already = existsSync(contractPath) || existsSync(labPath)
  if (already && !flags.force) {
    console.error(`quality: ${slug} already has ${existsSync(contractPath) ? 'a contract' : 'a lab'}; use --force to rewrite.`)
    process.exit(1)
  }
  const date = new Date().toISOString().slice(0, 10)
  const values = {
    FEATURE: feature,
    SLUG: slug,
    SURFACE: flags.surface,
    JOB: flags.job ?? '[what the user is trying to get done]',
    OWNER: flags.owner ?? '[one person or agent accountable for the artifact]',
    DATE: date,
  }
  const created = []
  for (const [template, target] of [
    ['CONTRACT.md', contractPath],
    ['REFERENCE.md', join(flags.cwd, 'plans', 'quality', slug, 'REFERENCE.md')],
    ['DECISIONS.md', join(flags.cwd, 'plans', 'quality', slug, 'DECISIONS.md')],
    ['states.mjs', join(labPath, 'qa', 'states.mjs')],
  ]) {
    if (writeFile(target, fill(readTemplate(template), values), flags.force)) created.push(target)
  }
  console.log(`quality: ${created.length === 0 ? 'nothing written (all files exist)' : `wrote ${created.length} file(s)`} for run ${slug}`)
  for (const path of created) console.log(`  ${path}`)
  console.log('')
  console.log(`next: fill ${join('plans', 'quality', slug, 'CONTRACT.md')}, then run Phase 0.`)
  console.log(`gate: node .dsh/plugins/feature-quality/tools/quality.mjs check ${slug}`)
}

function commandCheck(flags) {
  const slug = flags.words[0]
  if (slug !== undefined && !isValidSlug(slug)) usage(`"${slug}" is not a slug`)
  // A named slug is checked from the filesystem, so the gate works before the run
  // has been submitted and recorded. Without a name, the newest recorded run is
  // the only thing that could be meant.
  const state = slug === undefined
    ? resolveRun({ cwd: flags.cwd })
    : { found: true, ...scanRun(flags.cwd, slug, readRun(slug)) }
  if (state.found === false) {
    if (flags.json) console.log(JSON.stringify({ ok: false, reason: state.reason, cwd: state.cwd }, null, 2))
    else console.error(`quality: no run recorded for ${flags.cwd}. Start one with quality.mjs new, or name a slug.`)
    process.exit(1)
  }

  const contractPath = join(flags.cwd, 'plans', 'quality', state.slug, 'CONTRACT.md')
  const contract = existsSync(contractPath)
    ? readContract(readFileSync(contractPath, 'utf8'))
    : { found: {}, missing: [...CONTRACT_FIELDS], placeholders: [] }

  // PRODUCTION.md is Phase 6 and exists only if the run passes, so it is reported
  // but not gated: a gate that is red until the end is a gate nobody reads.
  const GATE_KEYS = new Set(['contract', 'lab', 'artifact', 'decisions', 'reference', 'firstLook'])
  const missingDeliverables = state.deliverables
    .filter((deliverable) => GATE_KEYS.has(deliverable.key) && deliverable.exists === false)
    .map((deliverable) => ({ key: deliverable.key, label: deliverable.label, path: deliverable.path }))

  const artifact = state.deliverables.find((entry) => entry.key === 'artifact')
  const problems = []
  if (contract.missing.length > 0) problems.push(`contract is missing ${contract.missing.join(', ')}`)
  if (contract.placeholders.length > 0) problems.push(`contract still has placeholders: ${contract.placeholders.join(', ')}`)
  if (missingDeliverables.length > 0) problems.push(`missing ${missingDeliverables.map((entry) => entry.label).join(', ')}`)
  if (artifact !== undefined && artifact.exists === false) problems.push('no artifact rendered in prototype/<slug>/qa')

  const ok = problems.length === 0
  if (flags.json) {
    console.log(JSON.stringify({
      ok,
      slug: state.slug,
      cwd: state.cwd,
      met: state.met,
      total: state.total,
      contract: { missing: contract.missing, placeholders: contract.placeholders },
      missingDeliverables,
      problems,
    }, null, 2))
  } else {
    console.log(`Quality gate — ${state.slug}: ${ok ? 'met' : 'NOT met'}`)
    console.log(`  contract   ${contract.missing.length === 0 && contract.placeholders.length === 0 ? 'filled' : `${contract.missing.length} missing, ${contract.placeholders.length} placeholder(s)`}`)
    for (const deliverable of state.deliverables) {
      console.log(`  ${deliverable.exists ? '\u2713' : '\u00b7'} ${deliverable.label.padEnd(16)} ${deliverable.path}`)
    }
    if (!ok) {
      console.log('')
      for (const problem of problems) console.log(`  ${problem}`)
    }
  }
  process.exit(ok ? 0 : 1)
}

function commandStatus(flags) {
  const slug = flags.words[0]
  if (slug !== undefined && !isValidSlug(slug)) usage(`"${slug}" is not a slug`)
  const state = resolveRun({ cwd: flags.cwd, slug })
  if (flags.json) {
    console.log(JSON.stringify({ found: state.found, ...state }, null, 2))
    process.exit(state.found === false ? 1 : 0)
  }
  console.log(describeRun(state))
  process.exit(state.found === false ? 1 : 0)
}

const [command, ...rest] = process.argv.slice(2)
const flags = parse(rest)
if (command === 'new') commandNew(flags)
else if (command === 'check') commandCheck(flags)
else if (command === 'status') commandStatus(flags)
else usage(command === undefined ? 'no command' : `unknown command ${command}`)
