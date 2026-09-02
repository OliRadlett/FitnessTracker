import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { RouteFilters } from '@/lib/api/types';

export type RoutesViewMode = 'map' | 'list' | 'grid';
export type DetailTab = 'overview' | 'map' | 'history' | 'weather' | 'effort';

export interface RoutesState {
  // View state
  viewMode: RoutesViewMode;
  setViewMode: (mode: RoutesViewMode) => void;

  // Selection state
  selectedRouteId: string | null;
  setSelectedRouteId: (id: string | null) => void;

  // Multi-selection for bulk actions
  selectedRouteIds: Set<string>;
  selectRoute: (id: string) => void;
  deselectRoute: (id: string) => void;
  toggleRouteSelection: (id: string) => void;
  clearSelection: () => void;
  setSelectedRouteIds: (ids: Set<string>) => void;

  // Tags
  selectedTagIds: string[];
  setSelectedTagIds: (ids: string[]) => void;
  toggleTag: (id: string) => void;

  // Active collection
  activeCollectionId: string | null;
  setActiveCollectionId: (id: string | null) => void;

  // Filters
  filters: RouteFilters;
  setFilters: (filters: RouteFilters) => void;
  resetFilters: () => void;

  // Detail panel
  detailTab: DetailTab;
  setDetailTab: (tab: DetailTab) => void;

  // Compare mode
  compareRouteA: string | null;
  compareRouteB: string | null;
  setCompareRoutes: (a: string | null, b: string | null) => void;
  toggleCompare: (id: string) => void;

  // UI state
   showFilters: boolean;
   setShowFilters: (show: boolean) => void;
   showImportModal: boolean;
   setShowImportModal: (show: boolean) => void;
   showNewTagModal: boolean;
   setShowNewTagModal: (show: boolean) => void;
   showHeatmap: boolean;
   setShowHeatmap: (show: boolean) => void;
}

const initialFilters: RouteFilters = {};

export const useRoutesStore = create<RoutesState>()(
  subscribeWithSelector((set) => ({
    // View state
    viewMode: 'map' as RoutesViewMode,
    setViewMode: (mode) => set({ viewMode: mode }),

    // Selection state
    selectedRouteId: null,
    setSelectedRouteId: (id) => set({ selectedRouteId: id }),

    // Multi-selection
    selectedRouteIds: new Set<string>(),
    selectRoute: (id) =>
      set((state) => ({
        selectedRouteIds: new Set(state.selectedRouteIds).add(id),
      })),
    deselectRoute: (id) =>
      set((state) => {
        const next = new Set(state.selectedRouteIds);
        next.delete(id);
        return { selectedRouteIds: next };
      }),
    toggleRouteSelection: (id) =>
      set((state) => {
        const next = new Set(state.selectedRouteIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { selectedRouteIds: next };
      }),
    clearSelection: () => set({ selectedRouteIds: new Set() }),
    setSelectedRouteIds: (ids) => set({ selectedRouteIds: ids }),

    // Tags
    selectedTagIds: [],
    setSelectedTagIds: (ids) => set({ selectedTagIds: ids }),
    toggleTag: (id) =>
      set((state) => ({
        selectedTagIds: state.selectedTagIds.includes(id)
          ? state.selectedTagIds.filter((t) => t !== id)
          : [...state.selectedTagIds, id],
      })),

    // Active collection
    activeCollectionId: null,
    setActiveCollectionId: (id) => set({ activeCollectionId: id, selectedRouteId: null }),

    // Filters
    filters: initialFilters,
    setFilters: (filters) => set({ filters }),
    resetFilters: () => set({ filters: initialFilters }),

    // Detail panel
    detailTab: 'overview' as DetailTab,
    setDetailTab: (tab) => set({ detailTab: tab }),

    // Compare mode
    compareRouteA: null,
    compareRouteB: null,
    setCompareRoutes: (a, b) => set({ compareRouteA: a, compareRouteB: b }),
    toggleCompare: (id) =>
      set((state) => {
        if (state.compareRouteA === id) {
          return { compareRouteA: null };
        }
        if (state.compareRouteB === id) {
          return { compareRouteB: null };
        }
        if (state.compareRouteA === null) {
          return { compareRouteA: id };
        }
        return { compareRouteB: id };
      }),

     // UI state
     showFilters: false,
     setShowFilters: (show) => set({ showFilters: show }),
     showImportModal: false,
     setShowImportModal: (show) => set({ showImportModal: show }),
     showNewTagModal: false,
     setShowNewTagModal: (show) => set({ showNewTagModal: show }),
     showHeatmap: true,
     setShowHeatmap: (show) => set({ showHeatmap: show }),
   })),
);
