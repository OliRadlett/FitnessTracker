'use client';

/** Human-readable labels for the Jev strength-session classification. */
const LIFT_LABELS: Record<string, string> = {
  squat: 'squat',
  bench: 'bench',
  deadlift: 'deadlift',
  overhead_press: 'overhead press',
  accessory: 'accessory',
  none: 'no focus',
};

export const SPLIT_LABELS: Record<string, string> = {
  push: 'push',
  pull: 'pull',
  legs: 'legs',
  upper: 'upper',
  lower: 'lower',
  full_body: 'full body',
};

export const CLASS_LABELS: Record<string, string> = {
  max_strength: 'max strength',
  volume_hypertrophy: 'volume',
  speed_power: 'speed / power',
  technique: 'technique',
  accessory_conditioning: 'accessory / conditioning',
  deload: 'deload',
  test: 'test',
};

export interface SessionLabelsProps {
  split?: string | null;
  lift?: string | null;
  sessionClass?: string | null;
}

/**
 * Jev session classification chips (primary lift · split · training intent).
 *
 * Read-only derived labels — not user data, not editable. Renders nothing when
 * no axis is set (a session Jev has not reached, or Jev unconfigured), so no
 * empty chip row appears.
 */
export function SessionLabels({ split, lift, sessionClass }: SessionLabelsProps) {
  const items: Array<{ key: string; label: string; title: string; tone: string }> = [];

  if (lift && lift !== 'none') {
    items.push({
      key: 'lift',
      label: LIFT_LABELS[lift] ?? lift,
      title: 'Jev-classified primary lift',
      tone: 'bg-accent/15 text-accent',
    });
  }
  if (split) {
    items.push({
      key: 'split',
      label: SPLIT_LABELS[split] ?? split,
      title: 'Jev-classified training split',
      tone: 'bg-surface-light text-muted',
    });
  }
  if (sessionClass) {
    items.push({
      key: 'class',
      label: CLASS_LABELS[sessionClass] ?? sessionClass,
      title: 'Jev-classified training intent',
      tone: 'bg-surface-light text-muted',
    });
  }

  if (items.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 mt-2"
      role="group"
      aria-label="Session classification"
    >
      {items.map((item) => (
        <span
          key={item.key}
          className={`text-xs px-2 py-0.5 rounded-full ${item.tone}`}
          title={item.title}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
