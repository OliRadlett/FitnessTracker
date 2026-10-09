/**
 * Shared markdown-like renderer and helpers for AI analysis cards.
 *
 * Used by: LlmAnalysisCard, ActivityAiAnalysisCard, SessionAiAnalysisCard,
 *          HealthAiAnalysisCard, EventAiAnalysisCard
 */

import React from 'react';

import { getActiveLocale } from './utils';

/* ── Markdown-like renderer ─────────────────────────────────────────────── */

/** Render inline bold (**text**) */
export function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Render analysis text with basic markdown support (## headings, ### subheadings,
 * - / * / • list items, **bold** inline).
 *
 * Handles edge cases: empty text, whitespace-only text.
 */
export function renderAnalysisText(text: string): React.ReactNode[] {
  if (!text || text.trim().length === 0) {
    return [
      <p key="empty" className="text-sm text-muted italic">
        No analysis content available.
      </p>,
    ];
  }

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 text-sm text-muted mb-3 pl-2">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '') {
      flushList();
      elements.push(<div key={`space-${i}`} className="h-2" />);
      continue;
    }

    if (line.startsWith('#### ')) {
      flushList();
      elements.push(
        <h4 key={`h4-${i}`} className="text-sm font-semibold text-foreground mt-3 mb-1.5">
          {renderInline(line.slice(5))}
        </h4>,
      );
      continue;
    }

    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="text-base font-semibold text-foreground mt-4 mb-2">
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }

    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="text-lg font-bold text-foreground mt-5 mb-2">
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      continue;
    }

    // Gemini also emits `* ` and `• ` bullets (0.9) — render them as lists
    // instead of literal text.
    if (line.startsWith('* ') || line.startsWith('• ')) {
      listItems.push(line.slice(2));
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${i}`} className="text-sm text-muted leading-relaxed mb-2">
        {renderInline(line)}
      </p>,
    );
  }

  flushList();
  return elements;
}

/* ── Structured insight sections (InsightCard template) ────────────────────
 *
 * Phase 0 hygiene: LLM markdown arrives with predictable long-form sections
 * ("Overall Score: 7.5 / 10", "Top 3 … Priorities", method/limitation notes)
 * that read as raw literals when rendered as flat headings. `parseInsightSections`
 * pulls those out by heading text so `AiAnalysisCard` can render them as a
 * score header, a priority list, and a collapsible method block. Matching is
 * deliberately generic (heading regexes, not domain keywords) so the same
 * template serves every domain card. Anything unmatched stays in `bodyText`
 * and renders exactly as before — no data is ever dropped.
 */

export interface InsightScore {
  value: number;
  scale: number;
}

export interface InsightMethod {
  heading: string;
  body: string;
}

export interface InsightSections {
  score: InsightScore | null;
  /** Original heading of the priorities section (e.g. "Top 3 Health Priorities") */
  prioritiesHeading: string | null;
  priorities: string[];
  /** Prose lines from the priorities section that were not list items */
  prioritiesProse: string[];
  method: InsightMethod | null;
  /** Remaining markdown with the extracted sections removed */
  bodyText: string;
}

interface RawSection {
  heading: string | null;
  lines: string[];
}

const SCORE_RE = /overall\s*score\s*:?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/i;
const PRIORITIES_HEADING_RE = /priorit|top\s+\d+|key\s+(actions|recommendations|takeaways)|next steps|action items/i;
const METHOD_HEADING_RE = /method|how\s+(this|the|it)|data\s+(sources|used)|limitations|caveats|confidence|about\s+this|a\s+note\s+on/i;
const LIST_ITEM_RE = /^\s*(?:[-*•]\s+|\d+[.)]\s+)(.*)$/;

function splitSections(text: string): RawSection[] {
  const sections: RawSection[] = [{ heading: null, lines: [] }];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(#{2,4})\s+(.*)$/);
    if (match) {
      sections.push({ heading: match[2].trim(), lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  return sections;
}

export function parseInsightSections(text: string): InsightSections {
  const result: InsightSections = {
    score: null,
    prioritiesHeading: null,
    priorities: [],
    prioritiesProse: [],
    method: null,
    bodyText: text,
  };
  if (!text || text.trim().length === 0) return result;

  const sections = splitSections(text);
  const kept: RawSection[] = [];

  for (const section of sections) {
    // Score heading (e.g. "### Overall Score: 7.5 / 10" or "### Overall Score"
    // with the value in the body) — extract the value, drop the heading.
    const headingScore = section.heading?.match(SCORE_RE);
    const bodyScoreLine = section.lines.find((l) => SCORE_RE.test(l));
    const scoreMatch = headingScore ?? bodyScoreLine?.match(SCORE_RE);
    if (scoreMatch && result.score === null) {
      result.score = {
        value: parseFloat(scoreMatch[1]),
        scale: parseInt(scoreMatch[2], 10),
      };
      const rest = section.lines.filter((l) => !SCORE_RE.test(l));
      if (rest.join('\n').trim().length > 0) {
        kept.push({ heading: null, lines: rest });
      }
      continue;
    }

    // Priority section — list items become the priority list, prose is kept
    // alongside so nothing is lost.
    if (section.heading && PRIORITIES_HEADING_RE.test(section.heading) && result.prioritiesHeading === null) {
      const items: string[] = [];
      const prose: string[] = [];
      for (const line of section.lines) {
        if (line.trim() === '') continue;
        const item = line.match(LIST_ITEM_RE);
        if (item) items.push(item[1].trim());
        else prose.push(line);
      }
      if (items.length > 0) {
        result.prioritiesHeading = section.heading;
        result.priorities = items;
        result.prioritiesProse = prose;
        continue;
      }
    }

    // Method section — whole block moves into the collapsible.
    if (section.heading && METHOD_HEADING_RE.test(section.heading) && result.method === null) {
      const body = section.lines.join('\n').trim();
      if (body.length > 0) {
        result.method = { heading: section.heading, body };
        continue;
      }
    }

    kept.push(section);
  }

  result.bodyText = kept
    .map((s) => (s.heading ? `### ${s.heading}\n${s.lines.join('\n')}` : s.lines.join('\n')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return result;
}

