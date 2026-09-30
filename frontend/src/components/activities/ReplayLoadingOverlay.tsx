'use client';

import type { ImageryState, TerrainState } from './ReplayToolbar';

export interface ReplayLoadingOverlayProps {
  sceneReady: boolean;
  terrainState: TerrainState;
  imageryState: ImageryState;
  failed: boolean;
  loadProgress: { loaded: number; total: number } | null;
}

/**
 * Tile-loading overlay: spinner + determinate progress while terrain/imagery
 * tiles fetch. Fades in/out; the visual suite waits on its test hook.
 * Purely presentational — all loading state lives in Replay3D.
 */
export function ReplayLoadingOverlay(p: ReplayLoadingOverlayProps) {
  const loading =
    (!p.sceneReady || p.terrainState === 'loading' || p.imageryState === 'loading') && !p.failed;
  const progress = p.loadProgress;
  return (
    <div
      data-testid="replay-loading-overlay"
      className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[2px] transition-opacity duration-700 [.photo_&]:hidden ${
        loading ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={loading ? undefined : true}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        <p className="text-xs font-medium text-muted">
          {!p.sceneReady
            ? 'Preparing 3D view…'
            : p.terrainState === 'loading'
              ? progress && progress.total > 0
                ? `Loading terrain (${progress.loaded}/${progress.total} tiles)…`
                : 'Loading terrain…'
              : p.imageryState === 'loading'
                ? progress && progress.total > 0
                  ? `Loading satellite (${progress.loaded}/${progress.total} tiles)…`
                  : 'Loading satellite…'
                : ''}
        </p>
        {/* Indeterminate spinner for prep; determinate progress bar for tiles */}
        {progress && progress.total > 0 ? (
          <div className="h-1 w-32 overflow-hidden rounded-full bg-surface-light">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }}
            />
          </div>
        ) : (
          <div className="flex gap-1.5">
            <span className={`h-1 w-8 rounded-full transition-colors duration-300 ${p.terrainState === 'on' ? 'bg-accent' : p.terrainState === 'loading' ? 'bg-accent/50' : 'bg-surface-light'}`} />
            <span className={`h-1 w-8 rounded-full transition-colors duration-300 ${p.imageryState === 'on' ? 'bg-accent' : p.imageryState === 'loading' ? 'bg-accent/50' : 'bg-surface-light'}`} />
          </div>
        )}
      </div>
    </div>
  );
}
