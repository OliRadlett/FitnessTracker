import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// Component that throws on render
function ThrowingComponent() {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  // Suppress console.error for expected errors
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  it('resets error state when retry is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Click retry
    fireEvent.click(screen.getByText('Try again'));

    // After retry, the error boundary resets its state.
    // Since ThrowingComponent will throw again on re-render,
    // we need to render a non-throwing component to verify reset works.
    rerender(
      <ErrorBoundary>
        <div>Recovered</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});
