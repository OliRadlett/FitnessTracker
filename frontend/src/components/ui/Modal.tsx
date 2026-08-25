'use client';

import React, { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Max width on desktop — defaults to 'lg' */
  size?: 'sm' | 'lg' | 'xl';
  /** Accessible label for the dialog */
  'aria-label'?: string;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-lg',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-4xl',
};

/**
 * Responsive modal:
 *  - Mobile (<sm): bottom sheet, full-width, rounded top corners
 *  - Desktop (≥sm): centered dialog, preserves existing max-w sizing
 */
export function Modal({ open, onClose, children, size = 'lg', 'aria-label': ariaLabel }: ModalProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`
          bg-surface border border-surface-light shadow-2xl w-full overflow-y-auto
          rounded-t-xl sm:rounded-xl
          max-h-[90vh] sm:max-h-[85vh]
          p-4 sm:p-6
          ${SIZE_CLASSES[size]}
        `}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  title: string;
  onClose: () => void;
  icon?: string;
}

export function ModalHeader({ title, onClose, icon }: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        {icon && <span aria-hidden="true">{icon}</span>}
        {title}
      </h3>
      <button onClick={onClose} className="text-muted hover:text-white text-xl" aria-label="Close">
        ×
      </button>
    </div>
  );
}
