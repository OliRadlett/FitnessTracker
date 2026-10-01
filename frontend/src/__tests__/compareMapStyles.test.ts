import { describe, expect, it } from 'vitest';

import {
  COLOR_A,
  COLOR_B,
  MIN_DRAWABLE_POINTS,
  isDrawable,
  overlayStyles,
} from '@/components/maps/compareMapStyles';

/**
 * The comparison overlay has to survive the case it exists for.
 *
 * On production, 30 of 141 duplicate pairs score exactly 1.0 — two
 * recordings of the same ride with identical geometry. That is precisely the
 * case where B draws directly under A, and where the previous styling (B at
 * weight 4, A at weight 3) hid amber behind blue with a ~1 px fringe. Users
 * reported the map showing only the dashed A line and no orange B, and
 * reasonably concluded B was missing rather than concealed.
 */
describe('overlayStyles', () => {
  it('leaves B visible when the two paths are identical', () => {
    const { a, b } = overlayStyles();
    // The weight delta is what survives exact overlap: B's stroke is centred
    // on the same path as A's, so only the excess width shows.
    expect(b.weight - a.weight).toBeGreaterThanOrEqual(4);
  });

  it('draws B underneath so A reads clearly where they overlap', () => {
    const { a, b } = overlayStyles();
    expect(b.opacity).toBeLessThan(a.opacity);
  });

  it('keeps A dashed and B solid so they are distinguishable when apart', () => {
    const { a, b } = overlayStyles();
    expect(a.dashArray).toBeTruthy();
    expect(b.dashArray).toBeUndefined();
  });

  it('uses the two documented colours', () => {
    const { a, b } = overlayStyles();
    expect(a.color).toBe(COLOR_A);
    expect(b.color).toBe(COLOR_B);
  });

  it('does not make either trace so faint it disappears on satellite tiles', () => {
    const { a, b } = overlayStyles();
    expect(b.opacity).toBeGreaterThanOrEqual(0.3);
    expect(a.opacity).toBeGreaterThanOrEqual(0.8);
  });
});

describe('isDrawable', () => {
  it('rejects a two-point trace', () => {
    // An `Evening Ride` on production is stored as 1202 m but decodes to 2
    // points — a single straight line, which reads as an empty map.
    expect(isDrawable([[55.9, -3.2], [55.91, -3.21]])).toBe(false);
  });

  it('accepts a real trace', () => {
    const pts = Array.from({ length: 50 }, (_, i) => [55.9 + i / 1000, -3.2]);
    expect(isDrawable(pts)).toBe(true);
  });

  it('treats exactly the minimum as drawable', () => {
    const pts = Array.from({ length: MIN_DRAWABLE_POINTS }, (_, i) => [55.9, -3.2 + i]);
    expect(isDrawable(pts)).toBe(true);
  });

  it('rejects empty, null and undefined', () => {
    expect(isDrawable([])).toBe(false);
    expect(isDrawable(null)).toBe(false);
    expect(isDrawable(undefined)).toBe(false);
  });
});