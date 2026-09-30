import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTerrainResult, ELEVATION_MAX_COORDS } from '@/lib/terrain';
import type { RouteGrid } from '@/lib/route3d';

/** handcrafted grid with a known point count (cols × rows samples) */
function grid(cols: number, rows: number): RouteGrid {
  return {
    cols,
    rows,
    lat0: 51.5,
    lng0: -0.1,
    latSpan: 0.01,
    lngSpan: 0.01,
    lats: Array.from({ length: rows }, (_, r) => 51.5 + r * 0.001),
    lngs: Array.from({ length: cols }, (_, c) => -0.1 + c * 0.001),
  };
}

/** mock fetch that echoes back one elevation per requested coordinate */
function mockElevation() {
  return vi.fn((url: string) => {
    const u = new URL(url);
    const n = (u.searchParams.get('latitude') ?? '').split(',').filter(Boolean).length;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ elevation: Array.from({ length: n }, (_, i) => 50 + i) }),
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTerrainResult', () => {
  it(`fetches a small grid (${ELEVATION_MAX_COORDS} pts) in one request`, async () => {
    const fetch = mockElevation();
    vi.stubGlobal('fetch', fetch);
    const res = await fetchTerrainResult(grid(10, 10));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.heights).toHaveLength(100);
  });

  it('chunks a 150-point grid into two requests and concatenates', async () => {
    const fetch = mockElevation();
    vi.stubGlobal('fetch', fetch);
    const res = await fetchTerrainResult(grid(15, 10));
    expect(fetch).toHaveBeenCalledTimes(2);
    // Second chunk carries the remaining 50 coordinates.
    const secondUrl = (fetch.mock.calls[1] as [string])[0];
    const secondN = (new URL(secondUrl).searchParams.get('latitude') ?? '').split(',').length;
    expect(secondN).toBe(50);
    expect(res.heights).toHaveLength(150);
  });

  it('throws TerrainError when a chunk errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: true }) }),
      ),
    );
    await expect(fetchTerrainResult(grid(10, 10))).rejects.toThrow(/responded 400/);
  });
});
