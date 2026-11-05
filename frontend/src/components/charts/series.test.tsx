import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { BarSeries } from './BarSeries';
import { LineSeries } from './LineSeries';
import { Spark } from './Spark';
import { StackBar } from './StackBar';
import { fitDomain } from './chartScale';

// jsdom has no layout, so the measured-width hook needs a ResizeObserver that
// reports a fixed box. 600 px keeps every tick inside the plot, which is what
// the assertions below rely on.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) {
        this.cb([{ contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        void el;
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

const labels = ['1 May', '2 May', '3 May', '4 May', '5 May'];

describe('LineSeries', () => {
  const series = [
    { name: 'CTL', color: '#22c55e', points: [30, 28, 26, 24, 21].map((y, x) => ({ x, y })) },
    { name: 'ATL', color: '#60a5fa', points: [32, 30, 27, 23, 19].map((y, x) => ({ x, y })) },
  ];

  it('draws one path per series and labels each series where it ends', () => {
    const { container } = render(<LineSeries series={series} labels={labels} yTitle="Load" />);
    expect(container.querySelectorAll('path')).toHaveLength(2);

    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toContain('21');
    expect(texts).toContain('19');
  });

  it('names its own end tick so the series does not look truncated', () => {
    const { container } = render(<LineSeries series={series} labels={labels} />);
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toContain('5 May');
  });

  it('keeps a reference line visible and labelled', () => {
    const { container } = render(
      <LineSeries series={[series[0]]} labels={labels} refY={{ value: 21, label: 'FTP 212.5', color: '#f59e0b' }} />,
    );
    expect([...container.querySelectorAll('text')].map((t) => t.textContent)).toContain('FTP 212.5');
    expect(container.querySelector('line[stroke-dasharray]')).not.toBeNull();
  });

  it('fits the axis to the data instead of starting at zero by default', () => {
    const { container } = render(<LineSeries series={[series[0]]} labels={labels} />);
    // The first y tick label is the domain floor; for 21–30 data it must be > 0.
    const below = [...container.querySelectorAll('text')].map((t) => t.textContent ?? '');
    expect(below).not.toContain('0');
    const [lo] = fitDomain([30, 28, 26, 24, 21]);
    expect(lo).toBeGreaterThan(0);
  });

  it('renders a gap rather than a dive to zero for missing points', () => {
    const withGap = [{ name: 'CTL', color: '#22c55e', points: [{ x: 0, y: 5 }, { x: 1, y: null }, { x: 2, y: 7 }] }];
    const { container } = render(<LineSeries series={withGap} labels={['a', 'b', 'c']} />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2); // two subpaths, no bridge across the null
  });
});

describe('BarSeries', () => {
  it('draws one rect per non-null value, coloured by sign', () => {
    const { container } = render(<BarSeries values={[3, -2, null, 5]} labels={['a', 'b', 'c', 'd']} />);
    const rects = [...container.querySelectorAll('rect')];
    expect(rects).toHaveLength(3);
    expect(rects[1].getAttribute('fill')).toBe('#ef4444'); // negative
    expect(rects[0].getAttribute('fill')).toBe('#3b82f6'); // positive
  });

  it('always includes zero in the domain so the baseline is on screen', () => {
    const { container } = render(<BarSeries values={[3, 5, 7]} labels={['a', 'b', 'c']} />);
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toContain('0');
  });
});

describe('StackBar', () => {
  it('splits by value and exposes the split to assistive tech', () => {
    const { container } = render(
      <StackBar segments={[{ value: 50, color: '#111', label: 'Z1' }, { value: 25, color: '#222', label: 'Z2' }]} />,
    );
    const root = container.querySelector('[role="img"]');
    expect(root?.getAttribute('aria-label')).toBe('Z1, Z2');

    const widths = [...(root?.children ?? [])].map((d) => parseFloat((d as HTMLElement).style.width));
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeCloseTo(66.67, 1);
    expect(widths[1]).toBeCloseTo(33.33, 1);
  });
});

describe('Spark', () => {
  it('draws a line and marks the last point', () => {
    const { container } = render(<Spark values={[1, 3, 2, 5]} />);
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelector('circle')).not.toBeNull();
  });

  it('renders nothing but a spacer for fewer than two points', () => {
    const { container } = render(<Spark values={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
