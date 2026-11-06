/**
 * The Inputs block is the plugin's only writable region of `prompt.md`.
 *
 * One implementation, shared by the host half and both eval labs, because the
 * defect this replaces was a second implementation: `index.js` matched the block
 * as a literal `'Inputs\n```\n'` and `eval/harness.mjs` matched it again. On a
 * Windows checkout (`core.autocrlf=true`) the file is CRLF, neither matched, the
 * `UNFILLED:` line was silently dropped and the lab's gate went red — while the
 * same code passed on an LF checkout. Text is normalised here so line endings
 * cannot decide behaviour, and a missing block is an error rather than a no-op.
 */

export const INPUTS_HEADING = 'Inputs'

/** CRLF and lone CR become LF: the delivered message is identical everywhere. */
export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n?/gu, '\n')
}

function fences(lines, headingIndex) {
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('```')) return index
  }
  return -1
}

/**
 * Locate the Inputs block.
 *
 * @param text - the prompt template, in any line-ending style.
 * @returns `{ found }` plus, when found, the block's line body and the text
 * outside it (fences retained), with every index already normalised.
 */
export function splitInputsBlock(text) {
  const lines = normalizeNewlines(text).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== INPUTS_HEADING) continue
    const openIndex = fences(lines, index)
    if (openIndex === -1) continue
    const closeIndex = fences(lines, openIndex)
    if (closeIndex === -1) continue
    return {
      found: true,
      openIndex,
      closeIndex,
      inputs: lines.slice(openIndex + 1, closeIndex),
      outside: [
        ...lines.slice(0, openIndex + 1),
        ...lines.slice(closeIndex),
      ].join('\n'),
    }
  }
  return { found: false, inputs: [], outside: lines.join('\n') }
}

/**
 * Insert one line at the end of the Inputs block.
 *
 * @param text - the prompt template.
 * @param line - the line to add.
 * @returns the template with the line inside the block.
 */
export function appendInputsLine(text, line) {
  const lines = normalizeNewlines(text).split('\n')
  const parts = splitInputsBlock(text)
  if (!parts.found) {
    throw new Error('feature-quality: prompt.md has no Inputs block to write into')
  }
  lines.splice(parts.closeIndex, 0, line)
  return lines.join('\n')
}

/**
 * Fail at activation, not silently at delivery: a template without the block
 * cannot carry the placeholder marker, and the marker is what keeps an unfilled
 * input visible to the model.
 *
 * @param text - the prompt template.
 * @returns the normalised template.
 */
export function assertInputsBlock(text) {
  const parts = splitInputsBlock(text)
  if (!parts.found) {
    throw new Error(
      'feature-quality: prompt.md must contain an "Inputs" heading followed by a fenced block; '
      + 'that block is the only region the command may write to.',
    )
  }
  if (parts.closeIndex <= parts.openIndex + 1) {
    throw new Error('feature-quality: the Inputs block in prompt.md is empty')
  }
  return normalizeNewlines(text)
}
