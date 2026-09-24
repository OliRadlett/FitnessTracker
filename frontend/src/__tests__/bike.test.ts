import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MAX_LEAN,
  bikeOrientationMatrix,
  bikePoseQuaternion,
  leanFromCurvature,
} from '@/lib/bike';

describe('bikeOrientationMatrix', () => {
  it('maps model axes into the rig frame (nose +Z → forward +X, up +Y → +Z)', () => {
    const m = bikeOrientationMatrix();
    const map = (x: number, y: number, z: number) => {
      const out = new THREE.Vector3(x, y, z).applyMatrix4(m);
      return [out.x, out.y, out.z];
    };
    expect(map(1, 0, 0)).toEqual([0, 1, 0]); // model width +X → rig +Y
    expect(map(0, 1, 0)).toEqual([0, 0, 1]); // model up +Y → rig +Z
    expect(map(0, 0, 1)).toEqual([1, 0, 0]); // model nose +Z → rig +X
    // must be a proper rotation, not a reflection
    expect(m.determinant()).toBeCloseTo(1, 6);
  });
});

describe('bikePoseQuaternion', () => {
  it('points forward along +X with world up +Z when heading east', () => {
    const q = bikePoseQuaternion(new THREE.Vector3(1, 0, 0));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(fwd.x).toBeCloseTo(1, 6);
    expect(fwd.y).toBeCloseTo(0, 6);
    expect(up.z).toBeCloseTo(1, 6);
  });

  it('yaws to a northbound heading and keeps +Z up', () => {
    const q = bikePoseQuaternion(new THREE.Vector3(0, 1, 0));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(fwd.y).toBeCloseTo(1, 6);
    expect(up.z).toBeCloseTo(1, 6);
  });

  it('leans up toward the rider-left (+Y) for a positive lean heading east', () => {
    const q = bikePoseQuaternion(new THREE.Vector3(1, 0, 0), 0.3);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(up.y).toBeGreaterThan(0.1);
  });

  it('pitches on a 3D forward (grade included)', () => {
    const q = bikePoseQuaternion(new THREE.Vector3(1, 0, 1).normalize());
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(fwd.z).toBeGreaterThan(0.5);
  });
});

describe('leanFromCurvature', () => {
  it('is zero with no yaw or no speed', () => {
    expect(leanFromCurvature(8, 0)).toBe(0);
    expect(leanFromCurvature(0, 0.2)).toBe(0);
  });

  it('grows with speed and clamps at ±MAX_LEAN', () => {
    expect(leanFromCurvature(8, 1)).toBeGreaterThan(leanFromCurvature(3, 1));
    expect(leanFromCurvature(30, 5)).toBeCloseTo(MAX_LEAN, 6);
    expect(leanFromCurvature(-30, 5)).toBeCloseTo(-MAX_LEAN, 6);
  });

  it('is safe for non-finite input', () => {
    expect(leanFromCurvature(NaN, 1)).toBe(0);
    expect(leanFromCurvature(5, Infinity)).toBe(0);
  });
});
