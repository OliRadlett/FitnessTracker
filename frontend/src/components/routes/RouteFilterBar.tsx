'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RouteFilters } from '@/lib/api/types';
import { Badge } from '@/components/ui/Badge';
import { useRoutesStore } from '@/lib/stores/routesStore';
import { Filter, X, SortAsc, SortDesc } from 'lucide-react';

const SORT_OPTIONS = [
  { value: '', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'distance', label: 'Distance' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'ride_count', label: 'Ride Count' },
  { value: 'last_ridden', label: 'Last Ridden' },
  { value: 'quality_score', label: 'Quality Score' },
  { value: 'created_at', label: 'Date Added' },
];

const SURFACE_OPTIONS = [
  { value: '', label: 'Any surface' },
  { value: 'paved', label: 'Paved' },
  { value: 'gravel', label: 'Gravel' },
  { value: 'compacted_gravel', label: 'Compacted Gravel' },
  { value: 'dirt', label: 'Dirt' },
  { value: 'grass', label: 'Grass' },
  { value: 'singletrack', label: 'Singletrack' },
  { value: 'trail', label: 'Trail' },
  { value: 'cobblestone', label: 'Cobblestone' },
  { value: 'sand', label: 'Sand' },
];

export function RouteFilterBar() {
  const { filters, setFilters, resetFilters, selectedTagIds, showFilters, setShowFilters } = useRoutesStore();
  const [localQ, setLocalQ] = useState(filters.q || '');

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQ.trim()) {
        setFilters({ ...filters, q: localQ.trim() });
      } else if (filters.q) {
        setFilters({ ...filters, q: undefined });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localQ, setFilters, filters]);

  const activeFilterCount = Object.entries(filters).filter(
    ([key, val]) =>
      key !== 'q' && val !== undefined && val !== '' && val !== null &&
      !(Array.isArray(val) && val.length === 0),
  ).length + (selectedTagIds.length > 0 ? 1 : 0);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQ(e.target.value);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters({ ...filters, sort_by: e.target.value || undefined });
  };

  const handleSortOrderToggle = () => {
    setFilters({
      ...filters,
      sort_order: filters.sort_order === 'asc' ? 'desc' : 'asc',
    });
  };

  const handleClearAll = () => {
    resetFilters();
    setLocalQ('');
  };

  const toggleAdvanced = () => setShowFilters(!showFilters);

  return (
    <div className="space-y-3">
      {/* Tier 1 filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search routes..."
            value={localQ}
            onChange={handleSearchChange}
            className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Sort */}
        <select
          value={filters.sort_by || ''}
          onChange={handleSortChange}
          className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Sort order toggle */}
        {filters.sort_by && (
          <button
            onClick={handleSortOrderToggle}
            className="p-2 bg-surface-light border border-surface-light rounded-lg text-muted hover:text-white hover:bg-surface-light/80 transition-colors"
            aria-label={filters.sort_order === 'asc' ? 'Ascending' : 'Descending'}
          >
            {filters.sort_order === 'asc' ? (
              <SortAsc className="w-4 h-4" />
            ) : (
              <SortDesc className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Favorite filter */}
        <button
          onClick={() => setFilters({ ...filters, is_favorite: filters.is_favorite ? undefined : true })}
          className={`p-2 rounded-lg border transition-colors ${
            filters.is_favorite
              ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
              : 'bg-surface-light border-surface-light text-muted hover:text-white'
          }`}
          aria-label="Show favorites only"
        >
          <span className="text-lg">★</span>
        </button>

        {/* Advanced filters toggle */}
        <button
          onClick={toggleAdvanced}
          className={`px-3 py-2 text-sm border rounded-lg transition-colors inline-flex items-center gap-1.5 ${
            showFilters
              ? 'bg-accent/20 text-accent border-accent/30'
              : 'text-muted hover:text-white border-surface-light hover:bg-surface-light/50'
          }`}
        >
          <Filter className="w-4 h-4" />
          More Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-accent text-white rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={handleClearAll}
            className="px-3 py-2 text-sm text-accent hover:text-accent/80 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Tier 2 — collapsible advanced filters */}
      {showFilters && (
        <div className="px-4 pb-4 pt-3 border border-surface-light/30 rounded-lg grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Status</label>
            <select
              value={filters.is_ridden === undefined ? '' : filters.is_ridden ? 'ridden' : 'unridden'}
              onChange={(e) => {
                const val = e.target.value;
                setFilters({ ...filters, is_ridden: val === '' ? undefined : val === 'ridden' });
              }}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">All</option>
              <option value="unridden">Not yet ridden</option>
              <option value="ridden">Ridden</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Route Type</label>
            <select
              value={filters.is_loop === undefined ? '' : filters.is_loop ? 'loop' : 'point'}
              onChange={(e) => {
                const val = e.target.value;
                setFilters({ ...filters, is_loop: val === '' ? undefined : val === 'loop' });
              }}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">All</option>
              <option value="loop">Loop</option>
              <option value="point">Point to Point</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Surface</label>
            <select
              value={filters.surface_type || ''}
              onChange={(e) => setFilters({ ...filters, surface_type: e.target.value || undefined })}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {SURFACE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Min Dist (km)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="0"
              value={filters.min_distance ? filters.min_distance / 1000 : ''}
              onChange={(e) => setFilters({ ...filters, min_distance: e.target.value ? parseFloat(e.target.value) * 1000 : undefined })}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Max Dist (km)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="∞"
              value={filters.max_distance ? filters.max_distance / 1000 : ''}
              onChange={(e) => setFilters({ ...filters, max_distance: e.target.value ? parseFloat(e.target.value) * 1000 : undefined })}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Min Elev (m)</label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="0"
              value={filters.min_elevation ?? ''}
              onChange={(e) => setFilters({ ...filters, min_elevation: e.target.value ? parseFloat(e.target.value) : undefined })}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Max Elev (m)</label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="∞"
              value={filters.max_elevation ?? ''}
              onChange={(e) => setFilters({ ...filters, max_elevation: e.target.value ? parseFloat(e.target.value) : undefined })}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Min Quality</label>
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              placeholder="0"
              value={filters.min_quality_score ?? ''}
              onChange={(e) => setFilters({ ...filters, min_quality_score: e.target.value ? parseFloat(e.target.value) : undefined })}
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
