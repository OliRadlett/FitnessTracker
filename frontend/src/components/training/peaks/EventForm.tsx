'use client';

/**
 * EventForm — create/edit an event (race / ride / lift) with the full payload.
 *
 * Replaces the old inline form, which could only set name/date/type/taper —
 * `target_tss` and `notes` are now reachable.
 */

import React, { useState } from 'react';

import type { CreateEventPayload } from '@/lib/api';

const inputCls =
  'w-full px-2 py-1.5 min-h-[44px] bg-background border border-surface-light rounded-lg text-foreground text-sm focus:outline-none focus:border-accent';
const labelCls = 'block text-[10px] text-muted mb-0.5';

export interface EventFormProps {
  onSubmit: (payload: CreateEventPayload) => void;
  onCancel: () => void;
  pending?: boolean;
  initial?: Partial<CreateEventPayload>;
}

export function EventForm({ onSubmit, onCancel, pending, initial }: EventFormProps) {
  const [form, setForm] = useState<CreateEventPayload>({
    name: '',
    event_date: '',
    event_type: 'race',
    taper_days: 14,
    ...initial,
  });

  const valid = form.name.trim() && form.event_date;

  return (
    <div className="p-3 bg-surface-light/30 rounded-lg border border-surface-light/50 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Name</label>
          <input
            type="text"
            autoFocus
            placeholder="e.g. Autumn 100"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls}
            aria-label="Event name"
          />
        </div>
        <div>
          <label className={labelCls}>Date</label>
          <input
            type="date"
            value={form.event_date}
            onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
            className={inputCls}
            aria-label="Event date"
          />
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select
            value={form.event_type}
            onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
            className={inputCls}
            aria-label="Event type"
          >
            <option value="race">Race</option>
            <option value="ride">Ride</option>
            <option value="lift">Lift</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Target TSS (optional)</label>
          <input
            type="number"
            min={0}
            placeholder="e.g. 300"
            value={form.target_tss ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                target_tss: e.target.value === '' ? undefined : parseFloat(e.target.value),
              }))
            }
            className={inputCls}
            aria-label="Target TSS"
          />
        </div>
        <div>
          <label className={labelCls}>Taper days</label>
          <input
            type="number"
            min={0}
            max={60}
            value={form.taper_days}
            onChange={(e) =>
              setForm((f) => ({ ...f, taper_days: parseInt(e.target.value) || 0 }))
            }
            className={inputCls}
            aria-label="Taper days"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes (optional)</label>
          <input
            type="text"
            placeholder="Course, goal time, kit…"
            value={form.notes ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || undefined }))}
            className={inputCls}
            aria-label="Event notes"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => valid && onSubmit({ ...form, name: form.name.trim() })}
          disabled={!valid || pending}
          className="px-3 py-1.5 min-h-[44px] bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/80 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save event'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 min-h-[44px] text-muted text-xs hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
