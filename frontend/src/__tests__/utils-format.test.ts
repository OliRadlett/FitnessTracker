import { describe, it, expect } from 'vitest';
import {
  formatDistance,
  formatWeight,
  displayWeightToKg,
  kgToDisplayWeight,
  formatTime,
  formatDateDMY,
  setActivePreferences,
  getActiveUnitSystem,
} from '@/lib/utils';

describe('unit & locale formatting (§3.6)', () => {
  // Reset the singleton to defaults between tests.
  beforeEach(() => {
    setActivePreferences({
      unit_system: 'metric',
      locale: 'en-GB',
      time_format: '24h',
    });
  });

  describe('formatDistance', () => {
    it('defaults to kilometres', () => {
      expect(formatDistance(12500)).toBe('12.50 km');
    });

    it('converts to miles when imperial', () => {
      expect(formatDistance(1609.344, 2, 'imperial')).toBe('1.00 mi');
    });

    it('honors the active unit system singleton', () => {
      setActivePreferences({ unit_system: 'imperial' });
      expect(formatDistance(16093.44, 1)).toBe('10.0 mi');
    });

    it('handles null/negative', () => {
      expect(formatDistance(null)).toBe('—');
      expect(formatDistance(-1)).toBe('—');
    });
  });

  describe('weight helpers', () => {
    it('formats kg', () => {
      expect(formatWeight(75.5)).toBe('75.5 kg');
    });

    it('formats lb when imperial', () => {
      expect(formatWeight(75.5, 'imperial')).toBe('166.4 lb');
    });

    it('round-trips display value <-> kg', () => {
      const kg = 75.5;
      const lb = kgToDisplayWeight(kg, 'imperial');
      expect(lb).toBeCloseTo(166.45, 1);
      expect(displayWeightToKg(lb, 'imperial')).toBeCloseTo(kg, 3);
    });

    it('passes kg through in metric', () => {
      expect(displayWeightToKg(80)).toBe(80);
      expect(kgToDisplayWeight(80, 'metric')).toBe(80);
    });

    it('handles null', () => {
      expect(formatWeight(null)).toBe('—');
    });
  });

  describe('formatTime / formatDateDMY', () => {
    it('formats 24h by default', () => {
      const out = formatTime('2026-09-07T14:35:00');
      expect(out).toBe('14:35');
    });

    it('honors 12h', () => {
      const out = formatTime('2026-09-07T14:35:00', 'en-US', '12h');
      expect(out.toLowerCase()).toContain('2:35 pm');
    });

    it('formats dates in the active locale', () => {
      setActivePreferences({ locale: 'en-US' });
      expect(formatDateDMY('2026-03-21')).toMatch(/Mar 21, 2026/);
      setActivePreferences({ locale: 'en-GB' });
      expect(formatDateDMY('2026-03-21')).toBe('21 Mar 2026');
    });
  });

  it('exposes the active unit system', () => {
    expect(getActiveUnitSystem()).toBe('metric');
    setActivePreferences({ unit_system: 'imperial' });
    expect(getActiveUnitSystem()).toBe('imperial');
  });
});