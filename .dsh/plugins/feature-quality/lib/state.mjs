/**
 * Run bookkeeping and the evidence scan behind `/quality-status`.
 *
 * The prompt names its deliverables by path (see "Deliverables and paths" in
 * `prompt.md`). This module answers one question about a run — *which of those
 * files exist* — and deliberately refuses to answer any other. There is no
 * phase counter that advances on its own: a tick here means a file was found,
 * and P0 (the diagnosis) is reported as not machine-checkable rather than
 * inferred from an empty directory. A panel that invents progress is the exact
 * failure the prompt forbids ("hiding placeholders"), and it would be worse in
 * the tracker than in the artifact.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = new URL('../', import.meta.url)
/**
 * Visible next to the plugin, not inside a profile: the run record is what
 * `/quality-status` reports, and a reader can open it. `FEATURE_QUALITY_STATE_DIR`
 * exists so the wiring lab writes to a temporary directory instead of the
 * repository.
 */
export const STATE_DIR = process.env.FEATURE_QUALITY_STATE_DIR !== undefined
  ? process.env.FEATURE_QUALITY_STATE_DIR
  : fileURLToPath(new URL('./.state/runs/', PLUGIN_ROOT))
const STATE_VERSION = 1
const MAX_SLUG_LENGTH = 48
const MAX_SCAN_ENTRIES = 400
const ARTIFACT_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg',
  'mp4', 'webm', 'mov',
  'csv', 'tsv', 'json', 'html',
])

/** kebab-case, ASCII, at most five-ish words — the slug the prompt names. */
export function slugify(feature) {
  const slug = String(feature ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/u, '')
  return slug === '' ? 'feature' : slug
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/u.test(slug)
}

/**
 * The deliverables, in phase order. `id` is the phase the file proves; `kind`
 * decides how the scan decides it exists.
 */
export const DELIVERABLES = [
  { id: 'P1', key: 'contract', label: 'Contract', kind: 'file', path: 'plans/quality/<slug>/CONTRACT.md' },
  { id: 'P2', key: 'lab', label: 'Lab', kind: 'dir', path: 'prototype/<slug>' },
  { id: 'P4', key: 'artifact', label: 'Artifact', kind: 'artifact', path: 'prototype/<slug>/qa' },
  { id: 'P4', key: 'decisions', label: 'Decisions', kind: 'file', path: 'plans/quality/<slug>/DECISIONS.md' },
  { id: 'P4', key: 'reference', label: 'Reference', kind: 'file', path: 'plans/quality/<slug>/REFERENCE.md' },
  { id: 'P5', key: 'firstLook', label: 'First look', kind: 'file', path: 'plans/quality/<slug>/FIRST-LOOK.md' },
  { id: 'P6', key: 'production', label: 'Production plan', kind: 'file', path: 'plans/quality/<slug>/PRODUCTION.md' },
]

function fill(template, slug) {
  return template.replace('<slug>', slug)
}

function runFile(slug) {
  return join(STATE_DIR, `${slug}.json`)
}

/**
 * Persist what was submitted, so `/quality-status` can report the brief as well
 * as the evidence. Best-effort: a read-only profile must not fail a submission.
 *
 * @returns the record, or `undefined` when it could not be written.
 */
export function writeRun(record) {
  if (!isValidSlug(record?.slug)) return undefined
  const payload = { version: STATE_VERSION, ...record, slug: record.slug }
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(runFile(record.slug), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return payload
  } catch {
    return undefined
  }
}

export function readRun(slug) {
  if (!isValidSlug(slug)) return undefined
  try {
    const raw = readFileSync(runFile(slug), 'utf8')
    // A byte-order mark is not JSON: a record written by a tool that adds one
    // would otherwise report "no run recorded yet" for a run that exists.
    const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
    return parsed?.version === STATE_VERSION ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Newest run for a working directory, used when the caller names no slug. */
export function latestRunFor(cwd) {
  let names
  try {
    names = readdirSync(STATE_DIR).filter((name) => name.endsWith('.json'))
  } catch {
    return undefined
  }
  const target = typeof cwd === 'string' ? cwd.replace(/\\/gu, '/').toLowerCase() : undefined
  let newest
  for (const name of names) {
    const record = readRun(name.slice(0, -'.json'.length))
    if (record === undefined) continue
    if (target !== undefined) {
      const recordCwd = typeof record.cwd === 'string' ? record.cwd.replace(/\\/gu, '/').toLowerCase() : ''
      if (recordCwd !== target) continue
    }
    if (newest === undefined || String(record.createdAt ?? '') > String(newest.createdAt ?? '')) newest = record
  }
  return newest
}

function statOrUndefined(absolute) {
  try {
    return statSync(absolute)
  } catch {
    return undefined
  }
}

/** Count artifact-looking files under the lab's `qa/`, breadth-first, bounded. */
function scanArtifacts(absoluteRoot) {
  const samples = []
  let count = 0
  let visited = 0
  const queue = [absoluteRoot]
  while (queue.length > 0 && visited < MAX_SCAN_ENTRIES) {
    const directory = queue.shift()
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      visited += 1
      if (visited >= MAX_SCAN_ENTRIES) break
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolute)
        continue
      }
      const extension = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : ''
      if (!ARTIFACT_EXTENSIONS.has(extension)) continue
      count += 1
      if (samples.length < 5) samples.push(entry.name)
    }
  }
  return { count, samples }
}

