import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  addDays,
  diffDays,
  mondayOf,
  getWeek1Start,
  getTotalWeeks,
  getCurrentWeek,
} from '@/lib/training/week';

describe('addDays', () => {
  it('crosses a month boundary forwards', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });

  it('crosses a month boundary backwards', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('is identity for n = 0', () => {
    expect(addDays('2026-09-09', 0)).toBe('2026-09-09');
  });
});

describe('mondayOf', () => {
  it('returns the same day for a Monday', () => {
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
  });

  it('walks back to the previous Monday for a Sunday', () => {
    expect(mondayOf('2026-09-13')).toBe('2026-09-07');
  });

  it('walks back to the Monday of the same week for a Wednesday', () => {
    expect(mondayOf('2026-09-09')).toBe('2026-09-07');
  });

  it('matches getWeek1Start', () => {
    expect(getWeek1Start('2026-09-09')).toBe(mondayOf('2026-09-09'));
  });
});

describe('getTotalWeeks', () => {
  it('counts Monday-aligned weeks when the plan does NOT start on a Monday', () => {
    // Wed 2026-09-09 → Tue 2026-09-22 straddles three Monday-aligned weeks:
    // Mon 09-07…Sun 09-13, Mon 09-14…Sun 09-20, Mon 09-21…Sun 09-27.
    const start = '2026-09-09'; // Wednesday
    const end = '2026-09-22'; // Tuesday

    expect(getTotalWeeks(start, end)).toBe(3);

    // Lock in the fix: the old raw-start ceil formula under-counts for the
    // same input, which is the drift bug this consolidation removes.
    const rawCeil = Math.max(1, Math.ceil((diffDays(start, end) + 1) / 7));
    expect(rawCeil).toBe(2);
    expect(getTotalWeeks(start, end)).not.toBe(rawCeil);
  });

  it('counts a Sunday→Saturday plan as two Monday-aligned weeks', () => {
    // Sun 2026-09-13 → Sat 2026-09-19 spans Mon 09-07…13 and Mon 09-14…20.
    expect(getTotalWeeks('2026-09-13', '2026-09-19')).toBe(2);
  });

  it('returns 1 when the plan fits in a single Monday-aligned week', () => {
    // Mon 2026-09-14 → Fri 2026-09-18.
    expect(getTotalWeeks('2026-09-14', '2026-09-18')).toBe(1);
  });
});

describe('getCurrentWeek', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps to the total number of weeks for a past plan', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00'));

    const start = '2026-01-01';
    const end = '2026-01-31';
    const total = getTotalWeeks(start, end);

    expect(getCurrentWeek(start, end)).toBe(total);
  });

  it('clamps to 1 for a plan that has not started yet', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00'));

    expect(getCurrentWeek('2026-11-01', '2026-11-30')).toBe(1);
  });

  it('returns the in-range week for a plan containing today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00'));

    const start = '2026-09-07'; // Monday
    const end = '2026-10-04'; // Sunday
    const total = getTotalWeeks(start, end);

    expect(total).toBe(4);
    expect(getCurrentWeek(start, end)).toBe(4);
  });
});
