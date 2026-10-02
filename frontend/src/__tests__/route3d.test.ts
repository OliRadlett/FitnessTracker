import { describe, it, expect } from 'vitest';
import {
  DESCENT_COLOR,
  ELEVATION_RAMP,
  GRADE_RAMP,
  GRADE_SCALE,
  MAX_GRID_POINTS,
  bilinearHeight,
  buildRoute3D,
  buildTerrainMesh,
  computeDrape,
  computeGrid,
  elevationColor,
  gradeColor,
  gridSampleCoords,
  hexToRgb,
  parseOverlayHoverKm,
  pointColor,
  slopeColor,
  steepestKm,
} from '@/lib/route3d';
import type { RouteGrid } from '@/lib/route3d';

// A 1 km north-south hill at 5% grade: 50 m gain over 0.00898° of latitude.
const hill: [number, number][] = [
  [51.5, -0.1],
  [51.50898, -0.1],
];
const hillElevations: (number | null)[] = [0, 50];

describe('computeGrid', () => {
  it('fits a whole route into ≤ MAX_GRID_POINTS grid points', () => {
    const grid = computeGrid(hill)!;
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(MAX_GRID_POINTS);
  });

  it('pads the bbox so the route sits inside the terrain bed', () => {
    const grid = computeGrid(hill)!;
    expect(grid.lat0).toBeLessThan(51.5);
    expect(grid.lats[grid.rows - 1]).toBeGreaterThan(51.50898);
    expect(grid.lng0).toBeLessThan(-0.1);
    expect(grid.lngs[grid.cols - 1]).toBeGreaterThan(-0.1);
  });

  it('keeps a 2×2+ bed even for a single-point/degenerate route', () => {
    const grid = computeGrid([[51.5, -0.1]])!;
    expect(grid.cols).toBeGreaterThanOrEqual(2);
    expect(grid.rows).toBeGreaterThanOrEqual(2);
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(MAX_GRID_POINTS);
  });

  it('never exceeds the cap even for an extremely elongated bbox', () => {
    // 100 km north-south sliver.
    const elongated: [number, number][] = [
      [51.0, -0.1],
      [51.0 + 0.9, -0.1],
    ];
    const grid = computeGrid(elongated)!;
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(MAX_GRID_POINTS);
    expect(grid.cols).toBeGreaterThanOrEqual(2);
    expect(grid.rows).toBeGreaterThanOrEqual(2);
  });
});

describe('gridSampleCoords', () => {
  it('produces row-major lat/lng in lockstep with grid dimensions', () => {
    const grid = computeGrid(hill)!;
    const { lat, lng } = gridSampleCoords(grid);
    expect(lat.length).toBe(grid.cols * grid.rows);
    expect(lng.length).toBe(lat.length);
    // First row: same lat, all longitudes.
    expect(lat.slice(0, grid.cols).every((v) => v === grid.lats[0])).toBe(true);
    expect(lng.slice(0, grid.cols)).toEqual(grid.lngs);
  });
});

describe('bilinearHeight', () => {
  it('interpolates the midpoint of a uniform ramp', () => {
    // 3×3 grid with a diagonal ramp e = row + col.
    const grid = {
      cols: 3,
      rows: 3,
      lat0: 0,
      lng0: 0,
      latSpan: 2,
      lngSpan: 2,
      lats: [0, 1, 2],
      lngs: [0, 1, 2],
    };
    const heights = [
      0, 1, 2,
      1, 2, 3,
      2, 3, 4,
    ];
    expect(bilinearHeight(grid, heights, 0.5, 0.5)).toBeCloseTo(1, 5);
  });

  it('clamps samples to the grid bounds', () => {
    const grid = {
      cols: 2,
      rows: 2,
      lat0: 0,
      lng0: 0,
      latSpan: 1,
      lngSpan: 1,
      lats: [0, 1],
      lngs: [0, 1],
    };
    expect(bilinearHeight(grid, [0, 0, 0, 10], 5, 5)).toBe(10);
  });

  it('returns null when heights are non-finite or too short', () => {
    const grid = {
      cols: 2,
      rows: 2,
      lat0: 0,
      lng0: 0,
      latSpan: 1,
      lngSpan: 1,
      lats: [0, 1],
      lngs: [0, 1],
    };
    expect(bilinearHeight(grid, [0, Number.NaN, 0, 10], 0.2, 0.2)).toBeNull();
    expect(bilinearHeight(grid, [0, 0], 0.2, 0.2)).toBeNull();
  });
});

