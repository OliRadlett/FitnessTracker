'use client';

import type { ReplayCamMode } from '@/lib/director';

export type TerrainState = 'off' | 'loading' | 'on' | 'failed';
export type ImageryState = 'off' | 'loading' | 'on' | 'failed';

const CAM_MODES: ReplayCamMode[] = ['auto', 'orbit', 'chase', 'drone', 'cockpit', 'flyby', 'cinematic'];

function camTitle(m: ReplayCamMode): string {
  switch (m) {
    case 'auto':
      return 'Dynamic camera — picks the best angle for the terrain';
    case 'orbit':
      return 'Free orbit camera';
    case 'chase':
      return 'Follow behind the rider';
    case 'drone':
      return 'Elevated trailing drone';
    case 'cockpit':
      return 'Rider point of view';
    case 'flyby':
      return 'Cinematic fly-by orbit';
    case 'cinematic':
      return 'Cinematic director — scripted flyover then chase';
  }
}

export interface ReplayToolbarProps {
  camMode: ReplayCamMode;
  setCamMode: (m: ReplayCamMode) => void;
  showBroadcast: boolean;
  setShowBroadcast: (v: (b: boolean) => boolean) => void;
  tourAvailable: boolean;
  tour: boolean;
  setTour: (v: (b: boolean) => boolean) => void;
  terrainToggleable: boolean;
  terrainState: TerrainState;
  toggleTerrain: () => void;
  imageryState: ImageryState;
  toggleImagery: () => void;
  resetView: () => void;
  takePoster: () => void;
  takeClip: () => void;
  photo: boolean;
  setPhoto: (v: (b: boolean) => boolean) => void;
}

/**
 * Theater toolbar: camera-mode selector, HUD/tour toggles, terrain + imagery
 * switches, and capture buttons. Purely presentational — all scene ownership
 * stays in Replay3D.
 */
export function ReplayToolbar(p: ReplayToolbarProps) {
  return (
    <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1 [.photo_&]:hidden">
      <div className="flex items-center rounded border border-surface-light" role="group" aria-label="Camera mode">
        {CAM_MODES.map((m) => (
          <button
            key={m}
            onClick={() => p.setCamMode(m)}
            aria-pressed={p.camMode === m}
            title={camTitle(m)}
            className={`rounded px-2 py-1 min-h-[44px] sm:min-h-[36px] min-w-[44px] sm:min-w-[36px] text-[11px] capitalize transition-colors ${
              p.camMode === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <button
        onClick={() => p.setShowBroadcast((b) => !b)}
        aria-pressed={p.showBroadcast}
        title="Toggle broadcast HUD"
        className={`rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] transition-colors hover:bg-surface-light/40 ${
          p.showBroadcast ? 'bg-accent/20 text-accent' : 'text-muted'
        }`}
      >
        HUD
      </button>
      {p.tourAvailable && (
        <button
          onClick={() => p.setTour((t) => !t)}
          aria-pressed={p.tour}
          title="Cinematic tour of this ride's highlights"
          className={`rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] transition-colors hover:bg-surface-light/40 ${
            p.tour ? 'bg-accent/20 text-accent' : 'text-muted'
          }`}
        >
          {p.tour ? 'Touring' : 'Tour'}
        </button>
      )}
      {p.terrainToggleable && (
        <button
          onClick={p.toggleTerrain}
          disabled={p.terrainState === 'loading'}
          title="Drape over real DEM terrain"
          className={`rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] transition-colors hover:bg-surface-light/40 disabled:opacity-50 ${
            p.terrainState === 'on' ? 'bg-accent/20 text-accent' : 'text-muted'
          }`}
        >
          {p.terrainState === 'on'
            ? 'Terrain'
            : p.terrainState === 'loading'
              ? 'Loading…'
              : p.terrainState === 'failed'
                ? 'Retry'
                : 'Terrain'}
        </button>
      )}
      {p.terrainState === 'on' && (
        <button
          onClick={p.toggleImagery}
          disabled={p.imageryState === 'loading'}
          title="Satellite imagery over the terrain"
          className={`rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] transition-colors hover:bg-surface-light/40 disabled:opacity-50 ${
            p.imageryState === 'on' ? 'bg-accent/20 text-accent' : 'text-muted'
          }`}
        >
          {p.imageryState === 'on'
            ? 'Satellite'
            : p.imageryState === 'loading'
              ? 'Loading…'
              : p.imageryState === 'failed'
                ? 'Retry'
                : 'Satellite'}
        </button>
      )}
      <span className="flex-1" />
      <button onClick={p.resetView} title="Reset to overview" className="rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] text-muted transition-colors hover:bg-surface-light/40">Reset</button>
      <button onClick={p.takePoster} title="Download PNG poster" className="rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] text-muted transition-colors hover:bg-surface-light/40">Poster</button>
      <button onClick={p.takeClip} title="Record 6s webm clip" className="rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] text-muted transition-colors hover:bg-surface-light/40">Clip</button>
      <button
        onClick={() => p.setPhoto((x) => !x)}
        aria-pressed={p.photo}
        title="Photo mode — hide UI for a clean capture"
        className={`rounded border border-surface-light px-2 py-1 min-h-[44px] sm:min-h-[36px] text-[11px] transition-colors hover:bg-surface-light/40 ${
          p.photo ? 'bg-accent/20 text-accent' : 'text-muted'
        }`}
      >
        {p.photo ? 'Exit' : 'Photo'}
      </button>
    </div>
  );
}
