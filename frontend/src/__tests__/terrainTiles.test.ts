import { describe, it, expect } from 'vitest';
import {
  chooseZoom,
  lngLatToPixel,
  terrariumDecode,
  tileRangeForBbox,
} from '@/lib/terrainTiles';

describe('terrariumDecode', () => {
  it('decodes the zero datum', () => {
    expect(terrariumDecode(128, 0, 0)).toBe(0);
  });
  it('decodes fractional metres via the blue channel', () => {
    expect(terrariumDecode(128, 0, 128)).toBeCloseTo(0.5, 6);
  });
  it('decodes the minimum', () => {
    expect(terrariumDecode(0, 0, 0)).toBe(-32768);
  });
});

describe('lngLatToPixel', () => {
  it('puts (0,0) at the centre of the z=0 world', () => {
    const p = lngLatToPixel(0, 0, 0);
    expect(p.x).toBeCloseTo(128, 6);
    expect(p.y).toBeCloseTo(128, 6);
  });
});

describe('tileRangeForBbox', () => {
  it('returns an ordered range', () => {
    const r = tileRangeForBbox(51.5, -0.13, 51.52, -0.1, 13);
    expect(r.x1).toBeGreaterThanOrEqual(r.x0);
    expect(r.y1).toBeGreaterThanOrEqual(r.y0);
  });
});

describe('chooseZoom', () => {
  it('stays within the tile budget', () => {
    const z = chooseZoom(51.5, -0.13, 51.6, 0.0, 16);
    const r = tileRangeForBbox(51.5, -0.13, 51.6, 0.0, z);
    expect((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)).toBeLessThanOrEqual(16);
  });

  it('picks a higher zoom for a larger budget', () => {
    const small = chooseZoom(51.5, -0.13, 51.6, 0.0, 4);
    const big = chooseZoom(51.5, -0.13, 51.6, 0.0, 64);
    expect(big).toBeGreaterThanOrEqual(small);
  });
});
