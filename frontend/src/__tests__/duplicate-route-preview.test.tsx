import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// The overlay map needs Leaflet + real layout; assert only that it is wired up
// with the right polylines by stubbing the component.
vi.mock('@/components/maps/CompareRoutesMap', () => ({
  CompareRoutesMap: ({ encodedA, encodedB }: { encodedA: string; encodedB: string }) => (
    <div data-testid="compare-map" data-a={encodedA} data-b={encodedB} />
  ),
}));

// The page imports a lot of query/mutation plumbing; stub the API so nothing
// tries to fetch.
vi.mock('@/lib/api/routes', () => ({
  getDuplicateRoutes: vi.fn().mockResolvedValue([]),
  autoMergeDuplicates: vi.fn(),
  mergeRoutes: vi.fn(),
  undoRouteMerge: vi.fn(),
  listRouteMerges: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api', () => ({
  useAuthFetch: () => ({ token: 'test-token', authFetch: vi.fn() }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import { DuplicatesTab as DuplicatesPage } from '@/app/(app)/routes/_components/DuplicatesTab';

const pair = {
  route_a: {
    id: 'a',
    name: 'Loop A',
    encoded_polyline: 'AAA',
    distance_meters: 40000,
    elevation_gain_meters: 500,
    sport_type: 'cycling',
    sources: [],
    is_loop: true,
  },
  route_b: {
    id: 'b',
    name: 'Loop B',
    encoded_polyline: 'BBB',
    distance_meters: 41000,
    elevation_gain_meters: 520,
    sport_type: 'cycling',
    sources: [],
    is_loop: true,
  },
  score: 0.7,
  requires_confirmation: true,
  tier: 'review',
  breakdown: { min_coverage: 0.8, frechet_similarity: 0.6, lap_ratio: null, reversed: false },
} as never;

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'route-duplicates' ? [pair] : [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

describe('duplicate route preview', () => {
  it('hides the overlay map until asked, then wires both polylines', async () => {
    render(<DuplicatesPage />);

    expect(screen.queryByTestId('compare-map')).toBeNull();

    const toggle = await screen.findByText(/show map preview/i);
    fireEvent.click(toggle);

    const map = screen.getByTestId('compare-map');
    expect(map.getAttribute('data-a')).toBe('AAA');
    expect(map.getAttribute('data-b')).toBe('BBB');
  });
});
