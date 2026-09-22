import { describe, it, expect } from 'vitest';
import { sportLabel } from '@/lib/sportUtils';

describe('sportLabel (2.2)', () => {
  it('humanizes raw plan sport codes', () => {
    expect(sportLabel('cycle')).toBe('Cycling');
    expect(sportLabel('strength')).toBe('Strength');
    expect(sportLabel('rest')).toBe('Rest');
    expect(sportLabel('weighttraining')).toBe('Strength');
    expect(sportLabel(null)).toBe('—');
  });
});
