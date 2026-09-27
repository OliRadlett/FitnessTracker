'use client';

import { useQueryClient } from '@tanstack/react-query';

/**
 * Inline warning shown when a page's core queries fail, with a Retry action
 * that invalidates and refetches. Renders nothing when `show` is false.
 */
export function QueryErrorBanner({ show, message }: { show: boolean; message: string }) {
  const queryClient = useQueryClient();
  if (!show) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
      <span>{message}</span>
      <button
        type="button"
        onClick={() => queryClient.invalidateQueries()}
        className="shrink-0 font-medium underline hover:no-underline"
      >
        Retry
      </button>
    </div>
  );
}
