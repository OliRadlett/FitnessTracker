import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from '@/lib/api/fetch';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('apiFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ id: '1', name: 'Test' })),
    });

    const result = await apiFetch<{ id: string; name: string }>('/api/v1/test');
    expect(result).toEqual({ id: '1', name: 'Test' });
  });

  it('returns undefined for empty response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    });

    const result = await apiFetch('/api/v1/test');
    expect(result).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ detail: 'Not found' }),
    });

    await expect(apiFetch('/api/v1/test')).rejects.toThrow('Not found');
  });

  it('includes Authorization header when token provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({})),
    });

    await apiFetch('/api/v1/test', {}, 'my-token');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-token');
  });
});
