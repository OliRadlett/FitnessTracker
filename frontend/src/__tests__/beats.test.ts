import { describe, it, expect } from 'vitest';
import { beatAt, detectBeats } from '@/lib/beats';
import type { ReplayPoint } from '@/lib/replay';

type Num = number | null | ((i: number) => number | null);

function mk(n: number, power: Num, dt = 2, distStep = 10): ReplayPoint[] {
  const pts: ReplayPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = typeof power === 'function' ? power(i) : power;
    pts.push({
      elapsed: i * dt,
      distance: i * distStep,
      x: i * distStep,
      y: 0,
      z: 0,
      speed: 8,
      power: p,
      hr: null,
      cadence: null,
      grade: 0,
    });
  }
  return pts;
}

describe('detectBeats', () => {
  it('returns nothing without power data', () => {
    expect(detectBeats(mk(200, null))).toEqual([]);
    expect(detectBeats([])).toEqual([]);
  });

  it('detects a surge against its trailing baseline', () => {
    // 400 s at 150 W, 30 s at 400 W, then cruise — a textbook attack.
    const pts = mk(250, (i) => (i >= 200 && i <= 214 ? 400 : 150));
    const attack = detectBeats(pts).find((b) => b.kind === 'attack');
    expect(attack).toBeDefined();
    expect(attack!.detail).toMatch(/× baseline\)$/);
    expect(attack!.score).toBeGreaterThan(1.6);
  });

  it('rejects surges under the absolute floor', () => {
    // 200 W surge reads big against a soft baseline but is no attack.
    const pts = mk(250, (i) => (i >= 200 && i <= 214 ? 200 : 100));
    expect(detectBeats(pts).some((b) => b.kind === 'attack')).toBe(false);
  });

  it('detects the closing push above ride average', () => {
    const pts = mk(600, (i) => (i >= 540 ? 300 : 180));
    const finale = detectBeats(pts).find((b) => b.kind === 'finale');
    expect(finale).toBeDefined();
    expect(finale!.label).toBe('Final push');
    expect(finale!.detail).toMatch(/over ride average$/);
  });

  it('detects a comeback after a genuine lull', () => {
    const pts = mk(600, (i) => (i >= 150 && i < 230 ? 80 : 200));
    const comeback = detectBeats(pts).find((b) => b.kind === 'comeback');
    expect(comeback).toBeDefined();
    expect(comeback!.detail).toMatch(/after the lull$/);
  });

  it('sorts beats by start time', () => {
    const pts = mk(600, (i) => {
      if (i >= 150 && i < 230) return 80; // lull → comeback
      if (i >= 540) return 300; // finale
      return 200;
    });
    const beats = detectBeats(pts);
    expect(beats.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].startElapsed).toBeGreaterThanOrEqual(beats[i - 1].startElapsed);
    }
  });
});

describe('beatAt', () => {
  it('returns null outside every beat and the strongest inside overlaps', () => {
    const weak = { kind: 'attack' as const, startElapsed: 0, endElapsed: 100, startKm: 0, endKm: 1, label: 'a', detail: '', score: 1.7 };
    const strong = { kind: 'finale' as const, startElapsed: 40, endElapsed: 80, startKm: 0, endKm: 1, label: 'f', detail: '', score: 2.1 };
    expect(beatAt([weak, strong], 50)?.kind).toBe('finale');
    expect(beatAt([weak, strong], 150)).toBeNull();
  });
});
