import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Chart, ChartBody } from '@/components/charts/Chart';
import type { ChartData } from '@/lib/api';

// Bypass ResponsiveContainer's size detection (jsdom is always 0x0) but keep
// every real recharts component so axis/yAxisId invariants still throw.
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div className="recharts-responsive-container" style={{ width: 600, height: 300 }}>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<{ width?: number; height?: number }>, {
                width: 600,
                height: 300,
              })
            : child,
        )}
      </div>
    ),
  };
});

// Recharts throws Invariant errors when axis ids don't match graphical
// components (e.g. YAxis yAxisId without matching Bar yAxisId). These tests
// render every chart_type so such crashes fail loudly here.
describe('Chart rendering', () => {
  it.each(['line', 'bar', 'area'] as const)(
    'renders %s chart with single series (default left axis)',
    (chartType) => {
      const data: ChartData = {
        chart_type: chartType,
        title: `Test ${chartType}`,
        labels: ['2026-01-01', '2026-01-02', '2026-01-03'],
        series: [{ name: 'Value', data: [1, 2, 3] }],
        x_label: 'Date',
        y_label: 'TSS',
      };
      const { container } = render(<Chart data={data} height={300} />);
      expect(container.querySelector('.recharts-wrapper')).toBeInTheDocument();
    },
  );

  it.each(['line', 'bar', 'area'] as const)(
    'renders %s chart with secondary y_axis series and reference areas',
    (chartType) => {
      const data: ChartData = {
        chart_type: chartType,
        title: `Dual-axis ${chartType}`,
        labels: ['a', 'b', 'c'],
        series: [
          { name: 'Left', data: [1, 2, 3] },
          { name: 'Right', data: [10, 20, 30], y_axis: 'right' },
        ],
        reference_areas: [
          { y1: -30, y2: 5, color: '#ef4444', label: 'Zone', y_axis: 'right' },
          { y1: 0, y2: 10, color: '#22c55e' },
        ],
      };
      const { container } = render(<Chart data={data} height={300} />);
      expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(2);
    },
  );

  it('renders bar chart with reference areas (ramp rate shape)', () => {
    const data: ChartData = {
      chart_type: 'bar',
      title: 'Ramp Rate',
      labels: ['w1', 'w2'],
      series: [{ name: 'Δ CTL / week', data: [4.2, -1.1] }],
      reference_areas: [
        { y1: -10, y2: -2, color: '#ef4444', label: 'Detraining' },
        { y1: 3, y2: 8, color: '#22c55e', label: 'Optimal build' },
      ],
    };
    const { container } = render(<Chart data={data} height={300} />);
    expect(container.querySelector('.recharts-bar')).toBeInTheDocument();
  });

  it('renders scatter chart with reference areas and axis labels', () => {
    const data: ChartData = {
      chart_type: 'scatter',
      title: 'Strain vs Recovery',
      labels: ['70', '80'],
      series: [{ name: 'Days', data: [50, 60] }],
      x_label: 'Strain',
      y_label: 'Recovery %',
      reference_areas: [{ y1: 0, y2: 33, color: '#ef4444' }],
    };
    const { container } = render(<Chart data={data} height={300} />);
    expect(container.querySelector('.recharts-scatter')).toBeInTheDocument();
  });

  it('renders heatmap chart type', () => {
    const data: ChartData = {
      chart_type: 'heatmap',
      title: 'Consistency',
      labels: ['2026-08-01', '2026-08-02', '2026-08-03'],
      series: [{ name: 'TSS', data: [0, 55, 120] }],
    };
    const { container } = render(<Chart data={data} height={300} />);
    expect(container.textContent).toContain('Consistency');
  });

  it('renders pie chart', () => {
    const data: ChartData = {
      chart_type: 'pie',
      title: 'Breakdown',
      labels: ['Squat', 'Bench'],
      series: [{ name: 'Volume', data: [100, 80] }],
    };
    const { container } = render(<Chart data={data} height={300} />);
    expect(container.querySelector('.recharts-pie')).toBeInTheDocument();
  });
});

describe('ChartBody states', () => {
  it('shows loading spinner while isLoading', () => {
    const { container } = render(
      <ChartBody isLoading data={undefined} emptyMessage="No data" height={200} />,
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<ChartBody isLoading={false} data={undefined} emptyMessage="No TSS data" height={200} />);
    expect(document.body.textContent).toContain('No TSS data');
  });

  it('shows empty message for all-null series', () => {
    const data: ChartData = {
      chart_type: 'line',
      title: 'Empty',
      labels: ['a'],
      series: [{ name: 'V', data: [null] }],
    };
    render(<ChartBody isLoading={false} data={data} emptyMessage="Nothing here" height={200} />);
    expect(document.body.textContent).toContain('Nothing here');
  });
});
