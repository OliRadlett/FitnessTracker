import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsView } from '@/components/activities/StatsView';
import type { TimeseriesResponse } from '@/lib/api';

// The Stats view used to bucket client-side over a row-capped fetch and
// re-zero-fill the gaps, so a truncated window rendered as a training dip that
// never happened — under a note claiming the view "does not silently chart a
// partial window". These tests pin the replacement: the server's dense series
// is rendered as-is, and the component has no bucket-construction path at all.

vi.mock('@/components/charts/ChartCard', () => ({
  ChartCard: ({
    title,
    data,
  }: {
    title: string;
    data: { labels: string[]; series: { name: string; data: number[] }[] } | null;
  }) => (
    <div data-testid={`chart-${title}`}>
      <h3>{title}</h3>
      {data ? (
        <>
          <span data-testid={`${title}-count`}>{data.labels.length}</span>
          <span data-testid={`${title}-values`}>{data.series[0].data.join(',')}</span>
        </>
      ) : (
        <span data-testid={`${title}-empty`}>empty</span>
      )}
    </div>
  ),
}));

function monthly(overrides: Partial<TimeseriesResponse> = {}): TimeseriesResponse {
  return {
    bucket: 'month',
    start: '2026-04-01',
    end: '2026-09-30',
    complete: true,
    clamped_to: null,
    buckets: [
      { bucket_start: '2026-04-01', count: 4, distance_meters: 120_000, duration_seconds: 14_400, elevation_gain_meters: 800, tss: 320 },
      // A month with no training: present, zero-filled, and that is the point.
      { bucket_start: '2026-05-01', count: 0, distance_meters: 0, duration_seconds: 0, elevation_gain_meters: 0, tss: 0 },
      { bucket_start: '2026-06-01', count: 6, distance_meters: 200_000, duration_seconds: 21_600, elevation_gain_meters: 1_500, tss: 480 },
    ],
    totals: { count: 10, distance_meters: 320_000, duration_seconds: 36_000, elevation_gain_meters: 2_300, tss: 800 },
    sport_breakdown: [
      { sport_type: 'cycling', count: 7 },
      { sport_type: 'running', count: 3 },
    ],
    ...overrides,
  };
}

function weekly(overrides: Partial<TimeseriesResponse> = {}): TimeseriesResponse {
  return {
    bucket: 'week',
    start: '2026-09-07',
    end: '2026-09-27',
    complete: true,
    clamped_to: null,
    buckets: [
      { bucket_start: '2026-09-07', count: 3, distance_meters: 90_000, duration_seconds: 10_800, elevation_gain_meters: 600, tss: 240 },
      { bucket_start: '2026-09-14', count: 2, distance_meters: 60_000, duration_seconds: 7_200, elevation_gain_meters: 400, tss: 160 },
      { bucket_start: '2026-09-21', count: 0, distance_meters: 0, duration_seconds: 0, elevation_gain_meters: 0, tss: 0 },
    ],
    totals: { count: 5, distance_meters: 150_000, duration_seconds: 18_000, elevation_gain_meters: 1_000, tss: 400 },
    sport_breakdown: [],
    ...overrides,
  };
}

const noop = () => {};

describe('StatsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders every server bucket including zero-filled rest periods', () => {
    render(
      <StatsView
        monthly={monthly()}
        weekly={weekly()}
        horizonMonths={6}
        onHorizonChange={noop}
      />,
    );

    // Three months in, three bars out — the empty May is charted, not dropped.
    expect(screen.getByTestId('Monthly Distance-count')).toHaveTextContent('3');
    // 120km, 0km, 200km — the zero is a real bucket, not a missing one.
    expect(screen.getByTestId('Monthly Distance-values')).toHaveTextContent('120,0,200');
  });

  it('renders weekly TSS zero-filled rest weeks', () => {
    render(
      <StatsView
        monthly={monthly()}
        weekly={weekly()}
        horizonMonths={6}
        onHorizonChange={noop}
      />,
    );

    expect(screen.getByTestId('Weekly TSS Trend-values')).toHaveTextContent('240,160,0');
  });

  it('uses the server sport breakdown rather than counting client-side', () => {
    render(
      <StatsView
        monthly={monthly()}
        weekly={weekly()}
        horizonMonths={6}
        onHorizonChange={noop}
      />,
    );

    expect(screen.getByTestId('Sport Breakdown-count')).toHaveTextContent('2');
  });

  it('surfaces a server-side clamp instead of guessing', () => {
    const clamped = monthly({ complete: false, clamped_to: '2026-09-30' });
    render(
      <StatsView
        monthly={clamped}
        weekly={weekly()}
        horizonMonths={6}
        onHorizonChange={noop}
      />,
    );

    // This is the honest signal the deleted note was trying to provide.
    expect(screen.getByRole('status')).toHaveTextContent('Range clamped to 2026-09-30');
  });

  it('shows no clamp notice on a complete range', () => {
    render(
      <StatsView
        monthly={monthly()}
        weekly={weekly()}
        horizonMonths={6}
        onHorizonChange={noop}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('horizon is a user control that reports the chosen depth', async () => {
    const onHorizonChange = vi.fn();
    render(
      <StatsView
        monthly={monthly()}
        weekly={weekly()}
        horizonMonths={24}
        onHorizonChange={onHorizonChange}
      />,
    );

    const select = screen.getByLabelText('Range') as HTMLSelectElement;
    expect(select.value).toBe('24');

    // The horizon was a hardcoded constant before, because the row cap made any
    // other depth wrong. Now it is a choice.
    expect(screen.getByRole('option', { name: '24 months' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '5 years' })).toBeInTheDocument();
  });

  it('renders empty messages when the server returns no buckets', () => {
    const empty: TimeseriesResponse = {
      ...monthly(),
      buckets: [],
      sport_breakdown: [],
    };
    render(
      <StatsView
        monthly={empty}
        weekly={{ ...weekly(), buckets: [] }}
        horizonMonths={6}
        onHorizonChange={noop}
      />,
    );

    expect(screen.getByTestId('Monthly Distance-empty')).toBeInTheDocument();
    expect(screen.getByTestId('Weekly TSS Trend-empty')).toBeInTheDocument();
  });
});