function scoreColor(value: number, scale: number): string {
  const ratio = scale > 0 ? value / scale : 0;
  if (ratio >= 0.8) return 'text-positive';
  if (ratio >= 0.6) return 'text-accent';
  if (ratio >= 0.4) return 'text-yellow-400';
  return 'text-warning';
}

/**
 * Structured analysis body: score header → remaining markdown →
 * priority list → collapsible method. Sections that are absent in the
 * source render nothing (no empty chrome). Falls back to flat markdown
 * when the LLM output has none of the recognised sections.
 */
export function renderStructuredAnalysis(text: string): React.ReactNode {
  const parsed = parseInsightSections(text);
  const hasStructure =
    parsed.score !== null || parsed.priorities.length > 0 || parsed.method !== null;
  if (!hasStructure) return renderAnalysisText(text);

  const nodes: React.ReactNode[] = [];
  let key = 0;

  if (parsed.score) {
    nodes.push(
      <div
        key={`score-${key++}`}
        className="flex items-baseline gap-2 rounded-lg border border-surface-light/50 bg-surface-light/30 px-4 py-3 mb-4"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Overall score</span>
        <span className={`text-2xl font-bold tabular-nums ${scoreColor(parsed.score.value, parsed.score.scale)}`}>
          {parsed.score.value}
          <span className="text-sm font-medium text-muted">/{parsed.score.scale}</span>
        </span>
      </div>,
    );
  }

  if (parsed.bodyText.length > 0) {
    nodes.push(
      <React.Fragment key={`body-${key++}`}>{renderAnalysisText(parsed.bodyText)}</React.Fragment>,
    );
  }

  if (parsed.priorities.length > 0) {
    nodes.push(
      <div key={`priorities-${key++}`} className="mt-4">
        <h3 className="text-base font-semibold text-foreground mb-2">
          {renderInline(parsed.prioritiesHeading ?? 'Top priorities')}
        </h3>
        {parsed.prioritiesProse.length > 0 && (
          <div className="mb-2">{renderAnalysisText(parsed.prioritiesProse.join('\n'))}</div>
        )}
        <ol className="space-y-2">
          {parsed.priorities.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent tabular-nums"
              >
                {i + 1}
              </span>
              <span className="text-muted">{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      </div>,
    );
  }

  if (parsed.method) {
    nodes.push(
      <details
        key={`method-${key++}`}
        className="mt-4 rounded-lg border border-surface-light/50 bg-surface-light/20 px-4 py-1"
      >
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-muted transition-colors hover:text-foreground">
          {renderInline(parsed.method.heading)}
        </summary>
        <div className="pb-3">{renderAnalysisText(parsed.method.body)}</div>
      </details>,
    );
  }

  return nodes;
}

/* ── Relative time helper ───────────────────────────────────────────────── */

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString(getActiveLocale(), { month: 'short', day: 'numeric' });
}
