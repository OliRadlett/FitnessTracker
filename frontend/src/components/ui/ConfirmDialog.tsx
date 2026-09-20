'use client';

import React from 'react';
import { Modal, ModalHeader } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirm dialog for destructive/irreversible actions.
 * Replaces native `confirm()` and ad-hoc two-step buttons.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} size="sm" aria-label={title}>
      <ModalHeader title={title} onClose={onCancel} />
      {description ? <div className="text-sm text-muted mb-5">{description}</div> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
