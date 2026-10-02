import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GodRaysShader, sunScreenPosition } from '@/lib/godrays';

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(55, 1, 0.3, 8000);
  cam.position.set(0, 0, 0);
  cam.lookAt(new THREE.Vector3(0, 0, -1));
  return cam;
}

describe('sunScreenPosition', () => {
  it('centres a dead-ahead sun at full visibility', () => {
    const s = sunScreenPosition(camera(), [0, 0, -1]);
    expect(s.uv[0]).toBeCloseTo(0.5, 3);
    expect(s.uv[1]).toBeCloseTo(0.5, 3);
    expect(s.visible).toBeCloseTo(1, 3);
  });

  it('kills the effect for a sun behind the camera', () => {
    const s = sunScreenPosition(camera(), [0, 0, 1]);
    expect(s.visible).toBe(0);
  });

  it('fades a sun far off the frame edge', () => {
    const ahead = sunScreenPosition(camera(), [0, 0, -1]).visible;
    // Nearly perpendicular: mostly out of frame, heavily faded.
    const edge = sunScreenPosition(camera(), [0.99, 0, -0.14]).visible;
    expect(edge).toBeLessThan(ahead);
    expect(edge).toBeGreaterThanOrEqual(0);
  });
});

describe('GodRaysShader', () => {
  it('exposes the uniforms the component drives per frame', () => {
    const keys = ['tDiffuse', 'uSunUv', 'uIntensity', 'uDensity', 'uDecay', 'uThreshold', 'uExposure'] as const;
    for (const k of keys) {
      expect(GodRaysShader.uniforms[k]).toBeDefined();
    }
    expect(GodRaysShader.uniforms.uThreshold.value).toBeGreaterThan(0);
  });
});
