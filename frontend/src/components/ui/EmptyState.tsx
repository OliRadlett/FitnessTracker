'use client';

import React from 'react';
import Link from 'next/link';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

/**
 * Consistent empty state component for when pages have no data.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="bg-surface rounded-xl border border-surface-light/50 p-12 text-center" role="status" aria-live="polite">
      <p className="text-4xl mb-3" aria-hidden="true">{icon}</p>
      <p className="text-white font-medium mb-1">{title}</p>
      <p className="text-muted text-sm max-w-md mx-auto">{description}</p>
      {action && (
        <div className="mt-4">
          {action.href ? (
            <Link
              href={action.href}
              className="inline-flex items-center px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              {action.label}
            </Link>
          ) : action.onClick ? (
            <button
              onClick={action.onClick}
              className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              {action.label}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
