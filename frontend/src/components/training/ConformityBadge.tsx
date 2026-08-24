'use client';

/**
 * ConformityBadge — Phase 5C tiny inline status badge for a plan day.
 *
 * Renders a coloured dot (+ score where known) per backend conformity status:
 *   done → green "● 88%" · partial → yellow · missed → muted red "Missed"
 *   extra → blue "Extra" · pending → gray "—" · rest → nothing (null)
 * Tooltip shows the classification ("Excellent"/"Good"/…) when present.
 */

interface ConformityBadgeProps {
  status: string;
  pct?: number | null;
  classification?: string | null;
  /** Optional tooltip override (weekly view passes its heuristic label). */
  title?: string;
}

export function ConformityBadge({
  status,
  pct,
  classification,
  title: titleOverride,
}: ConformityBadgeProps) {
  if (status === 'rest') return null;

  const resolvedTitle = titleOverride ?? classification ?? undefined;

  switch (status) {
    case 'done':
    case 'partial': {
      const color =
        status === 'done'
          ? 'text-positive'
          : 'text-warning';
      return (
        <span
          title={resolvedTitle ?? (status === 'done' ? 'Done' : 'Partial')}
          className={`inline-flex items-center gap-1 text-[10px] font-medium ${color}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {pct != null ? `${Math.round(pct)}%` : ''}
        </span>
      );
    }
    case 'missed':
      return (
        <span title={resolvedTitle ?? 'Missed'} className="text-[10px] font-medium text-red-400/60">
          Missed
        </span>
      );
    case 'extra':
      return (
        <span title={resolvedTitle ?? 'Extra session'} className="text-[10px] font-medium text-blue-300">
          Extra
        </span>
      );
    case 'pending':
      return (
        <span title={resolvedTitle ?? 'Pending'} className="text-[10px] text-muted">
          —
        </span>
      );
    default:
      return null;
  }
}

