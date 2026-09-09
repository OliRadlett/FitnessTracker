'use client';

import React, { useState, useEffect } from 'react';
import type { LiftVideo } from '@/lib/api';
import { useAuthFetch, getVideoStreamUrl } from '@/lib/api';

interface VideoEmbedProps {
  video: LiftVideo;
  autoPlay?: boolean;
}

export function VideoEmbed({ video, autoPlay = false }: VideoEmbedProps) {
  const { authFetch } = useAuthFetch();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);

  const fetchStreamUrl = () => {
    setLoadingStream(true);
    setStreamError(null);
    setStreamUrl(null);
    getVideoStreamUrl(authFetch, video.id)
      .then((res) => {
        setStreamUrl(res.url);
        setLoadingStream(false);
      })
      .catch((err) => {
        setStreamError(err.message ?? 'Failed to load video');
        setLoadingStream(false);
      });
  };

  useEffect(() => {
    if (video.r2_key && !streamUrl && !streamError && !loadingStream) {
      fetchStreamUrl();
    }
  }, [video, authFetch]);

  return (
    <div className="aspect-video bg-surface-light rounded-lg overflow-hidden relative">
      {streamError ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
          <p className="text-sm text-warning">⚠ {streamError}</p>
          <button
            onClick={fetchStreamUrl}
            className="text-xs px-3 py-1 bg-surface text-muted hover:text-white rounded"
          >
            Retry
          </button>
        </div>
      ) : loadingStream || !streamUrl ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-muted text-sm">Loading video…</div>
        </div>
      ) : (
        <video
          src={streamUrl}
          controls
          className="w-full h-full object-contain"
          preload="metadata"
          autoPlay={autoPlay}
        />
      )}
    </div>
  );
}

export function VideoChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30"
      title={`${count} strength video${count !== 1 ? 's' : ''}`}
    >
      📹 {count}
    </span>
  );
}
