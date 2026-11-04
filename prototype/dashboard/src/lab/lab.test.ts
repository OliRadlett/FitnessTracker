/**
 * Tests for the lab's two pieces of real logic: the markdown-ish parser and the
 * stance reader. Both decide what the athlete sees, so both are worth pinning.
 *
 * Run: npm test
 */
import { describe, expect, it } from 'vitest';
import { parseAnalysis } from './analysis';
import { clean, contextFor, readStance, loadFixture } from './fixture';

describe('parseAnalysis', () => {
  it('splits headings, bullets, numbered items and rules', () => {
    const text = [
      '### Performance Assessment',
      '- **Overall Trend:** Declining.',
      '* **Key Strengths:** Punchy.',
      '--',
      '1. **Rest first**',
      'plain paragraph',
    ].join('\n');
    const blocks = parseAnalysis(text);
    expect(blocks.map((b) => b.kind)).toEqual(['h3', 'ul', 'rule', 'ol', 'p']);
    expect(blocks[0]).toEqual({ kind: 'h3', text: 'Performance Assessment' });
    expect(blocks[1]).toEqual({
      kind: 'ul',
      items: ['**Overall Trend:** Declining.', '**Key Strengths:** Punchy.'],
    });
  });

  it('keeps a heading with no blank line before a bullet', () => {
    const blocks = parseAnalysis('### Sleep\n- one\n- two');
    expect(blocks).toEqual([
      { kind: 'h3', text: 'Sleep' },
      { kind: 'ul', items: ['one', 'two'] },
    ]);
  });

  it('never emits an empty block for blank lines', () => {
    for (const b of parseAnalysis('\n\n### A\n\n\n- x\n\n')) {
      if (b.kind === 'p') expect(b.text.length).toBeGreaterThan(0);
      if (b.kind === 'h3') expect(b.text.length).toBeGreaterThan(0);
    }
  });
});

describe('clean', () => {
  it('repairs mojibake to the intended characters', () => {
    // The payload really contains these three-character sequences.
    expect(clean('Build aerobic base first \u00e2\u20ac\u201d mostly Z2 riding')).toBe(
      'Build aerobic base first \u2014 mostly Z2 riding',
    );
    expect(clean('Back Squat \u00c3\u2014 1')).toBe('Back Squat \u00d7 1');
  });

  it('passes clean text through untouched', () => {
    expect(clean('Evening Weight Training')).toBe('Evening Weight Training');
    expect(clean(null)).toBe('');
  });
});

describe('readStance', () => {
  const f = loadFixture();

  it('reads the form of the day being looked at, not of "today"', () => {
    const now = contextFor(f, '2026-11-04');
    const ride = contextFor(f, '2026-10-27');
    expect(now.tsb).not.toBe(ride.tsb);
    expect(readStance(f, now).reason).not.toBe(readStance(f, ride).reason);
  });

  it('only claims a recovery score for the day it was computed for', () => {
    expect(contextFor(f, '2026-11-04').recovery).not.toBeNull();
    expect(contextFor(f, '2026-10-27').recovery).toBeNull();
  });

  it('never mentions a training plan, because no plan is active', () => {
    for (const day of ['2026-11-04', '2026-11-03', '2026-10-27']) {
      const reading = readStance(f, contextFor(f, day));
      expect(reading.reason.toLowerCase()).not.toContain('plan');
      expect(reading.reason.toLowerCase()).not.toContain('go ahead');
    }
  });

  it('states how many engines actually contributed', () => {
    const reading = readStance(f, contextFor(f, '2026-11-04'));
    expect(reading.reason).toMatch(/\d+ of \d+ engines contributed/);
  });
});
