type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * Undo surface (C6). The mechanism lives in `services/undo.py`; the delete
 * returns the claim id, and this performs it. 409 means the claim is gone,
 * expired, or already undone — surface that as "Already undone", not a crash.
 */
export async function performUndo(authFetch: AuthFetch, logId: string): Promise<void> {
  await authFetch(`/api/v1/undo/${logId}`, { method: 'POST' });
}
