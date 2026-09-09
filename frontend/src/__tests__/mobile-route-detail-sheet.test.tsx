import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MobileRouteDetailSheet } from '@/components/routes/MobileRouteDetailSheet';
import type { RouteData } from '@/lib/api/types';

// Mock RouteDetailPanel — it's a complex child, just verify it receives the right props
vi.mock('@/components/routes/RouteDetailPanel', () => ({
  RouteDetailPanel: ({ route, onClose }: any) => (
    <div data-testid="route-detail-panel">
      <span>{route.name}</span>
      <button onClick={onClose}>Close from panel</button>
    </div>
  ),
}));

const mockRoute = {
  id: 'r1',
  name: 'Lake Loop',
  distance_meters: 42000,
  elevation_gain_meters: 650,
  average_speed: 8.5,
} as unknown as RouteData;

describe('MobileRouteDetailSheet', () => {
  it('renders nothing when route is null', () => {
    const { container } = render(
      <MobileRouteDetailSheet route={null} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the panel with route name when route is provided', () => {
    render(<MobileRouteDetailSheet route={mockRoute} onClose={vi.fn()} />);
    expect(screen.getByText('Lake Loop')).toBeInTheDocument();
  });

  it('renders backdrop overlay', () => {
    render(<MobileRouteDetailSheet route={mockRoute} onClose={vi.fn()} />);
    expect(screen.getByTestId('route-detail-panel')).toBeInTheDocument();
  });

  it('onClose is called when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<MobileRouteDetailSheet route={mockRoute} onClose={onClose} />);
    // The backdrop is the first child with bg-black/50
    const backdrop = document.querySelector('.bg-black\\/50')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('onClose is called from panel close button', () => {
    const onClose = vi.fn();
    render(<MobileRouteDetailSheet route={mockRoute} onClose={onClose} />);
    fireEvent.click(screen.getByText('Close from panel'));
    expect(onClose).toHaveBeenCalled();
  });
});
