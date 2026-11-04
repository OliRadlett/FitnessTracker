'use client';

/**
 * The stored analyses ARE markdown.
 *
 * `analysis_text` starts `### Performance Assessment` and uses `- **Lead:** …`,
 * `* …` and `--` rules. The page used to drop that string into a `<div>`, which
 * is why readers saw the asterisks.
 *
 * This is deliberately not a markdown library and not `dangerouslySetInnerHTML`:
 * the content has no links, tables, images or raw HTML, so an allow-list grammar
 * that can only produce elements we construct is both sufficient and safer.
 */

import { ChevronDown, RefreshCw } from 'lucide-react';
import type { LlmAnalysis } from '@/lib/api';

type Block =
  | { kind: 'h3'; text: string }
  | { kind: 'rule' }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; text: string };

const RULE = /^\s*(?:--+|—{2,}|-{3,})\s*$/;

export function parseAnalysis(text: string): Block[] {
  const blocks: Block[] = [];
  let ul: string[] = [];
  let ol: string[] = [];

  const flush = () => {
    if (ul.length) {
      blocks.push({ kind: 'ul', items: ul });
      ul = [];
    }
    if (ol.length) {
      blocks.push({ kind: 'ol', items: ol });
      ol = [];
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }
    const heading = /^#{2,4}\s+(.*)$/.exec(line.trim());
    if (heading) {
      flush();
      blocks.push({ kind: 'h3', text: heading[1].trim() });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (ol.length) {
        blocks.push({ kind: 'ol', items: ol });
        ol = [];
      }
      ul.push(bullet[1].trim());
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (ul.length) {
        blocks.push({ kind: 'ul', items: ul });
        ul = [];
      }
      ol.push(numbered[1].trim());
      continue;
    }
    flush();
    blocks.push({ kind: 'p', text: line.trim() });
  }
  flush();
  return blocks;
}

/** Inline `**bold**` only. No HTML path exists, so nothing can leak. */
function inline(text: string): React.ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) => {
      const m = /^\*\*([^*]+)\*\*$/.exec(part);
      return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{part}</span>;
    });
}

export function AnalysisProse({ text }: { text: string }) {
  const blocks = parseAnalysis(text);
  return (
    <div className="analysis text-[13px] leading-relaxed text-foreground/85">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h3':
            return (
              <h3 key={i} className="mt-4 mb-1.5 text-[13px] font-semibold text-foreground first:mt-0">
                {b.text}
              </h3>
            );
          case 'rule':
            return <hr key={i} className="my-3 border-surface-light/50" />;
          case 'ul':
            return (
              <ul key={i} className="mb-2.5 list-disc space-y-1 pl-[18px]">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="mb-2.5 list-decimal space-y-1 pl-[18px]">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className="mb-2">
                {inline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

function ageInDays(createdAt: string): number {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((Date.now() - then) / 86_400_000));
}

/**
 * One analysis, collapsed, with its age stated.
 *
 * The age is not decoration: with a free-tier quota, a failed run is a normal
 * state, and a card that shows a three-month-old paragraph as today's insight is
 * the exact failure this page exists to stop.
 */
export function AnalysisCard({
  title,
  analysis,
  onRefresh,
  isRefreshing,
  defaultOpen = false,
}: {
  title: string;
  analysis: LlmAnalysis | null | undefined;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  defaultOpen?: boolean;
}) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-surface-light/50 p-4 text-[12px] text-muted">
        No analysis has been generated yet. The weekly job runs Sundays at 05:00 UTC.
      </div>
    );
  }

  const age = ageInDays(analysis.created_at);
  const stale = age > 14;

  return (
    <details className="group rounded-lg border border-surface-light/50" open={defaultOpen}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="text-[13px] font-medium">{title}</span>
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[11px] leading-4 ${
            stale ? 'border-caution/40 bg-caution/10 text-caution' : 'border-surface-light text-muted'
          }`}
        >
          {age === 0 ? 'today' : `${age} d old`}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          {analysis.model_used}
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="border-t border-surface-light/50 px-4 pb-4 pt-3">
        {stale && (
          <p className="mb-3 rounded-md border border-caution/30 bg-caution/10 px-2.5 py-1.5 text-[11px] text-caution">
            This analysis is {age} days old and predates the last{' '}
            {age > 30 ? 'month' : 'fortnight'} of training. Read it as history, not as advice for
            today.
          </p>
        )}
        <AnalysisProse text={analysis.analysis_text} />
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-surface-light/50 pt-3">
          <span className="text-[11px] text-muted">
            Generated {analysis.analysis_date} · weekly job, Sundays 05:00 UTC
          </span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-surface-light px-2.5 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Analysing…' : 'Re-analyse now'}
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
