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
  const [trimmedUrl, setTrimmedUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [showTrimmed, setShowTrimmed] = useState(false);

  const fetchStreamUrl = async () => {
    setLoadingStream(true);
    setStreamError(null);
    setStreamUrl(null);
    try {
      const res = await getVideoStreamUrl(authFetch, video.id);
      setStreamUrl(res.url);
    } catch (err: any) {
      setStreamError(err.message ?? 'Failed to load video');
    } finally {
      setLoadingStream(false);
    }
  };

  // Fetch trimmed URL when available
  useEffect(() => {
    if (video.trimmed_r2_key && !trimmedUrl) {
      // The trimmed video uses a different endpoint — we need to fetch its stream URL
      // by calling the same stream-url endpoint but with the trimmed key
      // For now, we'll use the same video ID since the trimmed key is stored on the model
      // and the backend can resolve it. If the API doesn't support this yet,
      // we'll fall back to the original.
      getVideoStreamUrl(authFetch, video.id)
        .then((res) => {
          // TODO: When backend supports trimmed stream URLs, use a separate endpoint
          // For now, the trimmed URL is the same since we store it on the model
          setTrimmedUrl(res.url);
        })
        .catch(() => {});
    }
  }, [video.trimmed_r2_key, authFetch]);

  useEffect(() => {
    if (video.r2_key && !streamUrl && !streamError && !loadingStream) {
      fetchStreamUrl();
    }
  }, [video, authFetch]);

  const activeUrl = showTrimmed && trimmedUrl ? trimmedUrl : streamUrl;
  const hasTrimmed = !!video.trimmed_r2_key;

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

      {/* Trim toggle */}
      {hasTrimmed && streamUrl && (
        <div className="absolute top-2 left-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowTrimmed(!showTrimmed);
            }}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              showTrimmed
                ? 'bg-accent/80 text-white'
                : 'bg-surface/80 text-muted hover:text-white'
            }`}
          >
            {showTrimmed ? 'Trimmed' : 'Original'}
          </button>
        </div>
      )}

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
      ) : loadingStream || !activeUrl ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-muted text-sm">Loading video…</div>
        </div>
      ) : (
        <video
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
