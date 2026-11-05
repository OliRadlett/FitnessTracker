import { describe, expect, it } from 'vitest';
import { axisTicks, fitDomain, niceStep, visibleTicks } from './chartScale';

describe('niceStep', () => {
  it('snaps to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05);
    expect(niceStep(120)).toBe(200);
  });
});

describe('fitDomain', () => {
  it('pads and rounds outward to a readable boundary', () => {
    const [lo, hi] = fitDomain([214, 236, 262]);
    expect(lo).toBeLessThan(214);
    expect(hi).toBeGreaterThan(262);
    expect(lo % 5).toBe(0);
    expect(hi % 5).toBe(0);
  });

  it('anchors at zero and never pads below it when zero is meaningful', () => {
    const [lo, hi] = fitDomain([4, 41, 56], { zero: true });
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(56);
  });

  it('keeps negative values in range', () => {
    const [lo, hi] = fitDomain([-6.7, 8.3]);
    expect(lo).toBeLessThan(-6.7);
    expect(hi).toBeGreaterThan(8.3);
  });

  it('does not collapse a flat series to a zero-height axis', () => {
    const [lo, hi] = fitDomain([212.5, 212.5]);
    expect(hi - lo).toBeGreaterThan(0);
  });

  it('falls back to a valid axis for empty input', () => {
    expect(fitDomain([])).toEqual([0, 1]);
    expect(fitDomain([Number.NaN])).toEqual([0, 1]);
  });
});

describe('axisTicks', () => {
  it('lands on round numbers inside the domain', () => {
    expect(axisTicks([0, 60])).toEqual([0, 20, 40, 60]);
    // count is a target, not a promise: a ±10 band reads best on 5s.
    expect(axisTicks([-10, 10])).toEqual([-10, -5, 0, 5, 10]);
  });

  it('never emits a negative zero label', () => {
    expect(axisTicks([-2, 2]).some((v) => Object.is(v, -0))).toBe(false);
  });
});

describe('visibleTicks', () => {
  const gap = (step: number) => (a: number, b: number) => Math.abs(a - b) * step;

  it('always names its own end', () => {
    const ticks = visibleTicks(91, 16, gap(5));
    expect(ticks[ticks.length - 1]).toBe(90);
  });

  it('drops an interior tick that would collide with the end', () => {
    const ticks = visibleTicks(91, 16, gap(5), 60);
    const last = ticks[ticks.length - 1];
    const previous = ticks[ticks.length - 2] ?? 0;
    expect((last - previous) * 5).toBeGreaterThanOrEqual(60);
  });

  it('does not duplicate the end when it already lands on the step', () => {
    expect(visibleTicks(16, 5, gap(20))).toEqual([0, 5, 10, 15]);
  });

  it('keeps every tick when they all fit', () => {
    expect(visibleTicks(5, 1, gap(100))).toEqual([0, 1, 2, 3, 4]);
  });
});
