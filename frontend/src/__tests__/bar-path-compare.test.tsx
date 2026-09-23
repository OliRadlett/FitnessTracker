import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { BarPathCompare } from '@/components/lifting/BarPathCompare';
import type { LiftVideo } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn(), token: 'test-token' }),
    getVideoStreamUrl: vi.fn().mockResolvedValue({ url: 'https://r2.test/track.json' }),
  };
});

function makeVideo(overrides: Partial<LiftVideo> = {}): LiftVideo {
  return {
    id: 'v1',
    user_id: 'u1',
    created_at: '2026-09-09T00:00:00Z',
    pose_track_r2_key: 'lift_videos/u1/track.json',
    ...overrides,
  } as LiftVideo;
}

function renderCompare() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BarPathCompare
        videoA={makeVideo({ id: 'a', weight_kg: 140 })}
        videoB={makeVideo({ id: 'b', weight_kg: 150 })}
      />
    </QueryClientProvider>,
  );
}

describe('BarPathCompare', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: async () =>
          JSON.stringify({ version: 1, frames: [], reps: [], bar_path: null }),
      }),
    );
  });

  it('renders a legend with both lifts once tracks load', async () => {
    renderCompare();
    expect(await screen.findByText(/140 kg/)).toBeInTheDocument();
    expect(screen.getByText(/150 kg/)).toBeInTheDocument();
    expect(screen.getByLabelText('Bar path overlay')).toBeInTheDocument();
  });
});
