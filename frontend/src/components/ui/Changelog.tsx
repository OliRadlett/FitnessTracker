'use client';

import React, { useState } from 'react';
import { changelog, type ChangelogEntry } from '@/lib/changelog';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Changelog() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  return (
    <div className="space-y-4">
      {changelog.map((entry, i) => (
        <ChangelogRelease
          key={entry.version}
          entry={entry}
          isExpanded={expandedIndex === i}
          onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
        />
      ))}
    </div>
  );
}

function ChangelogRelease({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: ChangelogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-surface-light/30 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-light/30 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted shrink-0" />
        )}
        <span className="text-sm font-semibold text-white">{entry.title}</span>
        <span className="text-xs text-muted ml-auto shrink-0">{entry.date}</span>
      </button>
      {isExpanded && (
        <ul className="px-4 pb-4 pl-11 space-y-1.5">
          {entry.bullets.map((bullet, j) => (
            <li key={j} className="text-sm text-muted flex items-start gap-2">
              <span className="text-accent mt-1 shrink-0">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
