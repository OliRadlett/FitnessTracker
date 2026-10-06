import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CLOUD_LIT,
  CLOUD_SHADE,
  cloudFactors,
  cloudWindVec,
  createCloudDome,
  updateCloudDome,
} from '@/lib/clouds';

describe('cloudFactors', () => {
  it('keeps fair-weather wisps on clear days', () => {
    const f = cloudFactors(40, null);
    expect(f.coverage).toBeGreaterThan(0);
    expect(f.coverage).toBeLessThan(0.5);
    expect(f.opacity).toBeGreaterThan(0.5);
    expect(f.silver).toBeGreaterThan(0.5);
  });

  it('covers the sky when the ride weather is wet', () => {
    const rain = cloudFactors(20, { overcast: false, rainy: true, snowy: false, foggy: false });
    const clear = cloudFactors(20, null);
    expect(rain.coverage).toBeGreaterThan(clear.coverage);
    expect(rain.coverage).toBeGreaterThan(0.85);
    expect(rain.silver).toBeLessThan(clear.silver);
  });

  it('warms lit clouds near sunrise and cools them at noon', () => {
    expect(cloudFactors(0, null).warmth).toBeGreaterThan(cloudFactors(40, null).warmth);
    expect(cloudFactors(40, null).warmth).toBe(0);
  });

  it('treats non-finite elevation as night', () => {
    const f = cloudFactors(Number.NaN, null);
    expect(f.silver).toBe(0);
  });
});

describe('cloudWindVec', () => {
  it('drifts faintly on calm days and scales with wind', () => {
    const calm = cloudWindVec(null, null);
    const windy = cloudWindVec(30, 'W');
    expect(Math.hypot(...windy)).toBeGreaterThan(Math.hypot(...calm));
  });

  it('flows away from the reported from-direction', () => {
    // Westerly ("from the west") pushes clouds east (+x).
    const [x] = cloudWindVec(20, 'W');
    expect(x).toBeGreaterThan(0);
  });
});

describe('createCloudDome / updateCloudDome', () => {
  it('builds a transparent background shell with all uniforms', () => {
    const mesh = createCloudDome(1000);
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    for (const k of ['uSunDir', 'uTime', 'uCoverage', 'uOpacity', 'uSilver', 'uNightFactor', 'uWarmth', 'uBaseColor', 'uDarkColor', 'uFogColor', 'uWind']) {
      expect(mat.uniforms[k]).toBeDefined();
    }
  });

  it('pushes state into uniforms without rebuilding anything', () => {
    const mesh = createCloudDome(1000);
    updateCloudDome(mesh, {
      sunDirection: [0, 0, 1],
      baseColor: CLOUD_LIT,
      darkColor: CLOUD_SHADE,
      fog: '#101a2e',
      nightFactor: 0.2,
      coverage: 0.6,
      opacity: 0.8,
      silver: 0.5,
      warmth: 0.3,
      wind: [0.01, 0.005],
    });
    const u = (mesh.material as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown }>;
    expect((u.uCoverage.value as number)).toBe(0.6);
    expect((u.uWarmth.value as number)).toBe(0.3);
    expect((u.uWind.value as THREE.Vector2).x).toBeCloseTo(0.01, 6);
  });
});
