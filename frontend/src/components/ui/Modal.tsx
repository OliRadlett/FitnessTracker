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
  /**
   * Opt-in dirty-form guard: when provided and it returns false, backdrop and
   * Escape closes are ignored so a stray tap can't discard in-progress input.
   */
  guardClose?: () => boolean;
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
export function Modal({ open, onClose, children, size = 'lg', 'aria-label': ariaLabel, guardClose }: ModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);

  function tryClose() {
    if (guardClose && !guardClose()) return;
    onClose();
  }

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

  // Mark the app shell inert while open so screen readers / Tab can't reach
  // content behind the sheet. The layout renders a single <main>.
  useEffect(() => {
    if (!open) return;
    const main = document.querySelector('main');
    main?.setAttribute('inert', '');
    return () => {
      main?.removeAttribute('inert');
    };
  }, [open ]);

  // Close on Escape (guarded) + focus the dialog on open + trap Tab inside
  const focusedOnOpen = React.useRef(false);
  useEffect(() => {
    if (!open) {
      focusedOnOpen.current = false;
      return;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        tryClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    // Initial focus once per open — never steal focus on re-renders
    if (!focusedOnOpen.current) {
      focusedOnOpen.current = true;
      const first =
        dialogRef.current?.querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]'
        ) ?? null;
      (first ?? dialogRef.current)?.focus();
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, guardClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={tryClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`
          bg-surface border border-surface-light shadow-2xl w-full overflow-y-auto
          rounded-t-xl sm:rounded-xl
          max-h-[90vh] sm:max-h-[85vh]
          p-4 sm:p-6
          ${SIZE_CLASSES[size]}
        `}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
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
      <button onClick={onClose} className="text-muted hover:text-white text-xl min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
        ×
      </button>
    </div>
  );
}
