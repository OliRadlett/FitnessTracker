import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  atmosphereFactors,
  createAtmosphereDome,
  updateAtmosphereDome,
} from '@/lib/sky';

describe('atmosphereFactors', () => {
  it('is clear and sunlit in daylight', () => {
    const f = atmosphereFactors(40, null);
    expect(f.nightFactor).toBe(0);
    expect(f.greyFactor).toBe(0);
    expect(f.sunGlow).toBeCloseTo(1, 6);
  });

  it('is fully night below -8° with no sun glow', () => {
    const f = atmosphereFactors(-18, null);
    expect(f.nightFactor).toBe(1);
    expect(f.sunGlow).toBe(0);
  });

  it('treats non-finite elevation as full night', () => {
    const f = atmosphereFactors(Number.NaN, null);
    expect(f.nightFactor).toBe(1);
    expect(f.sunGlow).toBe(0);
  });

  it('grades grey by weather, worst wins', () => {
    expect(atmosphereFactors(20, { overcast: true, rainy: false, snowy: false, foggy: false }).greyFactor).toBeCloseTo(0.55, 6);
    expect(atmosphereFactors(20, { overcast: false, rainy: true, snowy: false, foggy: false }).greyFactor).toBeCloseTo(0.8, 6);
    expect(atmosphereFactors(20, { overcast: false, rainy: false, snowy: true, foggy: false }).greyFactor).toBeCloseTo(0.7, 6);
    expect(atmosphereFactors(20, { overcast: true, rainy: true, snowy: true, foggy: true }).greyFactor).toBeCloseTo(0.8, 6);
  });

  it('dims the sun glow under cloud', () => {
    const clear = atmosphereFactors(20, null).sunGlow;
    const rainy = atmosphereFactors(20, { overcast: false, rainy: true, snowy: false, foggy: false }).sunGlow;
    expect(rainy).toBeLessThan(clear);
    expect(rainy).toBeGreaterThan(0);
  });
});

describe('createAtmosphereDome / updateAtmosphereDome', () => {
  it('builds a background dome with shader uniforms and no textures', () => {
    const mesh = createAtmosphereDome(1000);
    expect(mesh.renderOrder).toBe(-1);
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.depthWrite).toBe(false);
    for (const k of ['uSunDir', 'uTopColor', 'uHorizonColor', 'uFogColor', 'uNightFactor', 'uGreyFactor', 'uSunGlow']) {
      expect(mat.uniforms[k]).toBeDefined();
    }
  });

  it('pushes state into uniforms without rebuilding anything', () => {
    const mesh = createAtmosphereDome(1000);
    updateAtmosphereDome(mesh, {
      sunDirection: [0, 0, 1],
      skyTop: '#0a1428',
      skyHorizon: '#1b2b46',
      fog: '#101a2e',
      nightFactor: 0.5,
      greyFactor: 0.25,
      sunGlow: 0.75,
    });
    const u = (mesh.material as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown }>;
    expect((u.uNightFactor.value as number)).toBe(0.5);
    expect((u.uSunGlow.value as number)).toBe(0.75);
    expect((u.uSunDir.value as THREE.Vector3).z).toBeCloseTo(1, 6);
    expect((u.uTopColor.value as THREE.Color).getHexString()).toBe('0a1428');
  });
});
