'use client';

// §3.9 Data portability — full JSON export + account deletion, in a Single
// "Danger Zone"-style card at the bottom of Settings. Export triggers a client
// side download; deletion requires typing the account email before the button
// enables, then signs the user out after the server confirms the cascade.

import React, { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { useAuthFetch } from '@/lib/api';
import {
  deleteAccount,
  downloadExport,
  exportFullJson,
} from '@/lib/api/account';

export function DataPortabilityCard() {
  const { authFetch, token } = useAuthFetch();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onExport = async () => {
    if (!token) return;
    setExporting(true);
    setExportError(null);
    try {
      const payload = await exportFullJson(authFetch);
      downloadExport(payload);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const onDelete = async () => {
    if (!token) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(authFetch, confirmEmail.trim());
      setConfirmOpen(false);
      await signOut({ callbackUrl: '/' });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Data &amp; account</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Export all data (JSON)</p>
              <p className="text-xs text-muted mt-0.5">
                Download every activity, session, metric, route, goal and
                preference you have stored — a single portable JSON document.
              </p>
              {exportError && <p className="text-xs text-warning mt-1">{exportError}</p>}
            </div>
            <button
              onClick={onExport}
              disabled={exporting}
              className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-surface-light text-muted hover:text-white disabled:opacity-50"
            >
              {exporting ? 'Preparing…' : 'Download'}
            </button>
          </div>

          <div className="h-px bg-surface-light/50" />

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-warning">Delete account</p>
              <p className="text-xs text-muted mt-0.5">
                Permanently removes your account and all synced and manual data.
                This cannot be undone.
              </p>
              {deleteError && <p className="text-xs text-warning mt-1">{deleteError}</p>}
            </div>
            <button
              onClick={() => setConfirmOpen(true)}
              className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-warning/40 text-warning hover:bg-warning/10"
            >
              Delete…
            </button>
          </div>
        </div>
      </Card>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} size="sm" aria-label="Delete account confirmation">
        <ModalHeader title="Delete account?" onClose={() => setConfirmOpen(false)} icon="⚠️" />
        <p className="text-sm text-muted">
          This permanently deletes your account and all of your data. To
          confirm, type your account email below.
        </p>
        <input
          type="email"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-3 w-full px-3 py-2 text-sm rounded-lg bg-surface-light border border-surface-light text-white placeholder:text-muted focus:outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setConfirmOpen(false)}
            className="px-3 py-2 text-xs rounded-lg border border-surface-light text-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={deleting || confirmEmail.trim() === ''}
            className="px-3 py-2 text-xs rounded-lg bg-warning text-white font-medium hover:bg-warning/80 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </Modal>
    </>
  );
}