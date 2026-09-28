/**
 * The `/segments` page is what makes the all-routes capability reachable:
 * `getSegments(authFetch)` with no route filter and `getSegmentDetail()` were
 * both fully built and tested on the backend, but segments only ever appeared
 * inside a route detail panel — so a rider's leaderboard-of-self across routes
 * was unreachable.
 *
 * These tests pin the behaviour that makes the page worth having: the summary
 * stats are computed from the *whole* set rather than the filtered slice, the
 * filters compose, and grouping never leaves a stale heading behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Segment } from '@/lib/api/types';

const getSegments = vi.fn();
const getSegmentDetail = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn(), token: 'test-token' }),
    getSegments: (...args: unknown[]) => getSegments(...args),
    getSegmentDetail: (...args: unknown[]) => getSegmentDetail(...args),
  };
});

vi.mock('@/lib/usePageTitle', () => ({ usePageTitle: () => {} }));

import SegmentsPage from '@/app/(app)/segments/page';

function makeSegment(over: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    route_id: 'route-a',
    route_name: 'Box Hill',
    name: 'Box Hill Climb',
    start_dist_m: 500,
    end_dist_m: 1500,
    distance_m: 1000,
    elevation_gain_m: 100,
    avg_gradient_pct: 10,
    max_gradient_pct: 12.5,
    peak_elevation_m: 150,
    start_lat: 51.44,
    start_lng: -0.27,
    end_lat: 51.45,
    end_lng: -0.27,
    climb_category: '1',
    pr_seconds: 300,
    best_avg_power_watts: 280,
    times_ridden: 3,
    has_pr: true,
    effort_count: 3,
    cluster_id: 1,
    climb_type: 'punchy',
    sustainedness: 0.8,
    difficulty_score: 7.5,
    predicted_vam: 900,
    predicted_time_seconds: 310,
    predicted_power_watts: 275,
    prediction_confidence: 0.7,
    intelligence_analyzed_at: null,
    ...over,
  };
}

const SEGMENTS: Segment[] = [
  makeSegment({ id: 's1', route_id: 'route-a', route_name: 'Box Hill', name: 'Box Hill Climb', avg_gradient_pct: 10, climb_category: '1', times_ridden: 3, elevation_gain_m: 100 }),
  makeSegment({ id: 's2', route_id: 'route-a', route_name: 'Box Hill', name: 'Box Hill Second', avg_gradient_pct: 6, climb_category: '3', times_ridden: 0, elevation_gain_m: 40 }),
  makeSegment({ id: 's3', route_id: 'route-b', route_name: 'Alpe Repeat', name: 'Alpe Kick', avg_gradient_pct: 14, climb_category: 'HC', times_ridden: 1, elevation_gain_m: 200 }),
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SegmentsPage />
    </QueryClientProvider>,
  );
}

/** The route <select> is populated from the data, so both wait on first paint. */
async function waitForSegments() {
  await screen.findByText('Box Hill Climb');
}

