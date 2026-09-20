'use client';

import React from 'react';

interface SectionLabelProps {
  children: React.ReactNode;
  /** Optional count rendered after the label, e.g. "(12)". */
  count?: number;
  /** Right-aligned action (link, small button). */
  action?: React.ReactNode;
}

/**
 * Small-caps section label — the one allowed `uppercase` pattern.
 * Content headings stay sentence case (`CardTitle`, `PageHeader`).
 */
export function SectionLabel({ children, count, action }: SectionLabelProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 className="text-xs font-medium text-muted uppercase tracking-wider">
        {children}
        {count != null ? <span className="ml-1.5 text-muted/70">({count})</span> : null}
      </h2>
      {action}
    </div>
  );
}
