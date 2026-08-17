import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

// Always use relative URLs — Next.js rewrites or Caddy proxy handles routing to backend.
// Do NOT use NEXT_PUBLIC_API_URL here to avoid mixed-content / CORS issues.
const API_BASE_URL = '';

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API error: ${response.status}`);
  }

  // Handle 204 No Content and other empty responses
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text);
}

/**
 * Hook that returns an authenticated apiFetch function using the backend JWT from the session.
 */
export function useAuthFetch() {
  const { data: session } = useSession();
  const token = session?.backendToken;

  const authFetch = useCallback(
    <T>(path: string, options: RequestInit = {}) => {
      return apiFetch<T>(path, options, token);
    },
    [token],
  );

  return { authFetch, token };
}
