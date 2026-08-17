import { apiFetch } from './fetch';
import type { User } from './types';

export function getOAuthAuthorizeUrl(provider: string): string {
  return `/api/v1/auth/oauth/${provider}/authorize`;
}

export async function getCurrentUser(): Promise<User> {
  return apiFetch<User>('/api/v1/auth/me');
}
