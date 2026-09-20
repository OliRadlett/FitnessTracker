'use client';

import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-white',
  secondary: 'bg-surface-light text-white hover:bg-surface-light/80',
  tinted: 'bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30',
  ghost: 'text-muted hover:text-white hover:bg-surface-light/50',
  danger: 'bg-warning text-white hover:bg-warning/80',
  success: 'bg-positive text-white hover:bg-positive/80',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 py-1.5 text-sm',
  md: 'min-h-[44px] px-4 py-2 text-sm',
  lg: 'min-h-[52px] px-5 py-2.5 text-base',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button while an action is in flight. */
  loading?: boolean;
}

/**
 * Single button primitive — one variant/size/focus/disabled language.
 * Keyboard focus is handled globally (`:focus-visible` in globals.css).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span
          className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required because the button has no visible text. */
  label: string;
}

/**
 * 44×44 icon-only button. The icon itself must be `aria-hidden`
 * (use `AppIcon` from `./AppIcon`).
 */
export function IconButton({ label, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex items-center justify-center w-11 h-11 rounded-lg text-muted hover:text-white hover:bg-surface-light/50 transition-colors disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
