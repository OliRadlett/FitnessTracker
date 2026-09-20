'use client';

import React from 'react';

interface FieldProps {
  label: React.ReactNode;
  /** Input id — assigned to the child control automatically. */
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactElement;
}

/**
 * Labelled form field: associates `<label htmlFor>` with the control,
 * wires `aria-describedby` for hint/error, and marks `aria-invalid`.
 */
export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = React.cloneElement(children, {
    id: htmlFor,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  } as Record<string, unknown>);
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs text-muted mb-1">
        {label}
        {required ? (
          <span className="text-warning ml-0.5" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted mt-1">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-warning mt-1">
          {error}
        </p>
      ) : null}
    </div>
  );
}
