/**
 * Playwright, resolved from the repo, for tools that need a browser.
 *
 * The plugin itself never imports Playwright — it is a browser tool for the
 * quality lab, and this project already carries it as a frontend dev
 * dependency. Resolution walks the two places it can be: `frontend/node_modules`
 * and the repo root. A missing browser is a skipped check, not a broken build,
 * so callers get a clear error instead of a stack from a deep import.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The repository root, from this file's location in `.dsh/plugins/<name>/tools/`. */
export function repoRoot() {
  // tools → feature-quality → plugins → .dsh → the repository.
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')
}

/**
 * Import Playwright's CommonJS entry through ESM.
 * @returns the module namespace, whose `chromium` is the browser type.
 */
export async function loadPlaywright() {
  const candidates = [
    resolve(repoRoot(), 'frontend/node_modules/playwright/index.js'),
    resolve(repoRoot(), 'node_modules/playwright/index.js'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    return import(pathToFileURL(candidate).href)
  }
  throw new Error(
    'quality tools: Playwright is not installed. Run `npm install` in frontend/, or pass a system Chrome/Edge.',
  )
}

/**
 * Launch a browser, preferring an installed one to a downloaded one.
 *
 * @param options - `channel` to try first, `headless` (default true).
 * @returns a Playwright Browser.
 */
export async function launchBrowser(options = {}) {
  const module = await loadPlaywright()
  const chromium = module.chromium ?? module.default?.chromium
  if (chromium === undefined) throw new Error('quality tools: Playwright exposed no chromium')
  const failures = []
  const channels = [...new Set([options.channel, 'msedge', 'chrome', undefined].filter((value, index, all) => all.indexOf(value) === index))]
  for (const channel of channels) {
    try {
      return await chromium.launch({ ...(channel === undefined ? {} : { channel }), headless: options.headless ?? true })
    } catch (error) {
      failures.push(`${channel ?? 'bundled'}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    }
  }
  throw new Error(`quality tools: no browser could start (${failures.join('; ')})`)
}