function setSelect(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('segments page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSegments.mockResolvedValue(SEGMENTS);
    getSegmentDetail.mockResolvedValue({
      segment: SEGMENTS[0],
      efforts: [
        {
          id: 'e1',
          segment_id: 's1',
          activity_id: 'act-1',
          activity_name: 'Thursday repeats',
          started_at: '2026-09-20T09:00:00Z',
          elapsed_seconds: 300,
          avg_power_watts: 280,
          avg_hr: 155,
          avg_speed_mps: 3.3,
          effort_vam: 950,
          is_pr: true,
        },
      ],
    });
  });

  it('requests every segment once, without a route filter', async () => {
    renderPage();
    await waitForSegments();
    // One call, no route_id — the server must not be narrowed, or the route
    // list and summary stats would be built from a partial set.
    expect(getSegments).toHaveBeenCalledTimes(1);
    expect(getSegments.mock.calls[0]).toHaveLength(1);
  });

  it('groups segments under their route', async () => {
    renderPage();
    await waitForSegments();
    expect(screen.getByText('Alpe Repeat')).toBeTruthy();
    expect(screen.getByText('Box Hill')).toBeTruthy();
  });

  it('orders each group steepest-first', async () => {
    renderPage();
    await waitForSegments();
    const boxHill = screen.getByText('Box Hill').closest('div')!.parentElement!;
    const names = within(boxHill)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    const first = names.findIndex((n) => n.includes('Box Hill Climb'));
    const second = names.findIndex((n) => n.includes('Box Hill Second'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  it('summarises the whole set, not the filtered slice', async () => {
    renderPage();
    await waitForSegments();
    // 3 detected, 2 ridden at least once, 4 total passes, 300 m of gain.
    expect(screen.getByText('3', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('4 total passes')).toBeTruthy();
    expect(screen.getByText('300')).toBeTruthy();
    // Steepest is the 14% Alpe, not the 10% climb shown first.
    expect(screen.getByText('14.0')).toBeTruthy();
  });

  it('filters by route', async () => {
    renderPage();
    await waitForSegments();
    setSelect('Filter by route', 'route-b');
    expect(screen.queryByText('Box Hill Climb')).toBeNull();
    expect(screen.getByText('Alpe Kick')).toBeTruthy();
    // Only the selected route gets a heading.
    expect(screen.queryByText('Box Hill')).toBeNull();
  });

  it('filters by category', async () => {
    renderPage();
    await waitForSegments();
    setSelect('Filter by category', 'HC');
    expect(screen.getByText('Alpe Kick')).toBeTruthy();
    expect(screen.queryByText('Box Hill Climb')).toBeNull();
  });

  it('filters to unridden climbs', async () => {
    renderPage();
    await waitForSegments();
    fireEvent.click(screen.getByRole('button', { name: 'Not yet ridden' }));
    expect(screen.getByText('Box Hill Second')).toBeTruthy();
    expect(screen.queryByText('Alpe Kick')).toBeNull();
  });

  it('filters to ridden climbs', async () => {
    renderPage();
    await waitForSegments();
    fireEvent.click(screen.getByRole('button', { name: 'Ridden only' }));
    expect(screen.queryByText('Box Hill Second')).toBeNull();
    expect(screen.getByText('Alpe Kick')).toBeTruthy();
  });

  it('composes filters', async () => {
    renderPage();
    await waitForSegments();
    setSelect('Filter by route', 'route-a');
    setSelect('Filter by category', '3');
    // Box Hill Second is the only Cat 3 on Box Hill.
    expect(screen.getByText('Box Hill Second')).toBeTruthy();
    expect(screen.queryByText('Box Hill Climb')).toBeNull();
  });

  it('offers a clear action only when a filter is active', async () => {
    renderPage();
    await waitForSegments();
    expect(screen.queryByRole('button', { name: /Clear \d+ filter/ })).toBeNull();
    setSelect('Filter by category', 'HC');
    const clear = screen.getByRole('button', { name: 'Clear 1 filter' });
    fireEvent.click(clear);
    expect(screen.getByText('Box Hill Climb')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clear \d+ filter/ })).toBeNull();
  });

  it('says so when a filter combination matches nothing', async () => {
    renderPage();
    await waitForSegments();
    setSelect('Filter by route', 'route-b');
    setSelect('Filter by category', '4');
    expect(screen.getByText('No climbs match the selected filters.')).toBeTruthy();
  });

  it('drops a route heading once a filter empties it', async () => {
    renderPage();
    await waitForSegments();
    setSelect('Filter by category', 'HC');
    // Alpe is the only HC climb, so Box Hill's heading must not linger.
    expect(screen.getByText('Alpe Repeat')).toBeTruthy();
    expect(screen.queryByText('Box Hill')).toBeNull();
  });

  it('explains the empty state when no segments exist', async () => {
    getSegments.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No climb segments yet/)).toBeTruthy();
  });

  it('shows the error surface and can retry', async () => {
    getSegments.mockRejectedValue(new Error('boom'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load climb segments');
    getSegments.mockResolvedValue(SEGMENTS);
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Box Hill Climb')).toBeTruthy();
  });
});
