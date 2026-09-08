'use client';

// §3.9 Account data portability — full JSON export + account deletion.
// Both endpoints live under /api/v1/export and /api/v1/account.

import type { DeleteAccountResult, FullExportPayload } from './types/export';

type AuthFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/** Fetch the full per-user JSON export document. */
export async function exportFullJson(authFetch: AuthFetch): Promise<FullExportPayload> {
  return authFetch<FullExportPayload>('/api/v1/export/json');
}

/** Permanently delete the account. `confirmEmail` must match exactly. */
export async function deleteAccount(
  authFetch: AuthFetch,
  confirmEmail: string,
): Promise<DeleteAccountResult> {
  return authFetch<DeleteAccountResult>('/api/v1/account/delete', {
    method: 'DELETE',
    body: JSON.stringify({ confirm_email: confirmEmail }),
  });
}

/** Trigger a browser download of the export document as a JSON file. */
export function downloadExport(payload: FullExportPayload): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fittrack_export_${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}