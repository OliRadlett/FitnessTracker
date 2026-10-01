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
const getClimbDetail = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn(), token: 'test-token' }),
    getSegments: (...args: unknown[]) => getSegments(...args),
    getSegmentDetail: (...args: unknown[]) => getSegmentDetail(...args),
    getClimbDetail: (...args: unknown[]) => getClimbDetail(...args),
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
    // Unclustered by default, which is the honest state for a fresh rider: the
    // weekly intelligence task fills this in. Giving every fixture the same id
    // would merge unrelated climbs into a single row and silently break every
    // per-climb assertion in this file.
    geo_cluster_id: null,
    geo_cluster_size: 1,
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

/**
 * Switch the grouping toggle.
 *
 * The page now defaults to grouping by **hill** (plan section 3), because the
 * per-route view is the same hill repeated, which is exactly what hid the
 * rider's real best. Tests that assert route-grouping behaviour must therefore
 * select it explicitly rather than relying on it being the default; otherwise
 * they would be testing "the default happens to be route" and would silently
 * stop covering the route view the moment the default changes again.
 */
function setGrouping(label: 'By hill' | 'By route') {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

async function renderRouteView() {
  const utils = renderPage();
  await waitForSegments();
  setGrouping('By route');
  return utils;
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
    await renderRouteView();
    expect(screen.getByText('Alpe Repeat')).toBeTruthy();
    expect(screen.getByText('Box Hill')).toBeTruthy();
  });

  it('orders each group steepest-first', async () => {
    await renderRouteView();
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
    await renderRouteView();
    fireEvent.click(screen.getByRole('button', { name: 'Ridden only' }));
    expect(screen.queryByText('Box Hill Second')).toBeNull();
    expect(screen.getByText('Alpe Kick')).toBeTruthy();
  });

  it('filters to ridden climbs in the hill view too', async () => {
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
    await renderRouteView();
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

// ---------------------------------------------------------------------------
// Hill grouping and the surfaced intelligence (plan section 3)
// ---------------------------------------------------------------------------

describe('segments page - hill grouping', () => {
  beforeEach(() => {
    // The first suite's beforeEach, which does the clearing, only runs for
    // tests inside it. Each new suite must clear its own mock history, or
    // `expect(getClimbDetail).not.toHaveBeenCalled()` sees calls made by
    // earlier tests here and fails for entirely the wrong reason.
    vi.clearAllMocks();
  });

  /**
   * One hill detected on two routes: two segment rows, one `geo_cluster_id`.
   *
   * This is the case the whole feature exists for. Without it the same climb
   * appears twice with two PRs, and since the list is grouped by route there is
   * nowhere to show the rider's real best.
   */
  const SHARED = [
    makeSegment({
      id: 's-box',
      route_id: 'route-a',
      route_name: 'Box Hill Loop',
      name: 'Box Hill Loop climb',
      geo_cluster_id: 'hill-shared',
      geo_cluster_size: 2,
      times_ridden: 4,
      pr_seconds: 291,
      avg_gradient_pct: 9.4,
    }),
    makeSegment({
      id: 's-alpe',
      route_id: 'route-b',
      route_name: 'Alpe Loop',
      name: 'Alpe Loop climb',
      geo_cluster_id: 'hill-shared',
      geo_cluster_size: 2,
      times_ridden: 2,
      pr_seconds: 318,
      avg_gradient_pct: 9.7,
    }),
  ];

  const EFFORT = {
    id: 'e1',
    segment_id: 's-box',
    activity_id: 'act-1',
    activity_name: 'Thursday repeats',
    started_at: '2026-09-20T09:00:00Z',
    elapsed_seconds: 291,
    avg_power_watts: 288,
    avg_hr: 158,
    avg_speed_mps: 3.4,
    effort_vam: 1010,
    is_pr: true,
  };

  beforeEach(() => {
    getSegments.mockResolvedValue(SHARED);
    getSegmentDetail.mockResolvedValue({ segment: SHARED[0], efforts: [EFFORT] });
    getClimbDetail.mockResolvedValue({
      geo_cluster_id: 'hill-shared',
      name: 'Box Hill Loop climb',
      route_count: 2,
      segments: SHARED,
      efforts: [
        EFFORT,
        {
          ...EFFORT,
          id: 'e2',
          segment_id: 's-alpe',
          activity_id: 'act-2',
          activity_name: 'Sunday long ride',
          elapsed_seconds: 318,
          avg_power_watts: 262,
          effort_vam: 870,
          is_pr: false,
        },
      ],
    });
  });

  it('collapses one hill detected on two routes into a single row', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    // The hill view is the default: the per-route view is this hill twice over.
    expect(screen.queryByText('Alpe Loop climb')).toBeNull();
    expect(screen.getByText('Box Hill Loop climb')).toBeTruthy();
  });

  it('shows the most-ridden detection as the canonical row', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    // times_ridden 4 against 2, so the Box Hill detection represents the hill
    // even though the Alpe detection is marginally steeper.
    expect(screen.getByText('Box Hill Loop climb')).toBeTruthy();
  });

  it('says how many other routes the hill appears on', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    expect(screen.getByText(/Also detected on 1 other route/)).toBeTruthy();
  });

  it('sums passes across every route the hill appears on', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    // 4 + 2 = 6 passes for one hill, not 4.
    // Scoped to the row: the summary stat card shows the same number for the
    // ungrouped total, and `getByText` would otherwise find two matches.
    expect(
      screen.getByText(/Also detected on 1 other route .* 6 total passes/)
    ).toBeTruthy();
  });

  it('opens a merged leaderboard for the whole hill', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    fireEvent.click(screen.getByText('Box Hill Loop climb'));
    expect(getClimbDetail).toHaveBeenCalledWith(
      expect.anything(),
      'hill-shared'
    );
    // Both routes' efforts appear, not only the row's own route.
    expect(await screen.findByText('Thursday repeats')).toBeTruthy();
    expect(await screen.findByText('Sunday long ride')).toBeTruthy();
  });

  it('labels the merged leaderboard as ranked by VAM', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    fireEvent.click(screen.getByText('Box Hill Loop climb'));
    // Ranking by elapsed seconds across routes would be quietly wrong, so the
    // reason is stated on screen rather than left for the rider to infer.
    expect(await screen.findByText(/ranked by VAM/)).toBeTruthy();
  });

  it('keeps the route view available and unmerged', async () => {
    renderPage();
    await screen.findByText('Box Hill Loop climb');
    setGrouping('By route');
    expect(screen.getByText('Box Hill Loop climb')).toBeTruthy();
    expect(screen.getByText('Alpe Loop climb')).toBeTruthy();
  });

  it('treats an unclustered segment as a hill of one', async () => {
    // `geo_cluster_id: null` means the weekly task has not clustered it yet.
    // It must still be listed, because silently dropping unclustered climbs
    // would hide real ones, and it must not trigger a hill request.
    getSegments.mockResolvedValue([
      makeSegment({ id: 's-lonely', name: 'Lonely Hill', geo_cluster_id: null }),
    ]);
    renderPage();
    await screen.findByText('Lonely Hill');
    fireEvent.click(screen.getByText('Lonely Hill'));
    expect(getClimbDetail).not.toHaveBeenCalled();
    expect(screen.queryByText(/Also detected on/)).toBeNull();
  });

  it('does not request a hill detail for a hill seen on one route only', async () => {
    // geo_cluster_size is 1, so the merged panel would be a duplicate request
    // for data the per-route leaderboard is already showing.
    getSegments.mockResolvedValue([
      makeSegment({ id: 's-solo', name: 'Solo Hill', geo_cluster_size: 1 }),
    ]);
    renderPage();
    await screen.findByText('Solo Hill');
    fireEvent.click(screen.getByText('Solo Hill'));
    expect(getClimbDetail).not.toHaveBeenCalled();
  });
});

