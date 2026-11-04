'use client';

import React from 'react';
import Link from 'next/link';
import type { JournalRow } from '@/lib/journal';
import { SessionGlyph } from './SessionGlyph';

/**
 * One session. The whole row is a single link: one tab stop, one Enter, and no
 * nested controls inside it. Sport-specific metrics — a ride shows distance and
 * load, a lift shows volume and sets — because a shared column set makes one of
 * the two sports unreadable.
 */
export function SessionRow({ row }: { row: JournalRow }) {
  return (
    <Link
      href={`/activity/${row.id}`}
      className="group -mx-2 grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.035] focus-visible:bg-white/[0.035] sm:grid-cols-[44px_minmax(0,1fr)_auto]"
    >
      <SessionGlyph glyph={row.glyph} />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium leading-5 text-foreground transition-colors group-hover:text-accent">
          {row.title}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted/65">
          {row.meta.map((part, i) => (
            <React.Fragment key={part + i}>
              {i > 0 && <span className="px-1 text-muted/30">·</span>}
              {part}
            </React.Fragment>
          ))}
        </p>
      </div>
      <div className="col-start-2 flex items-baseline gap-2.5 sm:col-start-3 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
        <span className="text-[13px] font-semibold leading-5 tabular-nums text-foreground">{row.primary}</span>
        <span className="text-[11px] tabular-nums text-muted/60">{row.secondary}</span>
      </div>
    </Link>
  );
}
