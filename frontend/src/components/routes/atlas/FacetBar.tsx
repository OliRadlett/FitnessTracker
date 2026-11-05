'use client';

import { useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { Facets, SortKey } from '@/lib/routeAtlas';
import { activeFacetCount } from '@/lib/routeAtlas';

function FacetSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-10 appearance-none rounded-lg border border-surface-light/70 bg-surface px-3 pr-8 text-xs font-medium text-foreground outline-none transition-colors hover:bg-surface-light/40 focus:border-accent/60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
      />
    </label>
  );
}

function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`h-9 rounded-full px-3 text-xs font-medium transition-colors ${
              value === option.value
                ? 'bg-accent text-white'
                : 'bg-surface-light/50 text-muted hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FacetBar({
  facets,
  setFacets,
  sort,
  setSort,
  sports,
  resultCount,
}: {
  facets: Facets;
  setFacets: (next: Facets) => void;
  sort: SortKey;
  setSort: (next: SortKey) => void;
  sports: string[];
  resultCount: number;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = activeFacetCount(facets);
  const hasQuery = facets.q.trim().length > 0;
  const clearable = active > 0 || hasQuery;

  const clearAll = () =>
    setFacets({
      ...facets,
      q: '',
      distance: 'any',
      climb: 'any',
      status: 'any',
      shape: 'any',
      sport: 'any',
    });

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative min-w-[120px] flex-1 md:max-w-xs">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={facets.q}
          onChange={(e) => setFacets({ ...facets, q: e.target.value })}
          placeholder="Search routes"
          aria-label="Search routes"
          className="h-10 w-full rounded-lg border border-surface-light/70 bg-surface pl-9 pr-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent/60"
        />
        {hasQuery && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setFacets({ ...facets, q: '' })}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Desktop facets */}
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <FacetSelect
          label="Distance"
          value={facets.distance}
          onChange={(distance) => setFacets({ ...facets, distance })}
          options={[
            { value: 'any', label: 'Any distance' },
            { value: 'short', label: 'Under 40 km' },
            { value: 'medium', label: '40–80 km' },
            { value: 'long', label: '80 km+' },
          ]}
        />

        <FacetSelect
          label="Climb"
          value={facets.climb}
          onChange={(climb) => setFacets({ ...facets, climb })}
          options={[
            { value: 'any', label: 'Any climb' },
            { value: 'flat', label: 'Under 400 m' },
            { value: 'rolling', label: '400–900 m' },
            { value: 'big', label: '900 m+' },
          ]}
        />

        <FacetSelect
          label="Ridden"
          value={facets.status}
          onChange={(status) => setFacets({ ...facets, status })}
          options={[
            { value: 'any', label: 'Ridden or new' },
            { value: 'unridden', label: 'Never ridden' },
            { value: 'ridden', label: 'Ridden before' },
          ]}
        />

        <button
          type="button"
          onClick={() => setFacets({ ...facets, shape: facets.shape === 'loop' ? 'any' : 'loop' })}
          aria-pressed={facets.shape === 'loop'}
          className={`h-10 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors ${
            facets.shape === 'loop'
              ? 'border-accent/50 bg-accent/15 text-accent'
              : 'border-surface-light/70 bg-surface text-muted hover:text-foreground'
          }`}
        >
          Loops
        </button>

        {sports.length > 1 && (
          <FacetSelect
            label="Sport"
            value={facets.sport}
            onChange={(sport) => setFacets({ ...facets, sport })}
            options={[
              { value: 'any', label: 'All sports' },
              ...sports.map((sport) => ({
                value: sport as Facets['sport'],
                label: sport.charAt(0).toUpperCase() + sport.slice(1),
              })),
            ]}
          />
        )}

        <FacetSelect
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'nearest', label: 'Nearest' },
            { value: 'recent', label: 'Newest' },
            { value: 'distance', label: 'Longest' },
            { value: 'climb', label: 'Biggest climb' },
            { value: 'ridden', label: 'Most ridden' },
          ]}
        />

        {clearable && (
          <button
            type="button"
            onClick={clearAll}
            className="h-10 shrink-0 rounded-lg px-2 text-xs font-medium text-accent hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Mobile: one filters button opens the same facets as chips. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium md:hidden ${
          active > 0
            ? 'border-accent/50 bg-accent/15 text-accent'
            : 'border-surface-light/70 bg-surface text-muted'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
        {active > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold tabular-nums text-white">
            {active}
          </span>
        )}
      </button>

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} size="sm" aria-label="Route filters">
        <div className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Filters</h2>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close filters"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
            <ChipGroup
              label="Distance"
              value={facets.distance}
              onChange={(distance) => setFacets({ ...facets, distance })}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'short', label: 'Under 40 km' },
                { value: 'medium', label: '40–80 km' },
                { value: 'long', label: '80 km+' },
              ]}
            />
            <ChipGroup
              label="Climb"
              value={facets.climb}
              onChange={(climb) => setFacets({ ...facets, climb })}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'flat', label: 'Under 400 m' },
                { value: 'rolling', label: '400–900 m' },
                { value: 'big', label: '900 m+' },
              ]}
            />
            <ChipGroup
              label="Ridden"
              value={facets.status}
              onChange={(status) => setFacets({ ...facets, status })}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'unridden', label: 'Never' },
                { value: 'ridden', label: 'Ridden' },
              ]}
            />
            <ChipGroup
              label="Shape"
              value={facets.shape}
              onChange={(shape) => setFacets({ ...facets, shape })}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'loop', label: 'Loops' },
                { value: 'point', label: 'Point to point' },
              ]}
            />
            {sports.length > 1 && (
              <ChipGroup
                label="Sport"
                value={facets.sport}
                onChange={(sport) => setFacets({ ...facets, sport })}
                options={[
                  { value: 'any', label: 'Any' },
                  ...sports.map((sport) => ({
                    value: sport as Facets['sport'],
                    label: sport.charAt(0).toUpperCase() + sport.slice(1),
                  })),
                ]}
              />
            )}
            <ChipGroup
              label="Sort by"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'nearest', label: 'Nearest' },
                { value: 'recent', label: 'Newest' },
                { value: 'distance', label: 'Longest' },
                { value: 'climb', label: 'Biggest climb' },
                { value: 'ridden', label: 'Most ridden' },
              ]}
            />
          </div>

          <div className="mt-4 flex gap-2 border-t border-surface-light/50 pt-3">
            <button
              type="button"
              onClick={clearAll}
              disabled={!clearable}
              className="h-10 flex-1 rounded-lg border border-surface-light/70 text-xs font-medium text-muted disabled:opacity-40"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="h-10 flex-[2] rounded-lg bg-accent text-xs font-semibold text-white"
            >
              Show {resultCount} routes
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
