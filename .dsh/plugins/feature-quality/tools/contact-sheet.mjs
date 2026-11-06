/**
 * One labelled page of frames: the thing you look at after a render.
 *
 *   node .dsh/plugins/feature-quality/tools/contact-sheet.mjs \
 *     --out prototype/<slug>/qa/contact-sheet.png \
 *     --title "Route badge — 4 states" \
 *     shots/01-empty.png shots/02-filled.png
 *
 * Images go in as base64 data URIs and the page is laid out and screenshotted by
 * a real browser, so this needs no image library and no image-size parsing.
 * Labels default to the file name; `--label` overrides them in order.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { launchBrowser } from './playwright.mjs'

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }

function usage(message) {
  if (message !== undefined) console.error(`contact-sheet: ${message}`)
  console.error('usage: contact-sheet.mjs --out <path> [--columns n] [--width px] [--title text] [--label text]… <image>…')
  process.exit(2)
}

/** Minimal argument parsing: flags, then positional images. */
function parse(argv) {
  const flags = { columns: 2, width: 660, title: '', labels: [], images: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--out') { flags.out = argv[index += 1]; continue }
    if (argument === '--title') { flags.title = argv[index += 1] ?? ''; continue }
    if (argument === '--label') { flags.labels.push(argv[index += 1] ?? ''); continue }
    if (argument === '--columns') { flags.columns = Number(argv[index += 1]); continue }
    if (argument === '--width') { flags.width = Number(argv[index += 1]); continue }
    if (argument === '--help' || argument === '-h') usage()
    if (argument.startsWith('-')) usage(`unknown flag ${argument}`)
    flags.images.push(argument)
  }
  return flags
}

const flags = parse(process.argv.slice(2))
if (flags.out === undefined) usage('--out is required')
if (flags.images.length === 0) usage('at least one image is required')
if (!Number.isInteger(flags.columns) || flags.columns < 1) usage('--columns must be a positive integer')
if (!Number.isFinite(flags.width) || flags.width < 120) usage('--width must be at least 120')

const tiles = flags.images.map((path, index) => {
  const absolute = resolve(path)
  const type = IMAGE_TYPES[extname(absolute).toLowerCase()]
  if (type === undefined) throw new Error(`contact-sheet: ${path} is not a png, jpg, webp, gif or avif`)
  const data = readFileSync(absolute).toString('base64')
  return { label: flags.labels[index] ?? basename(absolute), src: `data:${type};base64,${data}` }
})

const gap = 14
const padding = 18
const caption = 22
const width = padding * 2 + flags.columns * flags.width + (flags.columns - 1) * gap
const escape = (value) => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #f7f7f8; }
  body { padding: ${padding}px; box-sizing: border-box; width: ${width}px; font: 14px/1.3 ui-sans-serif, system-ui, sans-serif; color: #52525b; }
  h1 { margin: 0 0 ${padding}px; font-size: 15px; font-weight: 600; color: #18181b; }
  .grid { display: grid; grid-template-columns: repeat(${flags.columns}, ${flags.width}px); gap: ${gap}px; align-items: start; }
  figure { margin: 0; min-width: 0; }
  figcaption { height: ${caption}px; line-height: ${caption}px; font-size: 13px; color: #71717a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  img { display: block; width: ${flags.width}px; height: auto; border: 1px solid #e4e4e7; border-radius: 8px; background: #fff; }
</style>
${flags.title === '' ? '' : `<h1>${escape(flags.title)}</h1>`}
<div class="grid">
${tiles.map((tile) => `  <figure><figcaption>${escape(tile.label)}</figcaption><img src="${tile.src}" alt="${escape(tile.label)}"></figure>`).join('\n')}
</div>`

const browser = await launchBrowser({ channel: process.env.QUALITY_BROWSER })
try {
  const page = await browser.newPage({ viewport: { width, height: 600 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
  const height = await page.evaluate(() => document.body.scrollHeight)
  await page.setViewportSize({ width, height })
  const output = resolve(flags.out)
  mkdirSync(dirname(output), { recursive: true })
  await page.screenshot({ path: output, fullPage: true })
  writeFileSync(`${output}.html`, html, 'utf8')
  console.log(`contact-sheet: ${tiles.length} frame(s) → ${output} (${width}×${height})`)
} finally {
  await browser.close()
}
