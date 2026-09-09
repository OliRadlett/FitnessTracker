import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { VideoEmbed, VideoChip } from '@/components/lifting/VideoEmbed';
import { getVideoStreamUrl } from '@/lib/api';
import type { LiftVideo } from '@/lib/api';

// Mock the API client to avoid real network calls
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    useAuthFetch: () => ({ authFetch: vi.fn() }),
    getVideoStreamUrl: vi.fn(),
  };
});

const mockGetVideoStreamUrl = getVideoStreamUrl as unknown as ReturnType<typeof vi.fn>;

function makeVideo(overrides: Partial<LiftVideo> = {}): LiftVideo {
  return {
    id: 'v1',
    user_id: 'u1',
    r2_key: 'lift_videos/u1/abc123-clip.mp4',
    file_name: 'clip.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
    exercise_name: 'Squat',
    created_at: '2026-09-09T00:00:00Z',
    updated_at: '2026-09-09T00:00:00Z',
    ...overrides,
  } as LiftVideo;
}

describe('VideoEmbed', () => {
  beforeEach(() => {
    mockGetVideoStreamUrl.mockClear();
  });

  it('fetches the stream URL and renders a video element', async () => {
    mockGetVideoStreamUrl.mockResolvedValueOnce({ url: 'https://r2.test/stream.mp4' });
    const { container } = render(<VideoEmbed video={makeVideo()} />);
    expect(screen.getByText('Loading video…')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('video')).toBeInTheDocument();
    });
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://r2.test/stream.mp4',
    );
    expect(mockGetVideoStreamUrl).toHaveBeenCalledTimes(1);
  });

  it('shows an error with retry when the stream load fails', async () => {
    mockGetVideoStreamUrl.mockRejectedValueOnce(new Error('boom'));
    render(<VideoEmbed video={makeVideo()} />);
    await screen.findByText(/boom/);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('retry button re-requests the stream URL', async () => {
    mockGetVideoStreamUrl.mockRejectedValueOnce(new Error('boom'));
    mockGetVideoStreamUrl.mockResolvedValueOnce({ url: 'https://r2.test/retry.mp4' });
    const { container } = render(<VideoEmbed video={makeVideo()} />);
    await screen.findByText(/boom/);
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => {
      expect(container.querySelector('video')).toBeInTheDocument();
    });
    expect(mockGetVideoStreamUrl).toHaveBeenCalledTimes(2);
  });

  it('does not fetch when the video has no r2_key', () => {
    mockGetVideoStreamUrl.mockClear();
    render(<VideoEmbed video={makeVideo({ r2_key: null })} />);
    expect(screen.getByText('Loading video…')).toBeInTheDocument();
    expect(mockGetVideoStreamUrl).not.toHaveBeenCalled();
  });
});

describe('VideoChip', () => {
  it('renders with count', () => {
    const { container } = render(<VideoChip count={3} />);
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('📹');
  });

  it('renders nothing when count is 0', () => {
    const { container } = render(<VideoChip count={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is negative', () => {
    const { container } = render(<VideoChip count={-1} />);
    expect(container.innerHTML).toBe('');
  });

  it('includes correct title attribute', () => {
    render(<VideoChip count={1} />);
    expect(screen.getByTitle('1 strength video')).toBeInTheDocument();
  });

  it('uses plural title for count > 1', () => {
    render(<VideoChip count={5} />);
    expect(screen.getByTitle('5 strength videos')).toBeInTheDocument();
  });
});
