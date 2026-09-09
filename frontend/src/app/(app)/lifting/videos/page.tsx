'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { LiftVideo, LiftingSession, PersonalRecord } from '@/lib/api';
import { deleteLiftVideo } from '@/lib/api/lifting';
import { Card } from '@/components/ui/Card';
import { VideoEmbed } from '@/components/lifting/VideoEmbed';
import { VideoGalleryModal } from '@/components/lifting/VideoGalleryModal';
import { LiftVideoForm } from '@/components/lifting/LiftVideoForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { usePageTitle } from '@/lib/usePageTitle';

export default function VideosPage() {
  usePageTitle('Videos');
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const [exerciseFilter, setExerciseFilter] = useState('');
  const [afterFilter, setAfterFilter] = useState('');
  const [beforeFilter, setBeforeFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<LiftVideo | null>(null);

  const queryParams = new URLSearchParams();
  queryParams.set('limit', '100');
  if (exerciseFilter) queryParams.set('exercise_name', exerciseFilter);
  if (afterFilter) queryParams.set('after', afterFilter);
  if (beforeFilter) queryParams.set('before', beforeFilter);

  const { data: videos = [], isLoading } = useQuery<LiftVideo[]>({
    queryKey: ['lift-videos', exerciseFilter, afterFilter, beforeFilter],
    queryFn: () => authFetch<LiftVideo[]>(`/api/v1/lifting/videos/?${queryParams}`),
    staleTime: 30_000,
  });

  const { data: sessions = [] } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions?limit=50'),
    staleTime: 60_000,
    enabled: showAddForm,
  });

  const { data: prs = [] } = useQuery<PersonalRecord[]>({
    queryKey: ['personal-records'],
    queryFn: () => authFetch<PersonalRecord[]>('/api/v1/lifting/prs?limit=50'),
    staleTime: 60_000,
    enabled: showAddForm,
  });

  const deleteMutation = useMutation({
    mutationFn: (videoId: string) => deleteLiftVideo(authFetch, videoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lift-videos'] }),
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const hasFilters = exerciseFilter || afterFilter || beforeFilter;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-white">📹 Videos</h1>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Add Video
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Exercise filter */}
        <input
          type="text"
          value={exerciseFilter}
          onChange={(e) => setExerciseFilter(e.target.value)}
          placeholder="Exercise…"
          className="px-3 py-1.5 text-sm bg-surface border border-surface-light rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {/* Date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={afterFilter}
            onChange={(e) => setAfterFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-surface border border-surface-light rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="text-muted">→</span>
          <input
            type="date"
            value={beforeFilter}
            onChange={(e) => setBeforeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-surface border border-surface-light rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {hasFilters && (
          <button
            onClick={() => {
              setExerciseFilter('');
              setAfterFilter('');
              setBeforeFilter('');
            }}
            className="text-sm text-muted hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {/* Video grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 bg-surface rounded-xl border border-surface-light/50 animate-pulse" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <EmptyState
          icon="📹"
          title={hasFilters ? 'No videos match filters' : 'No videos yet'}
          description={
            hasFilters
              ? 'Try adjusting your filters or add a video.'
              : 'Add a lift video — upload a recording of your set.'
          }
          action={
            !hasFilters
              ? { label: '+ Add Video', onClick: () => setShowAddForm(true) }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((video) => (
            <Card key={video.id} className="p-0 overflow-hidden">
              {/* Preview thumbnail */}
              <div
                className="aspect-video bg-surface-light relative group cursor-pointer"
                onClick={() => setPreviewVideo(video)}
              >
                <VideoEmbed video={video} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="text-white text-sm font-medium bg-black/60 px-3 py-1 rounded-lg">Preview</span>
                </div>
              </div>

              {/* Metadata */}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white truncate max-w-[200px]">
                    {video.exercise_name || 'Uncategorized'}
                  </p>
                  <Badge variant="lifting">Uploaded</Badge>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{new Date(video.created_at).toLocaleDateString()}</span>
                  {video.duration_seconds && (
                    <>
                      <span>·</span>
                      <span>{Math.round(video.duration_seconds)}s</span>
                    </>
                  )}
                  {video.size_bytes && (
                    <>
                      <span>·</span>
                      <span>{(video.size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                    </>
                  )}
                </div>

                {video.notes && (
                  <p className="text-xs text-muted truncate">{video.notes}</p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  {video.lifting_session_id && (
                    <a
                      href={`/lifting?session=${video.lifting_session_id}`}
                      className="text-xs text-accent/70 hover:text-accent"
                    >
                      Session →
                    </a>
                  )}
                  <div className="flex-1" />
                  {confirmDeleteId === video.id ? (
                    <>
                      <button
                        onClick={() => {
                          deleteMutation.mutate(video.id);
                          setConfirmDeleteId(null);
                        }}
                        disabled={deleteMutation.isPending}
                        className="text-xs text-white bg-warning/80 hover:bg-warning px-2 py-0.5 rounded disabled:opacity-50"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-muted hover:text-white px-2 py-0.5"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(video.id)}
                      className="text-xs text-muted hover:text-warning transition-colors"
                      title="Delete video"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add Video Form */}
      <LiftVideoForm
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        sessions={sessions}
        prs={prs}
      />

      {/* Full preview modal */}
      {previewVideo && (
        <VideoGalleryModal
          title={previewVideo.exercise_name || 'Video preview'}
          videos={[previewVideo]}
          open={!!previewVideo}
          onClose={() => setPreviewVideo(null)}
        />
      )}
    </div>
  );
}
