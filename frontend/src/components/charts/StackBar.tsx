'use client';

/**
 * StackBar — one 100 % bar, no axis. A zone split rendered this way cannot
 * collide with a label, because there are no labels inside it.
 */

export interface StackSegment {
  value: number;
  color: string;
  label: string;
}

export function StackBar({
  segments,
  height = 14,
  gap = 2,
  ariaLabel,
}: {
  segments: StackSegment[];
  height?: number;
  gap?: number;
  ariaLabel?: string;
}) {
  const total = segments.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div
      className="flex w-full overflow-hidden rounded-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel ?? segments.map((s) => s.label).join(', ')}
    >
      {segments.map((s) => (
        <div
          key={s.label}
          title={`${s.label} · ${Math.round(s.value)}`}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color, marginRight: gap }}
          className="first:rounded-l-full last:mr-0 last:rounded-r-full"
        />
      ))}
    </div>
  );
}
