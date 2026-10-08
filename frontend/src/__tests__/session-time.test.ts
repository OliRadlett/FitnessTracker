import { describe, expect, it } from 'vitest';
import { fromLocalInputValue, toLocalInputValue } from '../lib/lifting/sessionTime';

describe('toLocalInputValue', () => {
  it('formats an ISO timestamp as a datetime-local value', () => {
    expect(toLocalInputValue('2026-10-06T17:02:00.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });

  it('returns empty for missing or invalid input', () => {
    expect(toLocalInputValue(null)).toBe('');
    expect(toLocalInputValue(undefined)).toBe('');
    expect(toLocalInputValue('not-a-date')).toBe('');
  });
});

describe('fromLocalInputValue', () => {
  it('parses a datetime-local value to ISO UTC', () => {
    const iso = fromLocalInputValue('2026-10-06T17:02');
    expect(iso).toBe(new Date('2026-10-06T17:02').toISOString());
  });

  it('returns null for empty or invalid input (clearing the field)', () => {
    expect(fromLocalInputValue('')).toBeNull();
  });

  it('round-trips through the input format regardless of timezone', () => {
    const start = toLocalInputValue('2026-01-15T08:30:00.000Z');
    const back = fromLocalInputValue(start);
    expect(back).not.toBeNull();
    // Minute precision survives the round trip.
    expect(new Date(back!).getTime()).toBe(
      Math.floor(new Date('2026-01-15T08:30:00.000Z').getTime() / 60000) * 60000,
    );
  });
});
