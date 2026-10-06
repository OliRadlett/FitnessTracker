'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { VideoChip } from '@/components/lifting/VideoChip';
import type { LiftingSession, PersonalRecord, LiftVideo } from '@/lib/api';
import { formatDuration, getActiveLocale } from '@/lib/utils';
import {
  Clock,
  Dumbbell,
  HeartPulse,
  Trash2,
  Edit3,
  Plus,
} from 'lucide-react';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getActiveLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimeRange(
  startedAt?: string | null,
  endedAt?: string | null,
  durationSeconds?: number | null,
): string | null {
  if (!startedAt) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(getActiveLocale(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  let range = fmt(startedAt);
  if (endedAt) range += ` – ${fmt(endedAt)}`;
  const duration =
    durationSeconds ??
    (endedAt
      ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : null);
  if (duration && duration > 0) range += ` · ${formatDuration(duration)}`;
  return range;
}

/** Simple session-quality approximation from available data. */
function qualityScore(
  session: LiftingSession,
): { label: string; color: string; tooltip: string } | null {
  const rpe = session.rpe_session;
  const volume = session.total_volume_kg ?? 0;
  const workingSets = (session.sets || []).filter((s) => !s.is_warmup).length;

  if (rpe == null || workingSets === 0) return null;

  if (rpe >= 8.5 && volume > 1000) {
    return { label: 'Hard', color: 'text-warning', tooltip: `High intensity (RPE ${rpe}) + high volume` };
  }
  if (rpe <= 6 && workingSets <= 12) {
    return { label: 'Light', color: 'text-positive', tooltip: `Low intensity (RPE ${rpe}) + limited volume` };
  }
  if (rpe >= 7 && rpe <= 8.5) {
    return { label: 'Solid', color: 'text-accent', tooltip: `Good intensity (RPE ${rpe}) — productive session` };
  }
  return { label: 'Moderate', color: 'text-muted', tooltip: `RPE ${rpe} — ${workingSets} working sets` };
}

export interface SessionCardMiniProps {
  session: LiftingSession;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  videos?: LiftVideo[];
  /** PRs achieved in this session (from the PRs query, filtered by session_id) */
  sessionPRs?: PersonalRecord[];
  onDelete?: (session: LiftingSession) => void;
  onEdit?: (session: LiftingSession) => void;
  onAddSet?: (session: LiftingSession) => void;
}

export function SessionCardMini({
  session,
  isSelected,
  onSelect,
  videos,
  sessionPRs,
  onDelete,
  onEdit,
  onAddSet,
}: SessionCardMiniProps) {
  const quality = useMemo(() => qualityScore(session), [session]);
  const workingSets = (session.sets || []).filter((s) => !s.is_warmup);
  const warmupSets = (session.sets || []).filter((s) => s.is_warmup);
  const timeRange = formatTimeRange(
    session.started_at,
    session.ended_at,
    session.duration_seconds,
  );

  return (
    <Card
      onClick={() => onSelect(session.id)}
      className={`
        cursor-pointer transition-all
        ${isSelected ? 'border-accent/50 shadow-md' : 'hover:border-surface-light/60'}
      `}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: session identity + metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">
              {session.focus || 'General Session'}
            </p>
            <Badge variant="muted" className="text-[10px] font-medium">
              <Dumbbell className="w-3 h-3 mr-0.5" />
              {session.program_name || 'No program'}
            </Badge>

            {/* Live-session timing */}
            {timeRange && (
              <span
                className="text-[10px] text-muted flex items-center gap-0.5"
                title="Session time range"
              >
                <Clock className="w-3 h-3" />
                {timeRange}
              </span>
            )}

            {/* Linked Strava activity */}
            {session.linked_activity && (
              <Link
                href={`/activities?activity=${session.linked_activity.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors font-medium"
                title={`Linked to Strava: ${session.linked_activity.name}`}
              >
                🏃
              </Link>
            )}

            {/* Whoop strain badge */}
            {session.whoop_strain != null && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-500/15 text-purple-400"
                title={`Whoop strain: ${session.whoop_strain.toFixed(1)}`}
              >
                <HeartPulse className="w-3 h-3 inline mr-0.5" />
                {session.whoop_strain.toFixed(1)}
              </span>
            )}

            {/* Quality score */}
            {quality && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${quality.color} bg-surface-light/30`}
                title={quality.tooltip}
              >
                {quality.label}
              </span>
            )}

            {/* PR achieved in this session */}
            {sessionPRs && sessionPRs.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-positive/15 text-positive"
                title={`${sessionPRs.length} PR${sessionPRs.length > 1 ? 's' : ''} in this session`}
              >
                🏅 {sessionPRs.length}
              </span>
            )}

            {/* Video chip */}
            {videos && videos.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className="flex items-center"
                title={`${videos.length} video${videos.length !== 1 ? 's' : ''}`}
              >
                <VideoChip count={videos.length} />
              </button>
            )}
          </div>

          <p className="text-xs text-muted mt-1">
            {formatDate(session.session_date)}
          </p>
        </div>

        {/* Right: stats + quick actions */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-sm font-mono text-foreground">
              {session.sets?.length ?? 0} sets
            </p>
            <div className="flex gap-3 text-xs text-muted mt-0.5">
              {session.total_volume_kg !== undefined && (
                <span>{session.total_volume_kg.toLocaleString()} kg vol</span>
              )}
              {workingSets.length > 0 && warmupSets.length > 0 && (
                <span>{warmupSets.length} warm-up</span>
              )}
              {session.estimated_tss != null && (
                <span>{session.estimated_tss.toFixed(0)} TSS</span>
              )}
            </div>
          </div>

          {/* Quick-action menu */}
          <div className="flex flex-col gap-1">
            {onAddSet && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddSet(session);
                }}
                className="min-h-[32px] min-w-[32px] flex items-center justify-center text-muted hover:text-accent rounded transition-colors"
                title="Quick-add a set"
                aria-label="Add set"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(session);
                }}
                className="min-h-[32px] min-w-[32px] flex items-center justify-center text-muted hover:text-foreground rounded transition-colors"
                title="Edit session"
                aria-label="Edit"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session);
                }}
                className="min-h-[32px] min-w-[32px] flex items-center justify-center text-muted hover:text-warning rounded transition-colors"
                title="Delete session"
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
