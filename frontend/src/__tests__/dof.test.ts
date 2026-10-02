import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DofShader, dofSettingsFor, syncDofTarget } from '@/lib/dof';

describe('dofSettingsFor', () => {
  it('goes shallow in orbit/cinematic and deep on the move', () => {
    const shallow = dofSettingsFor('orbit')!;
    const cinematic = dofSettingsFor('cinematic')!;
    const chase = dofSettingsFor('chase')!;
    expect(shallow.range).toBeLessThan(chase.range);
    expect(shallow.maxBlur).toBeGreaterThan(chase.maxBlur);
    expect(cinematic).toEqual(shallow);
    expect(dofSettingsFor('drone')).toEqual(chase);
    expect(dofSettingsFor('flyby')).toEqual(chase);
  });

  it('stays fully sharp in the cockpit', () => {
    expect(dofSettingsFor('cockpit')).toBeNull();
  });

  it('keeps tour shots deep so the action stays readable', () => {
    expect(dofSettingsFor('shot')).toEqual(dofSettingsFor('chase'));
  });

  it('keeps sane positive bounds', () => {
    for (const m of ['orbit', 'chase', 'drone', 'cockpit', 'flyby', 'cinematic'] as const) {
      const s = dofSettingsFor(m);
      if (s) {
        expect(s.range).toBeGreaterThan(0);
        expect(s.maxBlur).toBeGreaterThan(0);
      }
    }
  });
});

describe('syncDofTarget', () => {
  it('keeps the half-res target and its uniform in lockstep', () => {
    const rt = new THREE.WebGLRenderTarget(2, 2);
    const pass = { uniforms: { uResolution: { value: new THREE.Vector2(0, 0) } } };
    const target = { pass: pass as never, rt };
    syncDofTarget(target, 800, 600, 2);
    expect(rt.width).toBe(800);
    expect(rt.height).toBe(600);
    expect((pass.uniforms.uResolution.value as THREE.Vector2).x).toBe(800);
  });

  it('never collapses to a zero-sized target', () => {
    const rt = new THREE.WebGLRenderTarget(2, 2);
    const pass = { uniforms: { uResolution: { value: new THREE.Vector2(0, 0) } } };
    syncDofTarget({ pass: pass as never, rt }, 0, 0, 1);
    expect(rt.width).toBeGreaterThanOrEqual(2);
    expect(rt.height).toBeGreaterThanOrEqual(2);
  });
});

describe('DofShader', () => {
  it('exposes the uniforms the component drives per frame', () => {
    const keys = ['tDiffuse', 'tDepth', 'uFocus', 'uRange', 'uMaxBlur', 'uResolution', 'uNear', 'uFar'] as const;
    for (const k of keys) {
      expect(DofShader.uniforms[k]).toBeDefined();
    }
    expect(DofShader.uniforms.uNear.value).toBeGreaterThan(0);
  });
});
