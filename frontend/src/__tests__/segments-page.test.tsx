/**
 * The `/segments` page is the atlas over stable segment groups. These tests pin
 * the behaviours the page exists for: one card per group (not per route line),
 * counts from the whole set, the ridden/to-ride split, and the filters/sort
 * composing without leaving a stale hero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SegmentGroup } from '@/lib/api/types';

const getSegmentGroups = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn(), token: 'test-token' }),
    getSegmentGroups: (...args: unknown[]) => getSegmentGroups(...args),
  };
});

vi.mock('@/lib/usePageTitle', () => ({ usePageTitle: () => {} }));

import SegmentsPage from '@/app/(app)/segments/page';

function makeGroup(over: Partial<SegmentGroup> = {}): SegmentGroup {
  const name = over.name ?? 'Crag X';
  return {
    id: 'g-1',
    kind: 'climb',
    name,
    canonical_name: name,
    display_name: null,
    name_source: 'route',
    area: 'Edinburgh',
    region: 'Edinburgh',
    country: 'United Kingdom',
    route_name: 'Box Hill',
    distance_m: 1000,
    gain_m: 80,
    avg_gradient_pct: 8,
    max_gradient_pct: 12,
    steepest_200m_pct: 10,
    sustained_share: 0.6,
    profile: [
      [0, 100, 8],
      [500, 140, 8],
      [1000, 180, 8],
    ],
    category: '2',
    difficulty: 50,
    attempts: 3,
    best: {
      seconds: 300,
      moving_seconds: 300,
      power_watts: 280,
      vam: 960,
      date: '2026-08-26T00:00:00Z',
    },
    last_ridden: '2026-08-26T00:00:00Z',
    route_count: 1,
    prediction: null,
    ...over,
  };
}

const GROUPS: SegmentGroup[] = [
  makeGroup({ id: 'g-1', name: 'Crag X', attempts: 3, difficulty: 60 }),
  makeGroup({
    id: 'g-2',
    name: 'Hill Y',
    attempts: 1,
    difficulty: 80,
    area: 'Peebles',
    region: 'Borders',
    best: {
      seconds: 400,
      moving_seconds: 400,
      power_watts: 240,
      vam: 720,
      date: '2026-07-01T00:00:00Z',
    },
    last_ridden: '2026-07-01T00:00:00Z',
  }),
  makeGroup({
    id: 'g-3',
    name: 'New Z',
    attempts: 0,
    difficulty: 90,
    area: 'Peebles',
    region: 'Borders',
    best: null,
    last_ridden: null,
    prediction: { seconds: 500, vam: 800, power_watts: 250, confidence: 0.6 },
  }),
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SegmentsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getSegmentGroups.mockReset();
  getSegmentGroups.mockResolvedValue({
    items: GROUPS,
    total: 3,
    counts: { ridden: 2, to_ride: 1, all: 3 },
  });
});

describe('segments atlas', () => {
  it('renders the whole-set counts and one card per group', async () => {
    renderPage();
    expect(
      await screen.findByText(/3 climbs, 2 ridden, 1 still to ride/i)
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('climb-card')).toHaveLength(2);
    expect(screen.getAllByText('Crag X').length).toBeGreaterThan(0);
    expect(screen.getByText(/Your most-ridden climb/i)).toBeInTheDocument();
  });

  it('switches to the unridden set and changes the hero to the next target', async () => {
    renderPage();
    await screen.findAllByTestId('climb-card');
    fireEvent.click(screen.getByText('To ride 1'));
    await waitFor(() =>
      expect(screen.getAllByTestId('climb-card')).toHaveLength(1)
    );
    expect(screen.getAllByText('New Z').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Crag X')).toHaveLength(0);
    expect(screen.getByText(/Your next target/i)).toBeInTheDocument();
  });

  it('searches by name and area', async () => {
    renderPage();
    await screen.findAllByTestId('climb-card');
    fireEvent.change(screen.getByPlaceholderText('Search a climb or area'), {
      target: { value: 'peebles' },
    });
    await waitFor(() =>
      expect(screen.queryAllByText('Crag X')).toHaveLength(0)
    );
    expect(screen.getAllByText('Hill Y').length).toBeGreaterThan(0);
  });

  it('filters by area and composes with the ridden tab', async () => {
    renderPage();
    await screen.findAllByTestId('climb-card');
    fireEvent.change(screen.getByLabelText('Filter by area'), {
      target: { value: 'Borders' },
    });
    await waitFor(() =>
      expect(screen.queryAllByText('Crag X')).toHaveLength(0)
    );
    expect(screen.getAllByText('Hill Y').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('New Z')).toHaveLength(0);
  });

  it('sorts by hardest across the whole set', async () => {
    renderPage();
    await screen.findAllByTestId('climb-card');
    fireEvent.click(screen.getByText('All 3'));
    fireEvent.change(screen.getByLabelText('Sort climbs'), {
      target: { value: 'hardest' },
    });
    const cards = await screen.findAllByTestId('climb-card');
    expect(cards[0].textContent).toContain('New Z');
  });

  it('links each card to its detail page', async () => {
    renderPage();
    const cards = await screen.findAllByTestId('climb-card');
    expect(cards[0]).toHaveAttribute('href', '/segments/g-1');
  });

  it('shows the empty state rather than a blank page when there are no groups', async () => {
    getSegmentGroups.mockResolvedValue({
      items: [],
      total: 0,
      counts: { ridden: 0, to_ride: 0, all: 0 },
    });
    renderPage();
    expect(await screen.findByText('No climbs yet')).toBeInTheDocument();
  });

  it('shows a retry action on failure and recovers', async () => {
    getSegmentGroups
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({
        items: GROUPS,
        total: 3,
        counts: { ridden: 2, to_ride: 1, all: 3 },
      });
    renderPage();
    expect(await screen.findByText('Could not load climbs.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect((await screen.findAllByTestId('climb-card')).length).toBeGreaterThan(0);
  });
});
