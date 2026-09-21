'use client';

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonLine } from '@/components/ui/Skeleton';
import type { LlmAnalysis } from '@/lib/api';
import { renderAnalysisText, relativeTime } from '@/lib/analysisRenderer';

export interface AiAnalysisCardProps {
  /** Card title shown in the header */
  title: React.ReactNode;
  /** The analysis data, or null if not yet generated */
  analysis: LlmAnalysis | null;
  /** Whether the initial query is loading */
  isLoading: boolean;
  /** Whether the refresh mutation is in progress */
  isRefreshing: boolean;
  /** Trigger a refresh (re-analyze) */
  onRefresh: () => void;

  /** Button label when no analysis exists yet */
  buttonLabel?: string;
  /** Button aria-label when no analysis exists yet */
  buttonAriaLabel?: string;
  /** Emoji shown in the empty state */
  emptyEmoji?: string;
  /** Title text in the empty state */
  emptyTitle?: string;
  /** Description text in the empty state */
  emptyDescription?: string;
  /** Text shown in the analyzing spinner */
  analyzingText?: string;

  /** Optional subtitle (e.g. date) shown above the analysis content */
  subtitle?: React.ReactNode;
  /** Optional error from the mutation (renders warning box) */
  mutationError?: Error | null;
  /** Optional error from the query (renders warning box) */
  queryError?: Error | null;
}

const GEMINI_KEY_MSG = 'AI analysis is not available — GEMINI_API_KEY is not configured.';

export function AiAnalysisCard({
  title,
  analysis,
  isLoading,
  isRefreshing,
  onRefresh,
  buttonLabel = 'Analyze with AI',
  buttonAriaLabel = 'Analyze with AI',
  emptyEmoji = '🧠',
  emptyTitle = 'No AI analysis yet',
  emptyDescription = 'Click to generate an AI-powered analysis.',
  analyzingText = 'Analyzing with Gemini... This may take 10-20 seconds.',
  subtitle,
  mutationError,
  queryError,
}: AiAnalysisCardProps) {
  const buttonLabelRefresh = analysis ? 'Re-analyze' : buttonLabel;
  const buttonAriaLabelRefresh = analysis
    ? (buttonAriaLabel.replace(/Analyze.*/, 'Re-analyze') || 'Re-analyze')
    : buttonAriaLabel;
  const buttonLabelCurrent = isRefreshing ? '⏳ Analyzing...' : buttonLabelRefresh;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>{title}</CardTitle>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={buttonAriaLabelRefresh}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {buttonLabelCurrent}
          </button>
        </div>
      </CardHeader>

      {/* Mutation error state */}
      {mutationError && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mb-4 mx-6">
          <p className="text-sm text-warning">
            {mutationError instanceof Error
              ? mutationError.message.includes('GEMINI_API_KEY')
                ? GEMINI_KEY_MSG
                : `Analysis failed: ${mutationError.message}`
              : 'Analysis failed. Please try again.'}
          </p>
        </div>
      )}

      {/* Query error state */}
      {queryError && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm mx-6 mb-4">
          Failed to load: {queryError.message}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !analysis && (
        <div className="space-y-3 px-6">
          <SkeletonLine width="75%" height="1rem" />
          <SkeletonLine width="100%" height="1rem" />
          <SkeletonLine width="92%" height="1rem" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !analysis && !isRefreshing && !mutationError && !queryError && (
        <div className="text-center py-6">
          <p className="text-3xl mb-2">{emptyEmoji}</p>
          <p className="text-muted text-sm">{emptyTitle}</p>
          <p className="text-muted text-xs mt-1">{emptyDescription}</p>
        </div>
      )}

      {/* Analyzing spinner */}
      {isRefreshing && (
        <div className="flex items-center gap-3 py-4 px-6">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">{analyzingText}</p>
        </div>
      )}

      {/* Analysis content */}
      {analysis && (
        <div className="px-6 pb-6">
          {subtitle && (
            <div className="flex items-center gap-3 mb-4 text-xs text-muted">
              {subtitle}
            </div>
          )}
          {!subtitle && (
            <div className="flex items-center gap-3 mb-4 text-xs text-muted">
              <span>Model: <span className="text-muted font-mono">{analysis.model_used}</span></span>
              <span className="text-surface-light">|</span>
              <span>Generated {relativeTime(analysis.created_at)}</span>
            </div>
          )}

          <div className="bg-surface-light/30 rounded-lg p-4 border border-surface-light/50">
            {renderAnalysisText(analysis.analysis_text)}
          </div>

          {/* RM2 — grounding chips: key facts the analysis was based on. */}
          <StatsGrounding stats={analysis.stats_json} />
        </div>
      )}
    </Card>
  );
}

/**
 * RM2 — collapsed-by-default "Based on" line from `stats_json` (previously
 * never rendered). Defensive lookups across known producer shapes; renders
 * nothing when no recognised facts are present.
 */
function StatsGrounding({ stats }: { stats: Record<string, unknown> | null | undefined }) {
  if (!stats || typeof stats !== 'object') return null;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  // Producers nest load under various keys — check each defensively.
  const load =
    (stats.load as Record<string, unknown> | undefined) ??
    (stats.training_load as Record<string, unknown> | undefined) ??
    (stats.ctl_atl_tsb as Record<string, unknown> | undefined);

  const facts: string[] = [];
  const ctl = num(load?.ctl ?? stats.current_ctl ?? stats.ctl);
  const atl = num(load?.atl ?? stats.current_atl ?? stats.atl);
  const tsb = num(load?.tsb ?? stats.current_tsb ?? stats.tsb);
  if (ctl !== null || atl !== null || tsb !== null) {
    facts.push(
      `CTL ${ctl?.toFixed(0) ?? '—'} · ATL ${atl?.toFixed(0) ?? '—'} · TSB ${tsb?.toFixed(1) ?? '—'}`,
    );
  }
  const ftp = num(stats.ftp_watts ?? stats.ftp);
  if (ftp !== null) facts.push(`FTP ${Math.round(ftp)}W`);
  const vo2 = stats.vo2max ?? stats.vo2_max;
  const vo2Num = num(vo2);
  const vo2Str =
    vo2Num !== null
      ? `VO₂max ${vo2Num.toFixed(1)}`
      : typeof vo2 === 'string' && vo2
        ? `VO₂max ${vo2}`
        : null;
  if (vo2Str) facts.push(vo2Str);
  const tss = num(stats.weekly_tss ?? stats.total_tss);
  if (tss !== null) facts.push(`Week TSS ${Math.round(tss)}`);
  const recovery = num(stats.recovery_score ?? stats.recovery);
  if (recovery !== null) facts.push(`Recovery ${Math.round(recovery)}%`);

  const shown = facts.slice(0, 5);
  if (shown.length === 0) return null;

  return (
    <details className="mt-3 text-xs text-muted">
      <summary className="cursor-pointer hover:text-foreground transition-colors">
        Based on {shown.length} fact{shown.length === 1 ? '' : 's'}
      </summary>
      <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
        {shown.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
    </details>
  );
}
