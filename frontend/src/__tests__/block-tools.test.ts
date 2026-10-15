import { describe, expect, it } from 'vitest';

import { parseWeekRange } from '@/components/training/plan/BlockTools';

describe('parseWeekRange', () => {
  it('parses a range', () => {
    expect(parseWeekRange('3-6')).toEqual([3, 4, 5, 6]);
  });

  it('parses a comma list', () => {
    expect(parseWeekRange('3,5')).toEqual([3, 5]);
  });

  it('parses a single week', () => {
    expect(parseWeekRange('4')).toEqual([4]);
  });

  it('normalises a reversed range', () => {
    expect(parseWeekRange('6-3')).toEqual([3, 4, 5, 6]);
  });

  it('dedupes and sorts across mixed input', () => {
    expect(parseWeekRange('5, 2-4, 3')).toEqual([2, 3, 4, 5]);
  });

  it('drops zero/negative and unparseable parts', () => {
    expect(parseWeekRange('0,2')).toEqual([2]);
    expect(parseWeekRange('abc')).toEqual([]);
    expect(parseWeekRange('')).toEqual([]);
  });
});
