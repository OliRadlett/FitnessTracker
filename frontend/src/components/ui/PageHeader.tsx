'use client';

import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned primary/secondary actions (Buttons, links). */
  actions?: React.ReactNode;
  /** Optional status row rendered under the subtitle (sync state, errors). */
  status?: React.ReactNode;
}

/**
 * Single page-header pattern: title + subtitle + actions.
 * Replaces the 17 distinct `<h1>` class strings across pages.
 */
export function PageHeader({ title, subtitle, actions, status }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
        {subtitle ? <p className="text-muted text-sm mt-1">{subtitle}</p> : null}
        {status}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
