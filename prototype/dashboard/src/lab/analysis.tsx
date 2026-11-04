import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { Analysis } from './fixture';
import { Chip } from './ui';

/* ── The analysis renderer ────────────────────────────────────────────────────
   The stored analyses ARE markdown — `### Performance Assessment`, `- **Overall
   trend:** ”¦`, `--` rules. The current page drops the string into a <div>, so the
   asterisks and pipes are shown to the reader. This parses the grammar that is
   actually in the payload (headings, bullets, rules, bold runs) and renders it.

   Deliberately not a general markdown library: the content has no links, tables,
   images or raw HTML, and an allow-list grammar cannot leak HTML into the page. */

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
    const bullet = /^\s*[-*”¢]\s+(.*)$/.exec(line);
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

/** Inline `**bold**` only — no HTML, no links, no emphasis nesting. */
function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    return m ? <strong key={i}>{m[1]}</strong> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export function AnalysisProse({ text }: { text: string }) {
  const blocks = parseAnalysis(text);
  return (
    <div className="analysis">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h3':
            return <h3 key={i}>{b.text}</h3>;
          case 'rule':
            return <hr key={i} />;
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="mb-2.5 list-decimal pl-[18px]">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}

export function analysisAgeDays(a: Analysis, now: string): number {
  const then = Date.parse(a.created_at);
  const today = Date.parse(`${now}T23:59:59Z`);
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

export function AnalysisCard({
  title,
  analysis,
  now,
  onRefresh,
  defaultOpen = false,
}: {
  title: string;
  analysis: Analysis | null;
  now: string;
  onRefresh?: () => void;
  defaultOpen?: boolean;
}) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-surface-light/50 p-4 text-[12px] text-muted">
        No analysis has been generated yet. The weekly job runs Sundays at 05:00 UTC.
      </div>
    );
  }
  const age = analysisAgeDays(analysis, now);
  const stale = age > 14;

  return (
    <details className="group rounded-lg border border-surface-light/50" open={defaultOpen}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="text-[13px] font-medium">{title}</span>
        <Chip tone={stale ? 'caution' : 'neutral'} title={`Generated ${analysis.created_at}`}>
          {age === 0 ? 'today' : `${age} d old`}
        </Chip>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          {analysis.model_used}
          <span className="transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="border-t border-surface-light/50 px-4 pb-4 pt-3">
        {stale && (
          <p className="mb-3 rounded-md border border-caution/30 bg-caution/10 px-2.5 py-1.5 text-[11px] text-caution">
            This analysis is {age} days old and predates the last {age > 30 ? 'month' : 'fortnight'} of
            training. Read it as history, not as advice for today.
          </p>
        )}
        <AnalysisProse text={analysis.analysis_text} />
        <div className="mt-4 flex items-center justify-between border-t border-surface-light/50 pt-3">
          <span className="text-[11px] text-muted">
            Generated {analysis.analysis_date} · weekly job, Sundays 05:00 UTC
          </span>
          {onRefresh && (
            <button
              type="button"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-surface-light px-2.5 text-[11px] text-muted hover:text-foreground"
            >
              <RefreshCw size={12} /> Re-analyse now
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
