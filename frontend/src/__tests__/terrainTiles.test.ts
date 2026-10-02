import { describe, it, expect } from 'vitest';
import {
  chooseZoom,
  diffuseVoids,
  lngLatToPixel,
  MAX_MERCATOR_LAT,
  TERRARIUM_MAX_ZOOM,
  terrariumDecode,
  tileRangeForBbox,
} from '@/lib/terrainTiles';

describe('diffuseVoids', () => {
  it('fills a single void pixel from its neighbours', () => {
    const heights = [10, 10, 10, 10, 0, 10, 10, 10, 10];
    const ok = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    diffuseVoids(heights, ok, 3, 3);
    expect(heights[4]).toBeCloseTo(10, 6);
    expect(ok[4]).toBe(1);
  });

  it('leaves all-valid grids untouched', () => {
    const heights = [10, 20, 30, 40];
    const ok = new Uint8Array([1, 1, 1, 1]);
    diffuseVoids(heights, ok, 2, 2);
    expect(heights).toEqual([10, 20, 30, 40]);
  });

  it('preserves ocean interiors while filling the shoreline', () => {
    // Left half land (10 m), right half void: 8 passes reach 8 columns in.
    const cols = 20;
    const rows = 5;
    const heights = new Array(cols * rows).fill(0);
    const ok = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 10; c++) {
        heights[r * cols + c] = 10;
        ok[r * cols + c] = 1;
      }
    }
    diffuseVoids(heights, ok, cols, rows);
    // Shoreline filled with land height…
    expect(heights[2 * cols + 10]).toBeCloseTo(10, 6);
    expect(ok[2 * cols + 10]).toBe(1);
    // …but the far interior stays void (renders as water, as before).
    expect(ok[2 * cols + 19]).toBe(0);
    expect(heights[2 * cols + 19]).toBe(0);
  });
});

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

  it('clamps polar latitudes instead of exploding the tile range', () => {
    const r = tileRangeForBbox(89.9, -0.1, 90, -0.1, 12);
    for (const v of [r.x0, r.x1, r.y0, r.y1]) expect(Number.isFinite(v)).toBe(true);
    expect(r.y1 - r.y0).toBeLessThan(1000);
    expect(lngLatToPixel(90, 0, 12).y).toBeCloseTo(lngLatToPixel(MAX_MERCATOR_LAT, 0, 12).y, 6);
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

  it('never exceeds the terrarium dataset ceiling, even for tiny bboxes', () => {
    // chooseZoom itself is generic, but the replay fetch path must cap at the
    // dataset max — z16+ tiles 404 and a single miss fails the whole fetch.
    // Tiny bbox (a 2 km ride) with a generous budget is the regression case.
    const z = chooseZoom(51.5, -0.1, 51.52, -0.07, 48, 8, TERRARIUM_MAX_ZOOM);
    expect(z).toBeLessThanOrEqual(TERRARIUM_MAX_ZOOM);
    expect(TERRARIUM_MAX_ZOOM).toBe(15);
  });
});
