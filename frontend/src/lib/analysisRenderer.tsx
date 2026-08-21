/**
 * Shared markdown-like renderer and helpers for AI analysis cards.
 *
 * Used by: LlmAnalysisCard, ActivityAiAnalysisCard, SessionAiAnalysisCard,
 *          HealthAiAnalysisCard, EventAiAnalysisCard
 */

import React from 'react';

/* ── Markdown-like renderer ─────────────────────────────────────────────── */

/** Render inline bold (**text**) */
export function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Render analysis text with basic markdown support (## headings, ### subheadings,
 * - list items, **bold** inline).
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
        <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 text-sm text-slate-300 mb-3 pl-2">
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

    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="text-base font-semibold text-white mt-4 mb-2">
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }

    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="text-lg font-bold text-white mt-5 mb-2">
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      continue;
    }

    flushList();
    elements.push(
      <p key={`p-${i}`} className="text-sm text-slate-300 leading-relaxed mb-2">
        {renderInline(line)}
      </p>,
    );
  }

  flushList();
  return elements;
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
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
