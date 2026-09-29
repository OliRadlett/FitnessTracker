/**
 * Ghost + "Race Yourself" overlay management for the Relive 3D viewer
 * (extracted from Replay3D).
 *
 * Overlays are patched onto the live scene (no full rebuild) when the ghost
 * pick or race set changes — previously both were scene-effect deps, so every
 * toggle tore down the renderer and refetched terrain. The component's RAF
 * tick reads the current overlays through a shared ref (see `ReplayOverlays`).
 */

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createBikeRig, type BikeRig } from '@/lib/bike';
import { speedColor, type RaceRide } from '@/lib/raceRides';
import type { ReplayBuildResult, ReplayPoint } from '@/lib/replay';

// ── Race overlays ────────────────────────────────────────────────────────────

export interface RaceOverlay {
  ride: RaceRide;
  line: Line2;
  mat: LineMaterial;
  marker: THREE.Mesh;
  markerMat: THREE.MeshBasicMaterial;
}

/**
 * Build coloured traces + animated markers for other rides. Entries pair each
 * ride with its own marker so a skipped ride can never shift markers onto the
 * wrong ride. Detached — the caller adds `line` + `marker` to the scene.
 */
export function buildRaceOverlays(
  race: RaceRide[] | null | undefined,
  w: number,
  h: number,
): RaceOverlay[] {
  const entries: RaceOverlay[] = [];
  if (!race || race.length === 0) return entries;
  // max speed across all rides for the speed-colour ramp
  let maxSpeed = 1;
  for (const ride of race) for (const p of ride.points) if (p.speed > maxSpeed) maxSpeed = p.speed;
  for (const ride of race) {
    if (ride.points.length < 2) continue;
    const rg = new LineGeometry();
    const rp: number[] = [];
    const rc: number[] = [];
    for (const p of ride.points) {
      rp.push(p.x, p.y, p.z + 0.5);
      // Colour by speed, tinted toward the ride colour
      const [sr, sg, sb] = speedColor(p.speed, maxSpeed);
      const rideR = new THREE.Color(ride.color).r;
      const rideG = new THREE.Color(ride.color).g;
      const rideB = new THREE.Color(ride.color).b;
      rc.push(sr * 0.5 + rideR * 0.5, sg * 0.5 + rideG * 0.5, sb * 0.5 + rideB * 0.5);
    }
    rg.setPositions(rp);
    rg.setColors(rc);
    const rm = new LineMaterial({ linewidth: 2, vertexColors: true, transparent: true, opacity: 0.65 });
    rm.resolution.set(w, h);
    const rl = new Line2(rg, rm);
    rl.visible = false; // shown only in orbit/overview

    // Animated marker: a small cone at the ride's current position
    const mkGeo = new THREE.ConeGeometry(1.2, 3.5, 8);
    const mkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ride.color) });
    const mk = new THREE.Mesh(mkGeo, mkMat);
    mk.rotation.x = Math.PI / 2; // point along +Z (up in our frame)
    mk.visible = false;
    entries.push({ ride, line: rl, mat: rm, marker: mk, markerMat: mkMat });
  }
  return entries;
}

export function disposeRaceOverlays(entries: RaceOverlay[]): void {
  for (const e of entries) {
    e.line.geometry.dispose();
    e.mat.dispose();
    e.marker.geometry.dispose();
    e.markerMat.dispose();
  }
}

// ── Ghost overlay ────────────────────────────────────────────────────────────

export interface GhostOverlay {
  /** replay points in the shared frame, or null when no ghost is picked */
  points: ReplayPoint[] | null;
  group: THREE.Group;
  dir: THREE.Vector3;
  rig: BikeRig | null;
  /** set when the overlay is replaced/torn down so late rig loads bail out */
  cancelled: boolean;
}

/** Create the ghost group (translucent bike loads async via `attachGhostRig`). */
export function createGhostOverlay(points: ReplayPoint[] | null): GhostOverlay {
  const group = new THREE.Group();
  group.visible = false;
  return { points, group, dir: new THREE.Vector3(1, 0, 0), rig: null, cancelled: false };
}

/** Load the translucent ghost rig unless the overlay was cancelled meanwhile. */
export async function attachGhostRig(ov: GhostOverlay): Promise<void> {
  if (!ov.points) return;
  try {
    const rig = await createBikeRig({ ghost: true });
    if (ov.cancelled) {
      rig.dispose();
      return;
    }
    ov.group.add(rig.object);
    ov.rig = rig;
  } catch {
    /* ghost model optional — the path line still tells the story */
  }
}

export function disposeGhostOverlay(ov: GhostOverlay): void {
  ov.cancelled = true;
  ov.rig?.dispose();
  ov.rig = null;
}

// ── Shared overlay state (read per-frame by the tick) ────────────────────────

export interface GhostPick {
  build: ReplayBuildResult;
  name?: string;
}

export interface ReplayOverlays {
  raceEntries: RaceOverlay[];
  ghost: GhostOverlay;
  /** build identity the ghost overlay was made from (skip-noop updates) */
  ghostKey: ReplayBuildResult | null;
  /** race array identity the entries were made from (skip-noop updates) */
  raceKey: RaceRide[] | null;
}
