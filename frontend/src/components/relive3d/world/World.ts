import type { PoseName } from '@/lib/relive3d/types';

export interface CameraState {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface GhostPosition {
  lat: number;
  lng: number;
  alt: number;
}

export interface World {
  mount(): Promise<void>;
  setRider(index: number): void;
  setGhost(position: GhostPosition | null): void;
  focusRider(index: number): void;
  setPose(pose: PoseName, animate: boolean): void;
  setFollow(enabled: boolean): void;
  whenIdle(): Promise<void>;
  getCamera(): CameraState;
  dispose(): void;
}