describe('segments page - intelligence surfaced', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the prediction that was stored but never shown', async () => {
    getSegments.mockResolvedValue([
      makeSegment({
        id: 's-pred',
        name: 'Predicted Hill',
        predicted_time_seconds: 312,
        predicted_vam: 903,
        sustainedness: 0.62,
        prediction_confidence: 0.44,
      }),
    ]);
    renderPage();
    await screen.findByText('Predicted Hill');
    // predicted_time_seconds and predicted_vam were computed every Sunday by
    // the weekly Modal task and rendered nowhere at all.
    expect(screen.getByText(/pred 5:12/)).toBeTruthy();
    expect(screen.getByText(/~903 VAM/)).toBeTruthy();
    expect(screen.getByText('sust 62%')).toBeTruthy();
  });

  it('describes confidence as a band, not a number', async () => {
    getSegments.mockResolvedValue([
      makeSegment({
        id: 's-med',
        name: 'Medium Hill',
        predicted_time_seconds: 300,
        prediction_confidence: 0.44,
      }),
    ]);
    renderPage();
    await screen.findByText('Medium Hill');
    // The raw number is deliberately not shown. `_predict_segment_effort` floors
    // confidence at 0.2 when there are no similar efforts to borrow from, so
    // "0.2" beside a prediction would read as broken rather than uninformed.
    expect(screen.getByText(/medium confidence/)).toBeTruthy();
    expect(screen.queryByText(/0\.44/)).toBeNull();
  });

  it('says low confidence rather than implying a failure', async () => {
    getSegments.mockResolvedValue([
      makeSegment({
        id: 's-low',
        name: 'Bare Hill',
        predicted_time_seconds: 420,
        prediction_confidence: 0.2,
      }),
    ]);
    renderPage();
    await screen.findByText('Bare Hill');
    expect(screen.getByText(/low confidence/)).toBeTruthy();
  });

  it('omits the prediction line when there is no prediction', async () => {
    getSegments.mockResolvedValue([
      makeSegment({
        id: 's-none',
        name: 'Unanalysed Hill',
        predicted_time_seconds: null,
        predicted_vam: null,
        prediction_confidence: null,
        sustainedness: null,
      }),
    ]);
    renderPage();
    await screen.findByText('Unanalysed Hill');
    expect(screen.queryByText(/pred /)).toBeNull();
    expect(screen.queryByText(/confidence/)).toBeNull();
  });
});
