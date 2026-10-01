/**
 * Small centred label/value badge used by the cycling and lifting analysis
 * cards. Extracted from three near-identical local copies (RideAnalysisCard,
 * LiftingAnalysisCard, FuelPlanCard) — BUG-044 family.
 */
export function StatBadge({
  label,
  value,
  className = '',
  hint,
}: {
  label: string;
  value: string | number | undefined;
  className?: string;
  hint?: string;
}) {
  if (value == null) return null;
  return (
    <div className="bg-surface-light/30 rounded-lg px-4 py-3 text-center" title={hint}>
      <p className="text-xs text-muted uppercase tracking-wide">
        {label}
        {hint && (
          <span className="text-muted text-[10px] cursor-help ml-1" aria-hidden>
            ⓘ
          </span>
        )}
      </p>
      <p className={`text-lg font-semibold text-foreground mt-1 ${className}`}>{value}</p>
    </div>
  );
}
