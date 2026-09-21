'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

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

// Tracks concurrently open modals so scroll/inert locks are only released
// once the last one closes.
let openModalCount = 0;
let savedBodyOverflow: string | null = null;
let savedHtmlOverflow: string | null = null;
let savedMainOverflow: string | null = null;

/**
 * Responsive modal:
 *  - Mobile (<sm): bottom sheet, full-width, rounded top corners
 *  - Desktop (≥sm): centered dialog, preserves existing max-w sizing
 *
 * Rendered via portal to document.body so the `inert` background lock on
 * <main> never covers the dialog itself (an inert ancestor disables all
 * clicks / form input inside it — the cause of dead X buttons and inputs).
 */
export function Modal({ open, onClose, children, size = 'lg', 'aria-label': ariaLabel, guardClose }: ModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  function tryClose() {
    if (guardClose && !guardClose()) return;
    onClose();
  }

  // Lock scroll on every scroll container when open. The app shell scrolls
  // inside <main class="overflow-y-auto">, not <body>, so locking body alone
  // leaves the background scrollable. Reference-counted so stacked modals
  // only restore scroll once the last one closes (StrictMode-safe via cleanup).
  useEffect(() => {
    if (!open) return;
    // Only the outermost modal saves/restores overflow: inner modals open
    // while overflow is already 'hidden', so their "previous" value would
    // wrongly restore to 'hidden' and trap the page unscrollable.
    const isOutermost = openModalCount === 0;
    openModalCount += 1;
    const main = document.querySelector('main');
    if (isOutermost) {
      savedBodyOverflow = document.body.style.overflow;
      savedHtmlOverflow = document.documentElement.style.overflow;
      savedMainOverflow = main instanceof HTMLElement ? main.style.overflow : null;
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (main instanceof HTMLElement) main.style.overflow = 'hidden';
    // Mark the app shell inert while open so screen readers / Tab can't reach
    // content behind the sheet. The dialog lives in a body-level portal so it
    // is never inside the inert subtree. Query inside the effect (not render)
    // so the element exists even on first mount.
    const shell = document.querySelector('main');
    shell?.setAttribute('inert', '');
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = savedBodyOverflow ?? '';
        document.documentElement.style.overflow = savedHtmlOverflow ?? '';
        if (main instanceof HTMLElement) main.style.overflow = savedMainOverflow ?? '';
        savedBodyOverflow = savedHtmlOverflow = savedMainOverflow = null;
        shell?.removeAttribute('inert');
      }
    };
  }, [open]);

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
        // offsetParent is null for fixed-position elements, so visibility is
        // checked via layout boxes instead — otherwise focusable controls get
        // filtered out and keyboard users can't reach form fields.
      ).filter((el) => el.getClientRects().length > 0);
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
  if (!mounted || typeof document === 'undefined') return null;

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={tryClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`
          bg-surface border border-surface-light shadow-2xl w-full overflow-y-auto overscroll-contain
          rounded-t-xl sm:rounded-xl
          max-h-[90dvh] sm:max-h-[85vh]
          p-4 sm:p-6
          ${SIZE_CLASSES[size]}
        `}
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

interface ModalHeaderProps {
  title: string;
  onClose: () => void;
  icon?: string;
}

export function ModalHeader({ title, onClose, icon }: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
        {icon && <span aria-hidden="true">{icon}</span>}
        {title}
      </h3>
      <button type="button" onClick={onClose} className="text-muted hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
