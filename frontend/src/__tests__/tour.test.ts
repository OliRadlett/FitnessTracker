import { describe, it, expect } from 'vitest';
import { nextEvent, type TourEvent } from '@/lib/tour';

const ev = (startElapsed: number, label = 'E'): TourEvent => ({
  startElapsed,
  label,
  startKm: startElapsed / 100,
});

describe('nextEvent', () => {
  it('returns null past the end and for empty lists', () => {
    expect(nextEvent([], 0)).toBeNull();
    expect(nextEvent([ev(10)], 10)).toBeNull();
    expect(nextEvent([ev(10)], 50)).toBeNull();
  });

  it('picks the nearest upcoming event across merged lists', () => {
    const beat = { ...ev(60), label: 'Attack' };
    const climb = { ...ev(30), label: 'Climb' };
    // Deliberately unsorted input — the scan, not the order, decides.
    const next = nextEvent([beat, climb], 0);
    expect(next?.event.label).toBe('Climb');
    expect(next?.inSeconds).toBe(30);
  });

  it('respects the horizon', () => {
    expect(nextEvent([ev(500)], 0, 180)).toBeNull();
    expect(nextEvent([ev(500)], 0, 600)?.inSeconds).toBe(500);
    expect(nextEvent([ev(10)], 0, 0)).toBeNull();
  });

  it('advances as the playhead moves', () => {
    const list = [ev(30), ev(90)];
    expect(nextEvent(list, 0)?.event.startElapsed).toBe(30);
    expect(nextEvent(list, 30)?.event.startElapsed).toBe(90);
  });
});
