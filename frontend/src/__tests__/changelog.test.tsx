import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Changelog } from '@/components/ui/Changelog';

describe('Changelog', () => {
  it('renders all releases', () => {
    render(<Changelog />);
    expect(screen.getByText(/Strength Videos/)).toBeInTheDocument();
    expect(screen.getByText(/Analytics, Segments/)).toBeInTheDocument();
    expect(screen.getByText(/Platform & Integrations/)).toBeInTheDocument();
  });

  it('expands the first release by default', () => {
    render(<Changelog />);
    // First release bullets should be visible
    expect(screen.getByText(/R2 video uploads end-to-end/)).toBeInTheDocument();
  });

  it('collapses expanded release when clicked again', () => {
    render(<Changelog />);
    // Click the first release header to collapse it
    const firstHeader = screen.getByText(/Video Uploads Go Live/).closest('button')!;
    fireEvent.click(firstHeader);
    // Bullet should no longer be visible
    expect(screen.queryByText(/R2 video uploads end-to-end/)).not.toBeInTheDocument();
  });

  it('expands a collapsed release when clicked', () => {
    render(<Changelog />);
    // Second release is collapsed by default
    const secondHeader = screen.getByText(/Analytics, Segments/).closest('button')!;
    fireEvent.click(secondHeader);
    // Its bullets should now be visible
    expect(screen.getByText(/Post-sync background activity analysis/)).toBeInTheDocument();
  });

  it('renders date labels', () => {
    render(<Changelog />);
    expect(screen.getByText('2026-09-09')).toBeInTheDocument();
    expect(screen.getByText('2026-09-08')).toBeInTheDocument();
    expect(screen.getByText('2026-09-07')).toBeInTheDocument();
  });
});
