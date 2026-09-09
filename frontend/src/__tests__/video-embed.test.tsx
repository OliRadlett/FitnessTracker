import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  getVideoEmbedUrl,
  isYouTubeUrl,
  isVimeoUrl,
  VideoChip,
} from '@/components/lifting/VideoEmbed';

describe('getVideoEmbedUrl', () => {
  it('converts standard YouTube watch URL', () => {
    expect(getVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
  });

  it('converts YouTube short URL', () => {
    expect(getVideoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
  });

  it('converts YouTube embed URL', () => {
    expect(getVideoEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
  });

  it('converts Vimeo standard URL', () => {
    expect(getVideoEmbedUrl('https://vimeo.com/12345678')).toBe(
      'https://player.vimeo.com/video/12345678?title=0&byline=0&badge=0',
    );
  });

  it('converts Vimeo player embed URL', () => {
    expect(getVideoEmbedUrl('https://player.vimeo.com/video/12345678')).toBe(
      'https://player.vimeo.com/video/12345678?title=0&byline=0&badge=0',
    );
  });

  it('returns null for unsupported host', () => {
    expect(getVideoEmbedUrl('https://example.com/video.mp4')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getVideoEmbedUrl('')).toBeNull();
  });
});

describe('isYouTubeUrl / isVimeoUrl', () => {
  it.each([
    ['https://youtube.com/watch?v=abc', true],
    ['https://youtu.be/abc', true],
    ['https://vimeo.com/123', false],
    ['https://example.com', false],
  ])('isYouTubeUrl("%s") → %s', (url, expected) => {
    expect(isYouTubeUrl(url)).toBe(expected);
  });

  it.each([
    ['https://vimeo.com/12345', true],
    ['https://player.vimeo.com/video/123', true],
    ['https://youtube.com/watch?v=abc', false],
    ['https://example.com', false],
  ])('isVimeoUrl("%s") → %s', (url, expected) => {
    expect(isVimeoUrl(url)).toBe(expected);
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
