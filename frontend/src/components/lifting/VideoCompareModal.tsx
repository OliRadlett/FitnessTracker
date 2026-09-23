'use client';

// Side-by-side comparison of two analysed lift videos (same exercise):
// form, validity, velocity, RPE and deviation counts.

import React from 'react';
import type { LiftVideo } from '@/lib/api';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { VideoEmbed } from '@/components/lifting/VideoEmbed';
import { BarPathCompare } from '@/components/lifting/BarPathCompare';

function parseJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

function FormBadge({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-muted">—</span>;
  const variant = score >= 90 ? 'positive' : score >= 75 ? 'lifting' : 'warning';
  return <Badge variant={variant}>{Math.round(score)}</Badge>;
}

function Row({
  label,
  a,
  b,
}: {
  label: string;
  a: React.ReactNode;
  b: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr_1fr] gap-2 py-1.5 border-t border-surface-light/40 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-foreground">{a}</span>
      <span className="text-foreground">{b}</span>
    </div>
  );
}

export function VideoCompareModal({
  videos,
  open,
  onClose,
}: {
  videos: LiftVideo[];
  open: boolean;
  onClose: () => void;
}) {
  if (videos.length !== 2) return null;
  const [a, b] = videos;
  const devA = parseJsonArray(a.form_deviations);
  const devB = parseJsonArray(b.form_deviations);

  return (
    <Modal open={open} onClose={onClose} size="xl" aria-label="Compare videos">
      <ModalHeader title="Compare lifts" onClose={onClose} icon="⇄" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <VideoEmbed video={a} />
        <VideoEmbed video={b} />
      </div>

      <div className="mt-4">
        <BarPathCompare videoA={a} videoB={b} />
      </div>

      <div className="mt-4">
        <Row label="Exercise" a={a.exercise_name ?? '—'} b={b.exercise_name ?? '—'} />
        <Row
          label="Date"
          a={new Date(a.created_at).toLocaleDateString()}
          b={new Date(b.created_at).toLocaleDateString()}
        />
        <Row
          label="Load"
          a={a.weight_kg ? `${a.weight_kg} kg` : '—'}
          b={b.weight_kg ? `${b.weight_kg} kg` : '—'}
        />
        <Row label="Reps" a={a.reps_count ?? '—'} b={b.reps_count ?? '—'} />
        <Row label="Form" a={<FormBadge score={a.form_score} />} b={<FormBadge score={b.form_score} />} />
        <Row
          label="Valid"
          a={a.competition_valid == null ? '—' : a.competition_valid ? '✅' : '❌'}
          b={b.competition_valid == null ? '—' : b.competition_valid ? '✅' : '❌'}
        />
        <Row
          label="Mean vel"
          a={a.mean_concentric_velocity != null ? `${a.mean_concentric_velocity.toFixed(2)} m/s` : '—'}
          b={b.mean_concentric_velocity != null ? `${b.mean_concentric_velocity.toFixed(2)} m/s` : '—'}
        />
        <Row
          label="Vel loss"
          a={a.velocity_loss_pct != null ? `${a.velocity_loss_pct.toFixed(1)}%` : '—'}
          b={b.velocity_loss_pct != null ? `${b.velocity_loss_pct.toFixed(1)}%` : '—'}
        />
        <Row
          label="RPE"
          a={a.estimated_rpe != null ? a.estimated_rpe.toFixed(1) : '—'}
          b={b.estimated_rpe != null ? b.estimated_rpe.toFixed(1) : '—'}
        />
        <Row
          label="Deviations"
          a={devA.length ? `${devA.length}` : 'none'}
          b={devB.length ? `${devB.length}` : 'none'}
        />
      </div>
    </Modal>
  );
}
