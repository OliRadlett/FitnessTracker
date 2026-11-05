import { describe, it, expect } from 'vitest';
import { MORE_ITEMS } from '@/components/Sidebar/MoreDrawer';

describe('More navigation', () => {
  it('gives /today an entry point', () => {
    // /today shipped as a POC with no inbound link; the atlas measured 0.
    expect(MORE_ITEMS.some((item) => item.href === '/today')).toBe(true);
  });

  it('keeps every destination unique', () => {
    const hrefs = MORE_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
