/**
 * The lab harness for {{SLUG}} — one command, fixed states, a contact sheet.
 *
 *   node prototype/{{SLUG}}/qa/states.mjs --url http://localhost:3000/your-page
 *
 * Edit STATES to name what this feature must show. Each entry is one frame; the
 * sheet is what you look at, and the worst frame is what you fix. The plumbing
 * (browser, viewport, naming, sheet) is deliberately not yours to rewrite.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from '../../../.dsh/plugins/feature-quality/tools/playwright.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SHEET_TOOL = resolve(HERE, '../../../.dsh/plugins/feature-quality/tools/contact-sheet.mjs')

const STATES = [
  { name: 'default', path: '/', viewport: { width: 1280, height: 900 } },
  // The states this feature must survive — empty, dense, error, narrow:
  // { name: 'empty', path: '/?empty=1', viewport: { width: 1280, height: 900 } },
  // { name: 'narrow', path: '/', viewport: { width: 390, height: 844 } },
]

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const base = argument('--url')
if (base === undefined) {
  console.error('usage: node prototype/{{SLUG}}/qa/states.mjs --url <base url> [--out <dir>]')
  process.exit(2)
}
const outDir = resolve(argument('--out') ?? join(HERE, 'shots'))
mkdirSync(outDir, { recursive: true })

const browser = await launchBrowser({ channel: process.env.QUALITY_BROWSER })
const shots = []
try {
  for (const [index, state] of STATES.entries()) {
    const page = await browser.newPage({ viewport: state.viewport })
    await page.goto(new URL(state.path, base).href, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    const file = join(outDir, `${String(index + 1).padStart(2, '0')}-${state.name}.png`)
    await page.screenshot({ path: file, fullPage: true })
    shots.push(file)
    await page.close()
    console.log(`states: ${state.name} → ${file}`)
  }
} finally {
  await browser.close()
}

execFileSync(process.execPath, [SHEET_TOOL, '--out', join(outDir, 'contact-sheet.png'), '--title', '{{FEATURE}}', ...shots], { stdio: 'inherit' })
console.log(`states: sheet → ${join(outDir, 'contact-sheet.png')}`)
