import { describe, it, expect } from 'vitest';
import { detectHighlights, highlightAt } from '@/lib/highlights';
import type { ReplayPoint } from '@/lib/replay';

type Val = number | ((i: number) => number);
const at = (v: Val, i: number) => (typeof v === 'function' ? v(i) : v);

function mk(
  n: number,
  o: { distStep?: number; dt?: Val; grade?: Val; power?: Val; speed?: Val } = {},
): ReplayPoint[] {
  const distStep = o.distStep ?? 10;
  const pts: ReplayPoint[] = [];
  let elapsed = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) elapsed += at(o.dt ?? 2, i);
    pts.push({
      elapsed,
      distance: i * distStep,
      x: i * distStep,
      y: 0,
      z: 0,
      speed: at(o.speed ?? 5, i),
      power: o.power == null ? null : at(o.power, i),
      hr: null,
      cadence: null,
      grade: o.grade == null ? 0 : at(o.grade, i),
    });
  }
  return pts;
}

describe('detectHighlights', () => {
  it('returns nothing for a trivial path', () => {
    expect(detectHighlights([])).toEqual([]);
    expect(detectHighlights(mk(1))).toEqual([]);
  });

  it('detects a sustained climb with real gain (grade × distance)', () => {
    const pts = mk(101, { grade: 6 }); // 1 km at 6% => 60 m gain
    const hs = detectHighlights(pts);
    const climb = hs.find((h) => h.kind === 'climb');
    expect(climb).toBeDefined();
    expect(climb!.score).toBeGreaterThan(50);
    expect(climb!.detail).toMatch(/%/);
  });

  it('detects a descent (negative grade)', () => {
    const hs = detectHighlights(mk(101, { grade: -6 }));
    const d = hs.find((h) => h.kind === 'descent');
    expect(d).toBeDefined();
    expect(d!.score).toBeGreaterThan(50);
  });

  it('ignores a short/small climb below thresholds', () => {
    const pts = mk(20, { grade: 6 }); // 200 m, 12 m gain
    expect(detectHighlights(pts).some((h) => h.kind === 'climb')).toBe(false);
  });

  it('detects the best sustained sprint from power', () => {
    const pts = mk(120, { power: (i) => (i >= 40 && i <= 55 ? 420 : 120) });
    const sprint = detectHighlights(pts).find((h) => h.kind === 'sprint');
    expect(sprint).toBeDefined();
    expect(sprint!.detail).toMatch(/W$/);
  });

  it('detects the fastest kilometre', () => {
    const pts = mk(250, { dt: (i) => (i >= 100 && i <= 160 ? 0.7 : 2) });
    const fastest = detectHighlights(pts).find((h) => h.kind === 'fastest');
    expect(fastest).toBeDefined();
    expect(fastest!.detail).toMatch(/km\/h$/);
  });

  it('ignores a zero fastest window instead of reporting 0 km/h', () => {
    const pts = mk(250, { dt: (i) => (i >= 100 && i <= 160 ? 0.7 : 2) });
    expect(detectHighlights(pts, { fastestWindowM: 0 }).some((h) => h.kind === 'fastest')).toBe(false);
  });

  it('does not let null power samples dilute (or invent) a sprint', () => {
    // Only two real 500 W samples amid nulls: no window has 3 measured
    // samples, so there is no sprint (the old nulls-as-zero math invented one).
    const pts = mk(30);
    pts[10].power = 500;
    pts[11].power = 500;
    expect(detectHighlights(pts).some((h) => h.kind === 'sprint')).toBe(false);
  });

  it('averages sprints over measured samples only', () => {
    const pts = mk(60);
    for (let i = 20; i <= 29; i++) pts[i].power = 400;
    const sprint = detectHighlights(pts).find((h) => h.kind === 'sprint');
    expect(sprint).toBeDefined();
    expect(sprint!.detail).toMatch(/^400 W$/);
  });

  it('sorts highlights by start time', () => {
    const pts = mk(300, {
      grade: (i) => (i < 100 ? 6 : i > 200 ? -6 : 0),
      power: (i) => (i >= 120 && i <= 140 ? 400 : 100),
    });
    const hs = detectHighlights(pts);
    for (let i = 1; i < hs.length; i++) {
      expect(hs[i].startElapsed).toBeGreaterThanOrEqual(hs[i - 1].startElapsed);
    }
  });
});

describe('highlightAt', () => {
  it('returns the covering highlight, preferring a climb over a sprint', () => {
    const climb = { kind: 'climb' as const, startElapsed: 10, endElapsed: 60, startKm: 0, endKm: 1, label: 'c', detail: '', score: 1 };
    const sprint = { kind: 'sprint' as const, startElapsed: 40, endElapsed: 80, startKm: 0, endKm: 1, label: 's', detail: '', score: 1 };
    expect(highlightAt([climb, sprint], 50)?.kind).toBe('climb');
    expect(highlightAt([climb, sprint], 70)?.kind).toBe('sprint');
    expect(highlightAt([climb], 5)).toBeNull();
  });

  it('ranks sprint above fastest regardless of list order, ties by score', () => {
    const mkH = (kind: 'sprint' | 'fastest', score: number) => (
      { kind, startElapsed: 0, endElapsed: 100, startKm: 0, endKm: 1, label: kind, detail: '', score }
    );
    expect(highlightAt([mkH('fastest', 99), mkH('sprint', 1)], 50)?.kind).toBe('sprint');
    expect(highlightAt([mkH('sprint', 1), mkH('sprint', 2)], 50)?.score).toBe(2);
  });
});
