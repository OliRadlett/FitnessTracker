'use client';

/**
 * Phase 2 (plans/ui-redesign-v2.md §2.1 REVIEW) — the single range picker that
 * drives the dashboard charts together via `useTimeRange()`.
 *
 * Presets map to `?days=` / `?weeks=` windows (backend caps 365d / 52w — see
 * `timeRangeDays` / `timeRangeWeeks`). Custom mode exposes two native date
 * inputs. Cycling / health / analytics charts are intentionally NOT wired to
 * this context — a follow-up wave consumes the API.
 */

import React from 'react';
import { TIME_RANGE_PRESETS_DAYS, useTimeRange } from '@/lib/time-range';
import { toDateStr } from './PeriodNav';

const PRESETS = Object.keys(TIME_RANGE_PRESETS_DAYS);

function parseDateInput(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function TimeRangePicker() {
  const { start, end, preset, setPreset, setCustom } = useTimeRange();
  const custom = preset === 'custom';

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard chart range">
      <span className="text-xs text-muted uppercase tracking-wider">Charts</span>
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-surface-light/50">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            aria-pressed={preset === p}
            className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg transition-colors tabular-nums whitespace-nowrap ${
              preset === p
                ? 'bg-accent text-white'
                : 'text-muted hover:text-foreground hover:bg-surface-light/50'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom(start, end)}
          aria-pressed={custom}
          className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
            custom
              ? 'bg-accent text-white'
              : 'text-muted hover:text-foreground hover:bg-surface-light/50'
          }`}
        >
          Custom
        </button>
      </div>
      {custom && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="date"
              value={toDateStr(start)}
              max={toDateStr(end)}
              onChange={(e) => {
                const s = parseDateInput(e.target.value);
                if (s) setCustom(s, end);
              }}
              className="min-h-[44px] text-xs tabular-nums bg-surface border border-surface-light/50 rounded-lg px-2 py-2 text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input
              type="date"
              value={toDateStr(end)}
              min={toDateStr(start)}
              onChange={(e) => {
                const t = parseDateInput(e.target.value);
                if (t) setCustom(start, t);
              }}
              className="min-h-[44px] text-xs tabular-nums bg-surface border border-surface-light/50 rounded-lg px-2 py-2 text-foreground"
            />
          </label>
        </div>
      )}
    </div>
  );
}