describe('buildRoute3D', () => {
  it('lifts z from elevation with vertical exaggeration', () => {
    const build = buildRoute3D({ coords: hill, elevations: hillElevations });
    expect(build.altMin).toBe(0);
    expect(build.altMax).toBe(50);
    // z-scale = extent/span*0.12 → 999.7/50*0.12 ≈ 2.4 (clamped into [2,10]).
    expect(build.zScale).toBeGreaterThan(2);
    expect(build.zScale).toBeLessThan(2.5);
    expect(build.path[0].z).toBe(0);
    expect(build.path[build.path.length - 1].z).toBeCloseTo(120, 0);
  });

  it('computes gradient as a percentage for the last segment', () => {
    const build = buildRoute3D({ coords: hill, elevations: hillElevations });
    const last = build.path[build.path.length - 1];
    expect(last.distKm).toBeCloseTo(1, 0);
    expect(last.slopePct).toBeCloseTo(5, 1);
  });

  it('honours maxPathSamples decimation', () => {
    // 3000-vertex route: no meaningful elevation variability, but dense coords.
    const coords = Array.from({ length: 3000 }, (_, i) => [51.5 + (i / 2999) * 0.00898, -0.1] as [number, number]);
    const build = buildRoute3D({ coords, maxPathSamples: 200 });
    expect(build.path.length).toBe(200);
  });

  it('keeps full resolution below maxPathSamples', () => {
    const build = buildRoute3D({ coords: hill, elevations: hillElevations, maxPathSamples: 1000 });
    expect(build.path.length).toBe(2);
  });

  it('tints lowland green and high alpine grey-white (absolute hypsometry)', () => {
    const grid: RouteGrid = {
      cols: 4,
      rows: 4,
      lat0: 51.5,
      lng0: -0.1,
      latSpan: 0.01,
      lngSpan: 0.01,
      lats: [51.5, 51.51, 51.52, 51.53],
      lngs: [-0.1, -0.09, -0.08, -0.07],
    };
    const opts = { lat0: 51.5, lng0: -0.1, altMin: 0, zScale: 1 };
    const low = buildTerrainMesh(grid, new Array(16).fill(60), opts);
    // Interior vertex (r=1, c=1): green dominates, red stays low.
    const li = (1 * 4 + 1) * 3;
    expect(low.colors[li + 1]).toBeGreaterThan(low.colors[li]);
    expect(low.colors[li]).toBeLessThan(0.35);
    const high = buildTerrainMesh(grid, new Array(16).fill(2000), opts);
    const hi = (1 * 4 + 1) * 3;
    // Greyish: all channels up, spread narrow.
    expect(Math.min(high.colors[hi], high.colors[hi + 1], high.colors[hi + 2])).toBeGreaterThan(0.3);
    expect(
      Math.max(high.colors[hi], high.colors[hi + 1], high.colors[hi + 2]) -
        Math.min(high.colors[hi], high.colors[hi + 1], high.colors[hi + 2]),
    ).toBeLessThan(0.2);
  });

  it('tints the same elevation identically regardless of neighbours (no local normalisation)', () => {
    const grid: RouteGrid = {
      cols: 5,
      rows: 5,
      lat0: 51.5,
      lng0: -0.1,
      latSpan: 0.01,
      lngSpan: 0.01,
      lats: [51.5, 51.51, 51.52, 51.53, 51.54],
      lngs: [-0.1, -0.09, -0.08, -0.07, -0.06],
    };
    const opts = { lat0: 51.5, lng0: -0.1, altMin: 0, zScale: 1 };
    const flat = buildTerrainMesh(grid, new Array(25).fill(120), opts);
    const varied = buildTerrainMesh(
      grid,
      Array.from({ length: 25 }, (_, i) => (i === 12 ? 120 : i * 40)),
      opts,
    );
    const ci = 12 * 3;
    expect(Array.from(varied.colors.slice(ci, ci + 3))).toEqual(Array.from(flat.colors.slice(ci, ci + 3)));
  });

  it('renders below-sea-level cells as water, not land', () => {
    const grid: RouteGrid = {
      cols: 4,
      rows: 4,
      lat0: 51.5,
      lng0: -0.1,
      latSpan: 0.01,
      lngSpan: 0.01,
      lats: [51.5, 51.51, 51.52, 51.53],
      lngs: [-0.1, -0.09, -0.08, -0.07],
    };
    const res = buildTerrainMesh(grid, new Array(16).fill(-5), { lat0: 51.5, lng0: -0.1, altMin: 0, zScale: 1 });
    const i = (1 * 4 + 1) * 3;
    expect(res.colors[i + 2]).toBeGreaterThan(res.colors[i]);
  });

  it('drapes points onto the DEM with smoothing and raw-z fallback', () => {
    const grid: RouteGrid = {
      cols: 5,
      rows: 5,
      lat0: 51.5,
      lng0: -0.1,
      latSpan: 0.04,
      lngSpan: 0.04,
      lats: [51.5, 51.51, 51.52, 51.53, 51.54],
      lngs: [-0.1, -0.09, -0.08, -0.07, -0.06],
    };
    // Flat DEM at 100 m with void speckle: every draped point still lands at
    // (100 − base) × zScale and no NaN leaks into the output.
    const heights = new Array(25).fill(100);
    heights[7] = NaN;
    heights[18] = NaN;
    const pts = [
      { x: 0, y: 0, z: 5 },
      { x: 100, y: 0, z: 6 },
      { x: 200, y: 0, z: 7 },
    ];
    const res = computeDrape(pts, heights, grid, { lat0: 51.5, lng0: -0.1, zScale: 2 });
    expect(res.drape).not.toBeNull();
    expect(res.drape![0]).toBeCloseTo((100 - res.base) * 2, 6);
    expect(res.altMin).toBeCloseTo(res.base + 1.2, 9);
    for (const z of res.drape!) expect(Number.isFinite(z)).toBe(true);
  });

  it('returns null drape when the DEM has no usable data', () => {
    // All-void grid: smoothing finds nothing, so keep raw z instead of an
    // identical array that would pointlessly rebuild the scene.
    const grid: RouteGrid = {
      cols: 5,
      rows: 5,
      lat0: 51.5,
      lng0: -0.1,
      latSpan: 0.04,
      lngSpan: 0.04,
      lats: [51.5, 51.51, 51.52, 51.53, 51.54],
      lngs: [-0.1, -0.09, -0.08, -0.07, -0.06],
    };
    const pts = [
      { x: 0, y: 0, z: 5 },
      { x: 100, y: 0, z: 6 },
    ];
    const res = computeDrape(pts, new Array(25).fill(Number.NaN), grid, { lat0: 51.5, lng0: -0.1, zScale: 2 });
    expect(res.drape).toBeNull();
  });

  it('returns null drape for flat rides', () => {
    const grid: RouteGrid = {
      cols: 5,
      rows: 5,
      lat0: 51.5,
      lng0: -0.1,
      latSpan: 0.04,
      lngSpan: 0.04,
      lats: [51.5, 51.51, 51.52, 51.53, 51.54],
      lngs: [-0.1, -0.09, -0.08, -0.07, -0.06],
    };
    const flat = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ];
    const res = computeDrape(flat, new Array(25).fill(100), grid, { lat0: 51.5, lng0: -0.1, zScale: 2 });
    expect(res.drape).toBeNull();
    expect(res.altMin).toBeCloseTo(res.base + 1.2, 9);
  });

  it('builds a terrain bed when a DEM grid is supplied', () => {
    const grid = computeGrid(hill)!;
    const heights = gridSampleCoords(grid).lat.map(() => 100);
    const build = buildRoute3D({ coords: hill, elevations: hillElevations, terrain: { grid, heights } });
    expect(build.terrainVerts).not.toBeNull();
    expect(build.terrainVerts!.count).toBe(grid.cols * grid.rows);
    expect(build.terrainVerts!.positions.length).toBe(grid.cols * grid.rows * 3);
    expect(build.terrainVerts!.colors.length).toBe(build.terrainVerts!.positions.length);
  });

  it('falls back to bilinear DEM when route elevations are missing', () => {
    const grid = computeGrid(hill)!;
    const { lat } = gridSampleCoords(grid);
    // South-to-north DEM ramp (100 → 160 m) so the draped path gets relief.
    const heights = lat.map((_, i) => 100 + (i / Math.max(1, lat.length - 1)) * 60);
    const build = buildRoute3D({ coords: hill, terrain: { grid, heights } });
    expect(build.path[0].elevation).toBeGreaterThanOrEqual(100);
    expect(build.path[0].elevation).toBeLessThanOrEqual(160);
    expect(build.path[0].z).toBe(0); // lowest sampled elevation is the base
    // Climbs northward with vertical exaggeration (> raw 60 m span).
    for (let i = 1; i < build.path.length; i++) {
      expect(build.path[i].z).toBeGreaterThanOrEqual(build.path[i - 1].z);
    }
    expect(build.path[build.path.length - 1].z).toBeGreaterThan(60);
  });

  it('returns an empty build for empty input', () => {
    const build = buildRoute3D({ coords: [] });
    expect(build.path.length).toBe(0);
    expect(build.terrainVerts).toBeNull();
  });
});

