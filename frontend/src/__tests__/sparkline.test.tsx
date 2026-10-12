import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '@/components/ui/Sparkline';

describe('Sparkline', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders nothing (empty) for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeInTheDocument();
    // Should render an empty svg (for single-point fallback)
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders a dot for single-point data (honest empty)', () => {
    const { container } = render(<Sparkline data={[42]} />);
    const circle = container.querySelector('circle');
    expect(circle).toBeInTheDocument();
  });

  it('renders a polyline for 2+ data points', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15, 25]} />,
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
  });

  it('filters out null and undefined values', () => {
    const { container } = render(
      <Sparkline data={[10, null, 20, undefined, 15]} />,
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    // The polyline should have 3 points (10, 20, 15)
    const points = polyline?.getAttribute('points') ?? '';
    const pointCount = points.split(' ').length;
    expect(pointCount).toBe(3);
  });

  it('filters out NaN values', () => {
    const { container } = render(
      <Sparkline data={[10, NaN, 20]} />,
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    const points = polyline?.getAttribute('points') ?? '';
    const pointCount = points.split(' ').length;
    expect(pointCount).toBe(2);
  });

  it('renders a flat line for constant data', () => {
    const { container } = render(
      <Sparkline data={[50, 50, 50, 50]} />,
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    // All y-values should be the same (midpoint)
    const points = (polyline?.getAttribute('points') ?? '').split(' ');
    const yValues = points.map((p) => parseFloat(p.split(',')[1]));
    const uniqueY = new Set(yValues);
    expect(uniqueY.size).toBe(1);
  });

  it('renders an area polygon when area prop is true', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} area={true} />,
    );
    const polygon = container.querySelector('polygon');
    expect(polygon).toBeInTheDocument();
  });

  it('does not render area polygon when area prop is false (default)', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} />,
    );
    const polygon = container.querySelector('polygon');
    expect(polygon).not.toBeInTheDocument();
  });

  it('respects height prop', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} height={40} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('height')).toBe('40');
  });

  it('defaults to height 24', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('uses custom color when provided', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} color="#ff0000" />,
    );
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('#ff0000');
  });

  it('sets aria-hidden on the svg for accessibility', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has finite width in viewBox attribute', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 15]} />,
    );
    const svg = container.querySelector('svg');
    const viewBox = svg?.getAttribute('viewBox');
    expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
  });
});
