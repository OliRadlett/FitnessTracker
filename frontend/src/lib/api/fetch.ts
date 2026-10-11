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

/**
 * Extended API error that carries HTTP-level classification so components
 * can render honest-empty states instead of generic error pages.
 *
 * - isAuthStale: 401 — the backend JWT is missing, expired, or revoked.
 *   Surface the auth-stale banner; data views should show empty states.
 * - isAuthz: 403 — the token is valid but the user lacks permission for
 *   this resource. Do NOT trigger the auth-stale banner.
 */
export interface ApiError extends Error {
  status?: number;
  isAuthStale?: boolean;
  isAuthz?: boolean;
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
    const err = new Error(error.detail || `API error: ${response.status}`) as ApiError;
    // Expose the HTTP status so callers can distinguish "already gone" (404)
    // from a genuine failure without string-matching the message.
    err.status = response.status;
    // Classify stale-backendToken 401s vs authz (403) so data views can
    // render honest-empty states while the auth-stale banner handles the
    // retry messaging. See AuthStaleBanner + isStaleTokenError helper below.
    if (response.status === 401) {
      err.isAuthStale = true;
    } else if (response.status === 403) {
      err.isAuthz = true;
    }
    throw err;
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
    const err = new Error(error.detail || `Upload error: ${response.status}`) as ApiError;
    err.status = response.status;
    if (response.status === 401) {
      err.isAuthStale = true;
    } else if (response.status === 403) {
      err.isAuthz = true;
    }
    throw err;
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

/**
 * True when an apiFetch/apiUpload error is a stale-backend-token 401 (not a
 * 403 authz failure). Components use this to render honest-empty states
 * (e.g. "No data yet") while the AuthStaleBanner surfaces the retry
 * messaging — the banner is the single source of truth for "why" the data
 * is unavailable, so individual views need not duplicate the auth-stale
 * explanation.
 *
 * Usage in a React Query error handler:
 *   if (isStaleTokenError(error)) return undefined; // show empty state
 */
export function isStaleTokenError(err: unknown): boolean {
  if (err instanceof Error && 'isAuthStale' in err) {
    return (err as ApiError).isAuthStale === true;
  }
  return false;
}