describe('colour ramps', () => {
  it('hexToRgb decodes 0xRRGGBB into 0..1', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#0000ff')[2]).toBeCloseTo(1, 5);
  });

  it('ramp endpoints match their hex stops', () => {
    const [t0, c0] = ELEVATION_RAMP[0];
    const [, cn] = GRADE_RAMP[GRADE_RAMP.length - 1];
    expect(elevationColor(t0)).toEqual(hexToRgb(c0));
    expect(gradeColor(1)).toEqual(hexToRgb(cn));
  });

  it('pointColor maps flat sections to green in slope mode', () => {
    const flat = { x: 0, y: 0, z: 0, distKm: 0, slopePct: 0, elevation: 10 };
    expect(pointColor(flat, 'slope', 0, 100)).toEqual(hexToRgb(GRADE_RAMP[0][1]));
    // Max slope saturates at GRADE_SCALE %.
    const steep = { x: 1, y: 0, z: 10, distKm: 0.01, slopePct: GRADE_SCALE, elevation: 10 };
    expect(pointColor(steep, 'slope', 0, 100)).toEqual(hexToRgb(GRADE_RAMP[GRADE_RAMP.length - 1][1]));
  });

  it('slopeColor renders descents blue instead of flat green', () => {
    expect(slopeColor(-GRADE_SCALE)).toEqual(hexToRgb(DESCENT_COLOR));
    expect(slopeColor(0)).toEqual(hexToRgb(GRADE_RAMP[0][1]));
    // pointColor follows suit for a downhill point.
    const down = { x: 0, y: 0, z: 0, distKm: 0, slopePct: -8, elevation: 10 };
    const [r, g, b] = pointColor(down, 'slope', 0, 100);
    const [br, , bb] = hexToRgb(DESCENT_COLOR);
    expect(r).toBeGreaterThan(br * 0.5);
    expect(b).toBeGreaterThan(bb * 0.5);
    expect(g).toBeLessThan(0.9);
  });

  it('buildRoute3D tracks minSlopePct for the legend', () => {
    const downhill: [number, number][] = [
      [51.50898, -0.1],
      [51.5, -0.1],
    ];
    const build = buildRoute3D({ coords: downhill, elevations: [50, 0] });
    expect(build.minSlopePct).toBeLessThan(0);
    expect(build.minSlopePct).toBeCloseTo(-5, 1);
  });

  it('steepestKm finds the ~5% hill over its 1 km window', () => {
    // 1.2 km climb gaining 60 m (≈5%): two 600 m legs.
    const coords: [number, number][] = [
      [51.5, -0.1],
      [51.50539, -0.1],
      [51.51078, -0.1],
    ];
    const build = buildRoute3D({ coords, elevations: [0, 30, 60] });
    const s = steepestKm(build.path);
    expect(s).not.toBeNull();
    expect(s!.avgGradePct).toBeCloseTo(5, 0);
    expect(s!.endKm - s!.startKm).toBeGreaterThanOrEqual(1);
    expect(s!.gainM).toBeCloseTo(60, 0);
  });

  it('steepestKm returns null for short or flat routes', () => {
    const short = buildRoute3D({
      coords: [
        [51.5, -0.1],
        [51.5005, -0.1],
      ],
      elevations: [10, 12],
    });
    expect(steepestKm(short.path)).toBeNull();
    const flat = buildRoute3D({ coords: hill, elevations: [10, 10] });
    expect(steepestKm(flat.path)).toBeNull();
  });

  it('pointColor maps the lowest elevation to the ramp start', () => {
    const low = { x: 0, y: 0, z: 0, distKm: 0, slopePct: 0, elevation: 0 };
    expect(pointColor(low, 'elevation', 0, 100)).toEqual(hexToRgb(ELEVATION_RAMP[0][1]));
  });
});

describe('parseOverlayHoverKm', () => {
  it('accepts finite km labels, rejects anything else', () => {
    expect(parseOverlayHoverKm(12.3)).toBe(12.3);
    expect(parseOverlayHoverKm(0)).toBe(0);
    expect(parseOverlayHoverKm('12.3')).toBeNull();
    expect(parseOverlayHoverKm(NaN)).toBeNull();
    expect(parseOverlayHoverKm(-1)).toBeNull();
    expect(parseOverlayHoverKm(undefined)).toBeNull();
  });
});