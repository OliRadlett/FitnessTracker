'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { LiftVideo, LiftingSession, PersonalRecord } from '@/lib/api';
import { deleteLiftVideo, processLiftVideo } from '@/lib/api/lifting';
import { Card } from '@/components/ui/Card';
import { VideoEmbed } from '@/components/lifting/VideoEmbed';
import { VideoGalleryModal } from '@/components/lifting/VideoGalleryModal';
import { VideoCompareModal } from '@/components/lifting/VideoCompareModal';
import { VideoEditModal } from '@/components/lifting/VideoEditModal';
import { LiftVideoForm } from '@/components/lifting/LiftVideoForm';
import { VideoProgressTab } from '@/components/lifting/VideoProgressTab';
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
  const [knownExercises, setKnownExercises] = useState<string[]>([]);

  const queryParams = new URLSearchParams();
  queryParams.set('limit', '100');
  if (exerciseFilter) queryParams.set('exercise_name', exerciseFilter);
  if (afterFilter) queryParams.set('after', afterFilter);
  if (beforeFilter) queryParams.set('before', beforeFilter);

  const { data: videos = [], isLoading } = useQuery<LiftVideo[]>({
    queryKey: ['lift-videos', exerciseFilter, afterFilter, beforeFilter],
    queryFn: () => authFetch<LiftVideo[]>(`/api/v1/lifting/videos/?${queryParams}`),
    staleTime: 30_000,
    // Poll while any video is queued/processing so the badge flips to
    // Processed automatically (Modal runs take ~1-2 min).
    refetchInterval: (query) => {
      const data = query.state.data as LiftVideo[] | undefined;
      const active = data?.some(
        (v) =>
          v.analysis_status === 'queued' ||
          v.analysis_status === 'processing',
      );
      return active ? 5000 : false;
    },
  });

  // Quick-jump exercise chips: accumulate the exercises seen in the unfiltered
  // list so the menu stays stable while a filter is active.
  useEffect(() => {
    if (exerciseFilter) return;
    const names = Array.from(
      new Set(
        videos
          .map((v) => v.exercise_name || v.exercise_auto)
          .filter((n): n is string => !!n),
      ),
    ).sort();
    if (names.length) setKnownExercises(names);
  }, [videos, exerciseFilter]);

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

  const processMutation = useMutation({
    mutationFn: ({ videoId, force }: { videoId: string; force?: boolean }) =>
      processLiftVideo(authFetch, videoId, 'full', force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lift-videos'] }),
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [tab, setTab] = useState<'bank' | 'progress'>('bank');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [editVideo, setEditVideo] = useState<LiftVideo | null>(null);

  const hasFilters = exerciseFilter || afterFilter || beforeFilter;

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? [prev[1], id] : [...prev, id],
    );
  };
  const compareVideos = videos.filter((v) => compareIds.includes(v.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-foreground">📹 Videos</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-light/30">
            {(['bank', 'progress'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  tab === t ? 'bg-accent/20 text-accent' : 'text-muted hover:text-foreground'
                }`}
              >
                {t === 'bank' ? 'Bank' : 'Progress'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCompare(true)}
            disabled={compareIds.length !== 2}
            className="px-3 py-2 bg-surface-light/40 text-foreground text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
            title="Select two videos (⇄) to compare"
          >
            ⇄ Compare{compareIds.length ? ` (${compareIds.length})` : ''}
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Add Video
          </button>
        </div>
      </div>

      {tab === 'progress' ? (
        <VideoProgressTab initialExercise={exerciseFilter} />
      ) : (
      <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Exercise filter */}
        <input
          type="text"
          value={exerciseFilter}
          onChange={(e) => setExerciseFilter(e.target.value)}
          placeholder="Exercise…"
          className="px-3 py-1.5 text-sm bg-surface border border-surface-light rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {/* Date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={afterFilter}
            onChange={(e) => setAfterFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-surface border border-surface-light rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="text-muted">→</span>
          <input
            type="date"
            value={beforeFilter}
            onChange={(e) => setBeforeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm bg-surface border border-surface-light rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {hasFilters && (
          <button
            onClick={() => {
              setExerciseFilter('');
              setAfterFilter('');
              setBeforeFilter('');
            }}
            className="text-sm text-muted hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Quick-jump exercise menu */}
      {knownExercises.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setExerciseFilter('')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
              !exerciseFilter
                ? 'bg-accent/20 text-accent border-accent/40'
                : 'bg-surface-light text-muted border-transparent hover:text-foreground'
            }`}
          >
            All
          </button>
          {knownExercises.map((name) => (
            <button
              key={name}
              onClick={() => setExerciseFilter(name)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                exerciseFilter === name
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-surface-light text-muted border-transparent hover:text-foreground'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

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
                  <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                    {video.exercise_name || video.exercise_auto || 'Uncategorized'}
                  </p>
                  <div className="flex items-center gap-1">
                    {video.analysis_status === 'completed' && (
                      <Badge variant="lifting">Processed</Badge>
                    )}
                    {video.analysis_status === 'queued' && (
                      <Badge variant="cycling">Queued…</Badge>
                    )}
                    {video.analysis_status === 'processing' && (
                      <Badge variant="cycling">Processing…</Badge>
                    )}
                    {video.analysis_status === 'failed' && (
                      <Badge variant="warning">Failed</Badge>
                    )}
                    {(!video.analysis_status || video.analysis_status === 'pending') && (
                      <Badge variant="lifting">Uploaded</Badge>
                    )}
                  </div>
                </div>

                {/* Auto-detected info */}
                {video.analysis_status === 'completed' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {video.exercise_auto && (
                      <span className="bg-surface-light px-1.5 py-0.5 rounded">
                        {video.exercise_auto}
                      </span>
                    )}
                    {video.reps_count != null && video.reps_count > 0 && (
                      <span className="bg-surface-light px-1.5 py-0.5 rounded">
                        {video.reps_count} reps
                      </span>
                    )}
                    {video.weight_kg != null && video.weight_kg > 0 && (
                      <span className="bg-surface-light px-1.5 py-0.5 rounded">
                        {video.weight_kg} kg
                      </span>
                    )}
                    {video.confidence != null && video.confidence > 0 && (
                      <span className="text-muted/60">
                        {Math.round(video.confidence * 100)}% conf
                      </span>
                    )}
                  </div>
                )}

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

                {video.analysis_status === 'completed' && (video.form_score != null || video.estimated_rpe != null) && (
                  <div className="flex flex-wrap gap-1.5">
                    {video.form_score != null && (
                      <Badge variant={video.form_score >= 90 ? 'positive' : video.form_score >= 75 ? 'lifting' : video.form_score >= 60 ? 'warning' : 'warning'}>
                        Form {Math.round(video.form_score)}
                      </Badge>
                    )}
                    {video.mean_concentric_velocity != null && (
                      <Badge variant="cycling">
                        {video.mean_concentric_velocity.toFixed(2)} m/s
                      </Badge>
                    )}
                    {video.estimated_rpe != null && (
                      <Badge variant="muted">
                        RPE {video.estimated_rpe.toFixed(1)}
                      </Badge>
                    )}
                  </div>
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
                  {video.analysis_status === 'completed' && (
                    <button
                      onClick={() => toggleCompare(video.id)}
                      className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                        compareIds.includes(video.id)
                          ? 'bg-accent/20 text-accent'
                          : 'text-muted hover:text-foreground'
                      }`}
                      title="Add to compare"
                    >
                      ⇄
                    </button>
                  )}
                  <button
                    onClick={() => setEditVideo(video)}
                    className="text-xs text-muted hover:text-foreground px-1.5 py-0.5"
                    title="Edit details"
                  >
                    ✎
                  </button>
                  {video.r2_key && (
                    <button
                      onClick={() =>
                        processMutation.mutate({
                          videoId: video.id,
                          force:
                            video.analysis_status === 'completed' ||
                            video.analysis_status === 'processing',
                        })
                      }
                      disabled={processMutation.isPending}
                      className="text-xs text-accent/70 hover:text-accent disabled:opacity-50"
                      title={
                        video.analysis_status === 'completed'
                          ? 'Re-run analysis with the latest pipeline'
                          : 'Process video (trim + classify)'
                      }
                    >
                      {processMutation.isPending
                        ? 'Queuing…'
                        : video.analysis_status === 'completed'
                          ? '↻ Reprocess'
                          : video.analysis_status === 'processing'
                            ? '🔄 Retry'
                            : '⚡ Process'}
                    </button>
                  )}
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
                        className="text-xs text-muted hover:text-foreground px-2 py-0.5"
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
      </>)}

      {/* Add Video Form */}
      <LiftVideoForm
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        sessions={sessions}
        prs={prs}
      />

      {/* Compare modal */}
      {compareVideos.length === 2 && (
        <VideoCompareModal
          videos={compareVideos}
          open={showCompare}
          onClose={() => setShowCompare(false)}
        />
      )}

      {/* Edit details modal (correction loop) */}
      {editVideo && (
        <VideoEditModal
          key={editVideo.id}
          video={editVideo}
          open={!!editVideo}
          onClose={() => setEditVideo(null)}
        />
      )}

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
