'use client';

import React, { useState, useEffect } from 'react';
import type { LiftVideo } from '@/lib/api';
import { useAuthFetch, getVideoStreamUrl } from '@/lib/api';

const EMBED_PATTERNS: { match: RegExp; build: (id: string) => string }[] = [
  {
    match: /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    build: (id: string) => `https://www.youtube.com/embed/${id}?rel=0`,
  },
  {
    match: /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)([0-9]+)/,
    build: (id: string) => `https://player.vimeo.com/video/${id}?title=0&byline=0&badge=0`,
  },
];

export function getVideoEmbedUrl(url: string): string | null {
  for (const { match, build } of EMBED_PATTERNS) {
    const m = url.match(match);
    if (m) return build(m[1]);
  }
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

export function isVimeoUrl(url: string): boolean {
  return /vimeo\.com/.test(url);
}

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
    if (video.source === 'upload' && video.r2_key && !streamUrl && !streamError && !loadingStream) {
      fetchStreamUrl();
    }
  }, [video, authFetch]);

  const embedUrl =
    video.source === 'url' && video.external_url ? getVideoEmbedUrl(video.external_url) : null;

  return (
    <div className="aspect-video bg-surface-light rounded-lg overflow-hidden relative">
      {video.source === 'url' && embedUrl ? (
        <iframe
          src={embedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
          className="w-full h-full border-0"
          title={video.exercise_name ?? 'Lift video'}
          allowFullScreen
        />
      ) : video.source === 'url' && video.external_url ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
          <p className="text-sm text-muted">Unsupported video host.</p>
          <a
            href={video.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover text-sm underline break-all"
          >
            {video.external_url}
          </a>
        </div>
      ) : video.source === 'upload' ? (
        streamError ? (
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
        )
      ) : null}
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
