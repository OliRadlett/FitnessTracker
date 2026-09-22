'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LiftVideo } from '@/lib/api';
import { useAuthFetch, getVideoStreamUrl } from '@/lib/api';

type Variant = 'original' | 'trimmed' | 'overlay';

interface VideoEmbedProps {
  video: LiftVideo;
  autoPlay?: boolean;
}

const VARIANT_LABELS: Record<Variant, string> = {
  original: 'Original',
  trimmed: 'Trimmed',
  overlay: 'Pose',
};

export function VideoEmbed({ video, autoPlay = false }: VideoEmbedProps) {
  const { authFetch } = useAuthFetch();
  const [urls, setUrls] = useState<Partial<Record<Variant, string>>>({});
  // Default to the plain video — the overlay is opt-in so the user can just
  // watch their lift normally.
  const [variant, setVariant] = useState<Variant>('original');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const available: Variant[] = ['original'];
  if (video.trimmed_r2_key) available.push('trimmed');
  if (video.overlay_r2_key) available.push('overlay');

  const load = useCallback(
    async (v: Variant) => {
      setLoading(true);
      setError(null);
      try {
        const res = await getVideoStreamUrl(authFetch, video.id, v);
        setUrls((prev) => ({ ...prev, [v]: res.url }));
      } catch (err: any) {
        setError(err.message ?? 'Failed to load video');
      } finally {
        setLoading(false);
      }
    },
    [authFetch, video.id],
  );

  useEffect(() => {
    if (video.r2_key && !urls[variant] && !loading) {
      load(variant);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.r2_key, variant]);

  const activeUrl = urls[variant];

  return (
    <div className="aspect-video bg-surface-light rounded-lg overflow-hidden relative">
      {/* Processing status badge */}
      {video.analysis_status && video.analysis_status !== 'completed' && (
        <div className="absolute top-2 right-2 z-10">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              video.analysis_status === 'processing'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : video.analysis_status === 'failed'
                  ? 'bg-warning/20 text-warning border border-warning/30'
                  : 'bg-surface/80 text-muted border border-surface-light'
            }`}
          >
            {video.analysis_status === 'processing' && (
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            )}
            {video.analysis_status === 'processing'
              ? 'Processing…'
              : video.analysis_status === 'failed'
                ? 'Failed'
                : 'Queued'}
          </span>
        </div>
      )}

      {/* Variant toggle — Original / Trimmed / Pose overlay */}
      {available.length > 1 && (
        <div className="absolute top-2 left-2 z-10 flex gap-1">
          {available.map((v) => (
            <button
              key={v}
              onClick={(e) => {
                e.stopPropagation();
                setVariant(v);
              }}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                variant === v
                  ? 'bg-accent/80 text-white'
                  : 'bg-surface/80 text-muted hover:text-foreground'
              }`}
            >
              {VARIANT_LABELS[v]}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
          <p className="text-sm text-warning">⚠ {error}</p>
          <button
            onClick={() => load(variant)}
            className="text-xs px-3 py-1 bg-surface text-muted hover:text-foreground rounded"
          >
            Retry
          </button>
        </div>
      ) : loading || !activeUrl ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-muted text-sm">Loading video…</div>
        </div>
      ) : (
        <video
          key={variant}
          src={activeUrl}
          controls
          className="w-full h-full object-contain"
          preload="metadata"
          autoPlay={autoPlay}
        />
      )}
    </div>
  );
}
