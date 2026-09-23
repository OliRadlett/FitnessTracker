'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiftVideo } from '@/lib/api';
import { useAuthFetch, getVideoStreamUrl } from '@/lib/api';
import { processLiftVideo, updateLiftVideo } from '@/lib/api/lifting';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

interface VideoAnalysisPanelProps {
  video: LiftVideo;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
    return [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface RepTiming {
  rep_number: number;
  amplitude_m?: number | null;
  concentric_time?: number | null;
  concentric_velocity_ms?: number | null;
  sticking_position_pct?: number | null;
  sticking_min_velocity_ms?: number | null;
  sticking_joint_angle?: number | null;
  knee_moment_nm?: number | null;
  hip_moment_nm?: number | null;
  hip_share_pct?: number | null;
}

function parseRepTimings(value: string | null | undefined): RepTiming[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is RepTiming => r && typeof r.rep_number === 'number');
  } catch {
    return [];
  }
}

interface LifterCandidate {
  track_id: number;
  score: number;
  components?: Record<string, number>;
}

interface LifterSelection {
  source?: string;
  chosen_track_id?: number;
  n_tracks?: number;
  candidates?: LifterCandidate[];
}

function parseLifterSelection(value: string | null | undefined): LifterSelection | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as LifterSelection) : null;
  } catch {
    return null;
  }
}

function repFlagMap(deviations: string[]): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  for (const d of deviations) {
    const m = d.match(/Rep (\d+):\s*(.*)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      (map[n] ||= []).push(m[2]);
    }
  }
  return map;
}

const VIEW_LABELS: Record<string, string> = {
  side: 'Side view',
  three_quarter: 'Angled view',
  front: 'Front view',
  rear: 'Rear view',
  frontal: 'Front/rear view',
  unknown: 'Angle unknown',
};

function FormScoreRing({ score }: { score: number }) {
  const radius = 40;
  const stroke = 6;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  let color = 'text-warning';
  let strokeColor = '#f87171';
  if (score >= 90) {
    color = 'text-positive';
    strokeColor = '#4ade80';
  } else if (score >= 75) {
    color = 'text-yellow-400';
    strokeColor = '#facc15';
  } else if (score >= 60) {
    color = 'text-orange-400';
    strokeColor = '#fb923c';
  }

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="-rotate-90">
        <circle
          stroke="currentColor"
          className="text-surface-light"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke={strokeColor}
          fill="transparent"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset: offset }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      <span className={`absolute text-2xl font-bold ${color}`}>{Math.round(score)}</span>
    </div>
  );
}

function VelocityColor({ pct }: { pct: number }) {
  if (pct < 10) return <span className="text-positive">{pct.toFixed(1)}%</span>;
  if (pct < 20) return <span className="text-yellow-400">{pct.toFixed(1)}%</span>;
  if (pct < 30) return <span className="text-orange-400">{pct.toFixed(1)}%</span>;
  return <span className="text-warning">{pct.toFixed(1)}%</span>;
}

function RpeConfidence({ confidence }: { confidence: number | null | undefined }) {
  if (confidence == null) return null;
  let label = 'Low';
  let variant: 'warning' | 'muted' | 'positive' = 'warning';
  if (confidence >= 0.7) {
    label = 'High';
    variant = 'positive';
  } else if (confidence >= 0.4) {
    label = 'Medium';
    variant = 'muted';
  }
  return <Badge variant={variant}>{label} confidence</Badge>;
}

