'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, globalSearch } from '@/lib/api';
import type { SearchResponse } from '@/lib/api';

// ── Hit model ─────────────────────────────────────────────────────────────

type HitKind = 'activity' | 'route' | 'lift' | 'exercise' | 'goal' | 'event';

interface Hit {
  kind: HitKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  emoji: string;
}

const KIND_ORDER: HitKind[] = ['activity', 'route', 'lift', 'exercise', 'goal', 'event'];
const KIND_EMOJI: Record<HitKind, string> = {
  activity: '🚴',
  route: '🗺️',
  lift: '🏋️',
  exercise: '💪',
  goal: '🎯',
  event: '📅',
};
const KIND_LABEL: Record<HitKind, string> = {
  activity: 'Activities',
  route: 'Routes',
  lift: 'Lifting sessions',
  exercise: 'Exercises',
  goal: 'Goals',
  event: 'Events',
};

function flattenHits(data: SearchResponse | undefined): Hit[] {
  if (!data) return [];
  const hits: Hit[] = [];
  for (const kind of KIND_ORDER) {
    let title = '';
    let subtitle = '';
    let id = '';
    let href = '';
    if (kind === 'activity') {
      for (const item of data.activities) {
        title = item.name;
        subtitle = item.date ?? '';
        id = item.id;
        href = `/activities?activity=${item.id}`;
        hits.push({ kind, id, title, subtitle, href, emoji: KIND_EMOJI[kind] });
      }
    } else if (kind === 'route') {
      for (const item of data.routes) {
        title = item.name;
        subtitle = item.sport_type;
        id = item.id;
        href = `/routes?route=${item.id}`;
        hits.push({ kind, id, title, subtitle, href, emoji: KIND_EMOJI[kind] });
      }
    } else if (kind === 'lift') {
      for (const item of data.lifting_sessions) {
        title = item.program_name || 'Lifting session';
        subtitle = [item.focus, item.session_date].filter(Boolean).join(' · ');
        id = item.id;
        href = `/lifting?session=${item.id}`;
        hits.push({ kind, id, title, subtitle, href, emoji: KIND_EMOJI[kind] });
      }
    } else if (kind === 'exercise') {
      for (const item of data.exercises) {
        title = item.name;
        subtitle = item.category ?? '';
        id = item.id;
        href = '/lifting';
        hits.push({ kind, id, title, subtitle, href, emoji: KIND_EMOJI[kind] });
      }
    } else if (kind === 'goal') {
      for (const item of data.goals) {
        title = item.label;
        subtitle = `${item.target_value} (${item.status})`;
        id = item.id;
        href = '/goals';
        hits.push({ kind, id, title, subtitle, href, emoji: KIND_EMOJI[kind] });
      }
    } else {
      for (const item of data.events) {
        title = item.name;
        subtitle = item.event_date;
        id = item.id;
        href = '/training';
        hits.push({ kind, id, title, subtitle, href, emoji: KIND_EMOJI[kind] });
      }
    }
  }
  return hits;
}

// ── Component ─────────────────────────────────────────────────────────────

export function CommandPalette() {
  const { authFetch, token } = useAuthFetch();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘P / Ctrl+P toggle; Esc closes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Open trigger from the sidebar search button (custom event).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('fittrack:command-palette', onOpen);
    return () => window.removeEventListener('fittrack:command-palette', onOpen);
  }, []);

  // Debounce query.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = q.trim();
      setDebouncedQ(trimmed.length >= 2 ? trimmed : '');
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Reset state on open.
  useEffect(() => {
    if (open) {
      setQ('');
      setDebouncedQ('');
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const { data, isFetching } = useQuery<SearchResponse>({
    queryKey: ['global-search', debouncedQ],
    queryFn: () => globalSearch(authFetch, debouncedQ),
    enabled: !!token && open && debouncedQ.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const hits = useMemo(() => flattenHits(data), [data]);
  const groups = useMemo(() => {
    const map = new Map<HitKind, Hit[]>();
    for (const hit of hits) {
      const arr = map.get(hit.kind) ?? [];
      arr.push(hit);
      map.set(hit.kind, arr);
    }
    return map;
  }, [hits]);

  const navigate = useCallback(
    (hit: Hit) => {
      setOpen(false);
      router.push(hit.href);
      router.refresh();
    },
    [router],
  );

  // Reset selection when results change shape.
  useEffect(() => {
    if (selected >= hits.length) setSelected(0);
  }, [hits.length, selected]);

  // Keyboard list navigation.
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && hits[selected]) {
      e.preventDefault();
      navigate(hits[selected]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [selected]);

  if (!open) return null;

  const emptyPrompt =
    !debouncedQ.length
      ? 'Search activities, routes, lifting sessions, exercises, goals, and events.'
      : isFetching || hits.length === 0
        ? 'No matches found.'
        : '';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="w-full max-w-xl rounded-2xl border border-surface-light bg-surface shadow-2xl overflow-hidden"
        onKeyDown={onListKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-surface-light/60 px-4 py-3">
          <span className="text-muted">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type to search…"
            className="flex-1 bg-transparent text-white text-sm placeholder:text-muted focus:outline-none"
            aria-activedescendant={selected in hits ? `hit-${selected}` : undefined}
          />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-surface-light/60 text-[10px] text-muted">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {emptyPrompt && (
            <p className="px-4 py-6 text-center text-sm text-muted">{emptyPrompt}</p>
          )}

          {!emptyPrompt && hits.length > 0 && (
            <div className="space-y-3">
              {Array.from(groups.entries())
                .filter(([, groupHits]) => groupHits.length > 0)
                .map(([kind, groupHits]) => (
                  <div key={kind}>
                    <p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                      {KIND_LABEL[kind]}
                    </p>
                    {groupHits.map((hit) => {
                      const absIndex = hits.indexOf(hit);
                      const active = absIndex === selected;
                      return (
                        <button
                          key={`${hit.kind}:${hit.id}`}
                          id={`hit-${absIndex}`}
                          data-index={absIndex}
                          role="option"
                          aria-selected={active}
                          onClick={() => navigate(hit)}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                            active ? 'bg-accent/15' : 'bg-transparent'
                          }`}
                        >
                          <span className="text-base shrink-0">{hit.emoji}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-white truncate">{hit.title}</span>
                            {hit.subtitle && (
                              <span className="block text-xs text-muted truncate">
                                {hit.subtitle}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}