/**
 * Scan one run's evidence.
 *
 * @param cwd - the repository root the run belongs to.
 * @param slug - the run's slug.
 * @param record - the stored run record, when there is one.
 * @returns the state the status route and `/quality-status` both render.
 */
export function scanRun(cwd, slug, record) {
  const root = typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  const deliverables = DELIVERABLES.map((deliverable) => {
    const relative = fill(deliverable.path, slug)
    if (root === undefined) {
      return { ...deliverable, path: relative, exists: false, detail: 'no working directory' }
    }
    const absolute = join(root, ...relative.split('/'))
    const stats = statOrUndefined(absolute)
    if (deliverable.kind === 'artifact') {
      if (stats === undefined || !stats.isDirectory()) {
        return { ...deliverable, path: relative, exists: false, detail: 'no qa/ directory' }
      }
      const { count, samples } = scanArtifacts(absolute)
      return {
        ...deliverable,
        path: relative,
        exists: count > 0,
        count,
        samples,
        detail: count === 0 ? 'qa/ has no image, recording or golden output' : `${count} file(s)`,
      }
    }
    if (deliverable.kind === 'dir') {
      return {
        ...deliverable,
        path: relative,
        exists: stats !== undefined && stats.isDirectory(),
        detail: stats === undefined || !stats.isDirectory() ? 'not created' : 'exists',
      }
    }
    return {
      ...deliverable,
      path: relative,
      exists: stats !== undefined && stats.isFile(),
      detail: stats !== undefined && stats.isFile() ? `${stats.size} bytes` : 'not written',
    }
  })
  const met = deliverables.filter((deliverable) => deliverable.exists).length
  const next = deliverables.find((deliverable) => !deliverable.exists)
  return {
    slug,
    cwd: root ?? null,
    run: record ?? null,
    deliverables,
    met,
    total: deliverables.length,
    next: next === undefined ? null : { id: next.id, label: next.label, path: next.path },
    note: 'P0 (the diagnosis) has no file of its own and is not machine-checkable.',
  }
}

/** Resolve a run by explicit slug, else the newest one recorded for this cwd. */
export function resolveRun({ cwd, slug } = {}) {
  const record = isValidSlug(slug) ? readRun(slug) : latestRunFor(cwd)
  const resolvedSlug = isValidSlug(slug) ? slug : record?.slug
  const resolvedCwd = typeof cwd === 'string' && cwd !== '' ? cwd : record?.cwd
  if (resolvedSlug === undefined) {
    return { found: false, reason: 'no run recorded yet', cwd: resolvedCwd ?? null }
  }
  return { found: true, ...scanRun(resolvedCwd, resolvedSlug, record) }
}

/** The transcript form of a scan, for `/quality-status`. */
export function describeRun(state) {
  if (state.found === false) {
    return `Quality runs — none recorded for this workspace yet. Start one with /quality, or name one: /quality-status slug: <slug>`
  }
  const lines = [`Quality run: ${state.slug}`]
  if (state.run !== null) {
    const supplied = Array.isArray(state.run.unfilled) ? state.run.supplied : undefined
    const unfilled = Array.isArray(state.run.unfilled) && state.run.unfilled.length > 0
      ? `, placeholders: ${state.run.unfilled.join(', ')}`
      : ''
    lines.push(`Started ${state.run.createdAt ?? 'unknown'}${supplied === undefined ? '' : ` · ${supplied} inputs supplied`}${unfilled}`)
  }
  lines.push('')
  for (const deliverable of state.deliverables) {
    lines.push(`${deliverable.exists ? '✓' : '·'} ${deliverable.id} ${deliverable.label.padEnd(16)} ${deliverable.path}${deliverable.exists ? ` (${deliverable.detail})` : ''}`)
  }
  lines.push('')
  lines.push(state.next === null
    ? `${state.met}/${state.total} deliverables present. Next: the production decision (Phase 6).`
    : `${state.met}/${state.total} deliverables present. Next: ${state.next.label} — ${state.next.id} (${state.next.path}).`)
  lines.push(state.note)
  return lines.join('\n')
}