function MiniCard({ label, value, unit }: { label: string; value: number | null | undefined; unit?: string }) {
  if (value == null) return null;
  return (
    <div className="bg-surface-light/50 rounded-lg px-3 py-2 text-center">
      <p className="text-[11px] text-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold text-foreground">
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span className="text-xs text-muted ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

interface BarPath {
  source?: string;
  confidence?: number;
  n_reps?: number;
  efficiency?: number;
  drift_ratio?: number;
  consistency?: number;
  note?: string;
}

function BarPathCard({ value }: { value: string | null | undefined }) {
  const data = parseJsonObject(value) as BarPath | null;
  if (!data || data.consistency == null) return null;
  const proxy = data.source === 'pose_proxy';
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Bar path</p>
        <Badge variant={proxy ? 'muted' : 'positive'}>
          {proxy ? 'Proxy' : 'Tracked'}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-muted uppercase">Efficiency</p>
          <p className="text-lg font-semibold text-foreground">
            {data.efficiency != null ? `${Math.round(data.efficiency * 100)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted uppercase">Consistency</p>
          <p className="text-lg font-semibold text-foreground">
            {data.consistency != null ? `${Math.round(data.consistency)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted uppercase">Drift</p>
          <p className="text-lg font-semibold text-foreground">
            {data.drift_ratio != null ? data.drift_ratio.toFixed(2) : '—'}
          </p>
        </div>
      </div>
      {data.note && <p className="text-[11px] text-muted">{data.note}</p>}
    </Card>
  );
}

const SIGNAL_LABELS: Record<string, string> = {
  bar_coupling: 'bar',
  posture: 'posture',
  movement: 'movement',
  coverage: 'coverage',
};

function LifterSelectionCard({ video }: { video: LiftVideo }) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();
  const selection = parseLifterSelection(video.lifter_selection_json);
  const candidates = selection?.candidates ?? [];
  const current = video.lifter_selected ?? selection?.chosen_track_id ?? null;
  const [choice, setChoice] = useState<number | null>(current);

  useEffect(() => {
    setChoice(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, video.lifter_selected, selection?.chosen_track_id]);

  const applyMutation = useMutation({
    mutationFn: async (trackId: number) => {
      await updateLiftVideo(authFetch, video.id, { lifter_track_id: trackId });
      await processLiftVideo(authFetch, video.id, 'full', true);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lift-videos'] }),
  });

  // Only meaningful when the model actually saw more than one person.
  if (candidates.length < 2) return null;

  const pending = applyMutation.isPending;
  const dirty = choice != null && choice !== current;

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Who&apos;s lifting?</p>
        {selection?.source === 'manual' ? (
          <Badge variant="default">Manual</Badge>
        ) : (
          <span className="text-[11px] text-muted">Auto-detected</span>
        )}
      </div>
      <p className="text-[11px] text-muted">
        {candidates.length} people detected. Pick the lifter and reprocess.
      </p>
      <div className="space-y-1">
        {candidates.map((c) => (
          <label
            key={c.track_id}
            className="flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1 hover:bg-surface-light/50"
          >
            <input
              type="radio"
              name={`lifter-${video.id}`}
              checked={choice === c.track_id}
              onChange={() => setChoice(c.track_id)}
              className="accent-accent"
            />
            <span className="text-foreground">Person {c.track_id + 1}</span>
            <span className="text-muted">
              score {c.score.toFixed(2)}
              {c.components
                ? ' · ' +
                  Object.entries(c.components)
                    .map(([k, v]) => `${SIGNAL_LABELS[k] ?? k} ${v.toFixed(2)}`)
                    .join(', ')
                : ''}
            </span>
          </label>
        ))}
      </div>
      <button
        onClick={() => choice != null && applyMutation.mutate(choice)}
        disabled={pending || !dirty}
        className="text-xs px-3 py-1.5 rounded bg-accent text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? 'Reprocessing…' : 'Set lifter & reprocess'}
      </button>
      {applyMutation.isError && (
        <p className="text-xs text-warning">Failed to apply — try again.</p>
      )}
    </Card>
  );
}

export function VideoAnalysisPanel({ video }: VideoAnalysisPanelProps) {
  const hasAnalysis =
    video.analysis_status === 'completed' &&
    (video.form_score != null || video.estimated_rpe != null);

  if (!hasAnalysis) return null;

  const deviations = parseJsonArray(video.form_deviations);
  const flagsByRep = repFlagMap(deviations);
  const cues = parseJsonArray(video.form_coaching_cues);
  const evidence = parseJsonArray(video.rpe_evidence_json);
  const rir = video.estimated_rpe != null ? Math.max(0, Math.round((video.estimated_rpe - 6) * 1.5)) : null;
  const formMeta = parseJsonObject(video.form_analysis_json);
  const view = typeof formMeta?.view === 'string' ? formMeta.view : null;
  const qualityObj =
    formMeta && typeof formMeta.quality === 'object' && formMeta.quality !== null
      ? (formMeta.quality as {
          level?: unknown;
          lifter_rate?: unknown;
          multi_person?: unknown;
        })
      : null;
  const quality = typeof qualityObj?.level === 'string' ? qualityObj.level : null;
  // Multi-person clip where the tracked lifter covers <50% of frames (a spotter
  // dominated the detector) — numbers are softer than the level alone implies.
  const lowLifterCoverage =
    qualityObj?.multi_person === true &&
    typeof qualityObj.lifter_rate === 'number' &&
    qualityObj.lifter_rate < 0.5;
  const coaching =
    typeof formMeta?.coaching_summary === 'string' ? formMeta.coaching_summary : null;
  const repTimings = parseRepTimings(video.rep_timing_json);
  const restMeta = parseJsonObject(video.rest_periods_json);
  const nSets = typeof restMeta?.n_sets === 'number' ? restMeta.n_sets : null;
  const repsPerSet = Array.isArray(restMeta?.reps_per_set)
    ? (restMeta.reps_per_set as unknown[]).filter(
        (n): n is number => typeof n === 'number',
      )
    : null;
  const { authFetch, token } = useAuthFetch();
  const { data: thumbsUrl } = useQuery({
    queryKey: ['video-thumbnails', video.id],
    queryFn: () => getVideoStreamUrl(authFetch, video.id, 'thumbnails'),
    enabled: !!token && !!video.rep_thumbnails_r2_key,
    staleTime: 300_000,
  });

  return (
    <div className="space-y-4 border-t border-surface-light/50 pt-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-foreground">Analysis</h4>
        {view && view !== 'unknown' ? (
          <Badge variant="default">{VIEW_LABELS[view] ?? view}</Badge>
        ) : (
          <span className="text-[11px] text-muted">
            Film side-on to unlock torso-lean &amp; depth checks
          </span>
        )}
      </div>

      {quality === 'unusable' && (
        <p className="text-xs text-warning">
          ⚠ Couldn&apos;t analyze this clip reliably — refilm with the full body in
          frame and steady lighting.
        </p>
      )}
      {quality !== 'unusable' && lowLifterCoverage && (
        <p className="text-xs text-muted">
          Only part of the clip tracked the lifter (a spotter was present) — the
          numbers are indicative. Film without the spotter in frame for a fuller read.
        </p>
      )}

      <LifterSelectionCard video={video} />

      {coaching && (
        <Card className="space-y-1 border-l-2 border-accent/50">
          <p className="text-sm font-medium text-foreground">Coaching</p>
          <p className="text-sm text-muted leading-relaxed">{coaching}</p>
        </Card>
      )}

      {video.form_score != null && (
        <Card className="space-y-3">
          <div className="flex items-center gap-4">
            <FormScoreRing score={video.form_score} />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Form Score</p>
              {video.competition_valid != null && (
                <Badge variant={video.competition_valid ? 'positive' : 'warning'}>
                  {video.competition_valid ? 'IPF Valid' : 'Would Fail'}
                </Badge>
              )}
            </div>
          </div>

          {deviations.length > 0 && (
            <div>
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Deviations</p>
              <ul className="space-y-0.5">
                {deviations.map((d, i) => (
                  <li key={i} className="text-xs text-orange-300 flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 rounded-full bg-orange-400 shrink-0" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cues.length > 0 && (
            <div>
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Coaching Cues</p>
              <ul className="space-y-0.5">
                {cues.map((c, i) => (
                  <li key={i} className="text-xs text-green-300 flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 rounded-full bg-green-400 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {(video.mean_concentric_velocity != null || video.vbt_zone != null) && (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-foreground">Velocity</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] text-muted uppercase">Mean Conc.</p>
              <p className="text-lg font-semibold text-foreground">
                {video.mean_concentric_velocity?.toFixed(2)}
                <span className="text-xs text-muted ml-0.5">m/s</span>
              </p>
              {video.vbt_zone && (
                <Badge variant="default" className="mt-1">{video.vbt_zone}</Badge>
              )}
            </div>
            <div>
              <p className="text-[11px] text-muted uppercase">Peak</p>
              <p className="text-lg font-semibold text-foreground">
                {video.peak_velocity?.toFixed(2) ?? '—'}
                <span className="text-xs text-muted ml-0.5">m/s</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted uppercase">Loss</p>
              <p className="text-lg font-semibold">
                {video.velocity_loss_pct != null ? (
                  <VelocityColor pct={video.velocity_loss_pct} />
                ) : (
                  '—'
                )}
              </p>
            </div>
          </div>
        </Card>
      )}

      <BarPathCard value={video.bar_path_json} />

      {repTimings.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-foreground">Per-rep</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left">
                <th className="font-medium py-1">Rep</th>
                <th className="font-medium py-1">ROM</th>
                <th className="font-medium py-1">Time</th>
                <th className="font-medium py-1">Velocity</th>
                <th className="font-medium py-1" title="Where the bar slowed most, as % of the lift">
                  Stick
                </th>
                <th className="font-medium py-1">Flags</th>
              </tr>
            </thead>
            <tbody>
              {repTimings.map((r) => {
                const flags = flagsByRep[r.rep_number] ?? [];
                return (
                  <tr key={r.rep_number} className="border-t border-surface-light/40">
                    <td className="py-1 text-foreground">{r.rep_number}</td>
                    <td className="py-1 text-muted">
                      {r.amplitude_m != null ? `${r.amplitude_m.toFixed(2)} m` : '—'}
                    </td>
                    <td className="py-1 text-muted">
                      {r.concentric_time != null ? `${r.concentric_time.toFixed(1)} s` : '—'}
                    </td>
                    <td className="py-1 text-muted">
                      {r.concentric_velocity_ms != null
                        ? `${r.concentric_velocity_ms.toFixed(2)} m/s`
                        : '—'}
                    </td>
                    <td
                      className="py-1 text-muted"
                      title={
                        [
                          r.sticking_min_velocity_ms != null
                            ? `min ${r.sticking_min_velocity_ms.toFixed(2)} m/s`
                            : null,
                          r.sticking_joint_angle != null
                            ? `joint ${Math.round(r.sticking_joint_angle)}°`
                            : null,
                          r.knee_moment_nm != null
                            ? `knee ≈${Math.round(r.knee_moment_nm)} Nm`
                            : null,
                          r.hip_share_pct != null
                            ? `hip ${Math.round(r.hip_share_pct)}%`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || undefined
                      }
                    >
                      {r.sticking_position_pct != null
                        ? `${Math.round(r.sticking_position_pct)}%`
                        : '—'}
                    </td>
                    <td className="py-1">
                      {flags.length ? (
                        <span className="text-warning" title={flags.join('; ')}>
                          ⚠ {flags.length}
                        </span>
                      ) : (
                        <span className="text-positive">✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {thumbsUrl?.url && (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-foreground">Rep positions</p>
          <img
            src={thumbsUrl.url}
            alt="Each rep's bottom position with the tracked skeleton"
            className="w-full rounded-lg"
          />
        </Card>
      )}

      {video.estimated_rpe != null && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">RPE</p>
            <RpeConfidence confidence={video.rpe_confidence} />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground">{video.estimated_rpe.toFixed(1)}</span>
            {rir != null && (
              <span className="text-sm text-muted">~{rir} RIR</span>
            )}
          </div>
          {evidence.length > 0 && (
            <ul className="space-y-0.5 mt-1">
              {evidence.map((e, i) => (
                <li key={i} className="text-xs text-muted flex items-start gap-1.5">
                  <span className="mt-1 h-1 w-1 rounded-full bg-accent shrink-0" />
                  {e}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <MiniCard label="Setup" value={video.setup_score} unit="/100" />
        <MiniCard label="Consistency" value={video.rep_consistency_score} unit="/100" />
        <MiniCard label="Rest" value={video.avg_rest_seconds} unit="s" />
      </div>
      {nSets != null && nSets > 1 && (
        <p className="text-xs text-muted">
          {nSets} sets detected
          {repsPerSet && repsPerSet.length
            ? ` (${repsPerSet.join(' + ')} reps)`
            : ''}
        </p>
      )}
    </div>
  );
}
