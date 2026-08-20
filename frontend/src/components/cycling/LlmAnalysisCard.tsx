'use client';

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { LlmAnalysis } from '@/lib/api';

/* ── Simple markdown-like renderer ──────────────────────────────────────── */

function renderAnalysisText(text: string): React.ReactNode[] {
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

    // Empty line → spacing
    if (line.trim() === '') {
      flushList();
      elements.push(<div key={`space-${i}`} className="h-2" />);
      continue;
    }

    // ### heading
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="text-base font-semibold text-white mt-4 mb-2">
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }

    // ## heading
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="text-lg font-bold text-white mt-5 mb-2">
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }

    // - list item
    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      continue;
    }

    // Regular paragraph
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

/** Render inline bold (**text**) */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/* ── Relative time helper ───────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
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

/* ── Component ──────────────────────────────────────────────────────────── */

interface LlmAnalysisCardProps {
  analysis: LlmAnalysis | null;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function LlmAnalysisCard({ analysis, isLoading, onRefresh, isRefreshing }: LlmAnalysisCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle>🤖 AI Performance Analysis</CardTitle>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={analysis ? 'Refresh analysis' : 'Generate analysis'}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {isRefreshing ? '⏳ Analyzing...' : analysis ? '🔄 Refresh' : '✨ Generate Analysis'}
          </button>
        </div>
      </CardHeader>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-surface-light/50 rounded w-3/4" />
          <div className="h-4 bg-surface-light/50 rounded w-full" />
          <div className="h-4 bg-surface-light/50 rounded w-5/6" />
          <div className="h-4 bg-surface-light/50 rounded w-2/3" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !analysis && (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">🧠</p>
          <p className="text-muted text-sm">No analysis generated yet</p>
          <p className="text-muted text-xs mt-1">
            Click "Generate Analysis" to get AI-powered insights on your cycling performance
          </p>
        </div>
      )}

      {/* Analysis content */}
      {!isLoading && analysis && (
        <div>
          {/* Subtitle */}
          <div className="flex items-center gap-3 mb-4 text-xs text-muted">
            <span>
              📅 {new Date(analysis.analysis_date).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span className="text-surface-light">|</span>
            <span>Model: <span className="text-slate-300 font-mono">{analysis.model_used}</span></span>
          </div>

          {/* Rendered analysis */}
          <div className="bg-surface-light/30 rounded-lg p-4 border border-surface-light/50">
            {renderAnalysisText(analysis.analysis_text)}
          </div>

          {/* Footer */}
          <p className="text-xs text-muted mt-3 text-right">
            Last updated: {relativeTime(analysis.created_at)}
          </p>
        </div>
      )}
    </Card>
  );
}
