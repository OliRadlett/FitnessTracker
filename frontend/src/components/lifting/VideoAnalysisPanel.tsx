'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LiftVideo } from '@/lib/api';
import { useAuthFetch, getVideoStreamUrl } from '@/lib/api';
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

export function VideoAnalysisPanel({ video }: VideoAnalysisPanelProps) {
  const hasAnalysis =
    video.analysis_status === 'completed' &&
    (video.form_score != null || video.estimated_rpe != null);

  if (!hasAnalysis) return null;

  const deviations = parseJsonArray(video.form_deviations);
  const cues = parseJsonArray(video.form_coaching_cues);
  const evidence = parseJsonArray(video.rpe_evidence_json);
  const rir = video.estimated_rpe != null ? Math.max(0, Math.round((video.estimated_rpe - 6) * 1.5)) : null;
  const formMeta = parseJsonObject(video.form_analysis_json);
  const view = typeof formMeta?.view === 'string' ? formMeta.view : null;
  const qualityRaw =
    formMeta && typeof formMeta.quality === 'object' && formMeta.quality !== null
      ? (formMeta.quality as { level?: unknown }).level
      : undefined;
  const quality = typeof qualityRaw === 'string' ? qualityRaw : null;
  const repTimings = parseRepTimings(video.rep_timing_json);
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
              </tr>
            </thead>
            <tbody>
              {repTimings.map((r) => (
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
                </tr>
              ))}
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
    </div>
  );
}
