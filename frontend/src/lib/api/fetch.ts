import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

// Always use relative URLs — Next.js rewrites or Caddy proxy handles routing to backend.
// Do NOT use NEXT_PUBLIC_API_URL here to avoid mixed-content / CORS issues.
//
// CSRF note: The API uses JWT Bearer tokens sent via the Authorization header
// (not cookies), so browsers do not automatically attach credentials on
// cross-origin requests.  Combined with server-side CORS origin restrictions,
// this effectively mitigates CSRF attacks without needing additional CSRF
// tokens or SameSite cookie attributes.
const API_BASE_URL = '';

export interface FetchResult<T> {
  data: T;
  headers: Headers;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const { data } = await apiFetchWithHeaders<T>(path, options, token);
  return data;
}

export async function apiFetchWithHeaders<T>(path: string, options: RequestInit = {}, token?: string): Promise<FetchResult<T>> {
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
  if (!text) return { data: undefined as T, headers: response.headers };
  return { data: JSON.parse(text), headers: response.headers };
}

/**
 * Upload a file via multipart/form-data.  Unlike ``apiFetch`` this does NOT
 * set ``Content-Type: application/json`` — the browser will set the correct
 * multipart boundary automatically.
 */
export async function apiUpload<T>(path: string, formData: FormData, token?: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `Upload error: ${response.status}`);
  }

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

  const authFetchWithHeaders = useCallback(
    <T>(path: string, options: RequestInit = {}) => {
      return apiFetchWithHeaders<T>(path, options, token);
    },
    [token],
  );

  const authUpload = useCallback(
    <T>(path: string, formData: FormData) => {
      return apiUpload<T>(path, formData, token);
    },
    [token],
  );

  return { authFetch, authFetchWithHeaders, authUpload, token };
}
