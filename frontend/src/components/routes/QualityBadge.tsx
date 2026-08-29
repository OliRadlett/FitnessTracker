export interface QualityBadgeProps {
  score: number | null | undefined;
  size?: 'sm' | 'default';
  showLabel?: boolean;
}

const QUALITY_TIERS: Array<{
  min: number;
  label: string;
  color: string;
  ringColor: string;
}> = [
  { min: 85, label: 'Excellent', color: 'text-green-400', ringColor: 'ring-green-500/30' },
  { min: 70, label: 'Good', color: 'text-blue-400', ringColor: 'ring-blue-500/30' },
  { min: 55, label: 'Average', color: 'text-yellow-400', ringColor: 'ring-yellow-500/30' },
  { min: 40, label: 'Fair', color: 'text-orange-400', ringColor: 'ring-orange-500/30' },
  { min: 0, label: 'Poor', color: 'text-red-400', ringColor: 'ring-red-500/30' },
];

const TIER_COLORS: Record<string, string> = {
  Excellent: 'bg-green-500',
  Good: 'bg-blue-500',
  Average: 'bg-yellow-500',
  Fair: 'bg-orange-500',
  Poor: 'bg-red-500',
};

export function QualityBadge({ score, size = 'default', showLabel = false }: QualityBadgeProps) {
  if (score == null) {
    return (
      <span className={`inline-flex items-center rounded-full bg-surface-light text-xs text-muted ${
        size === 'sm' ? 'px-1.5 py-0.5' : 'px-2.5 py-1'
      }`}>
        —
      </span>
    );
  }

  const tier = QUALITY_TIERS.find((t) => score >= t.min) || QUALITY_TIERS[QUALITY_TIERS.length - 1];
  const sizeClasses = size === 'sm'
    ? 'w-4 h-4 text-[8px]'
    : 'w-7 h-7 text-[10px]';

  return (
    <div className={`relative inline-flex items-center justify-center rounded-full ring-1 ${tier.ringColor} ${tier.color} ${
      showLabel ? 'pl-4 pr-1.5 py-0.5 text-xs' : sizeClasses
    }`}>
      <svg className="-rotate-90 w-full h-full" viewBox="0 0 36 36">
        <path
          d="M18 2.5a15.5 15.5 0 0 1 0 31 15.5 15.5 0 0 1 0-31"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          opacity="0.2"
        />
        <path
          d="M18 2.5a15.5 15.5 0 0 1 0 31 15.5 15.5 0 0 1 0-31"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${score} 100`}
          strokeDashoffset="25"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-medium">
        {showLabel ? `${Math.round(score)} ${showLabel ? tier.label : ''}` : Math.round(score)}
      </span>
    </div>
  );
}

export function QualityIndicator({ score, labels = false }: { score: number | null | undefined; labels?: boolean }) {
  if (score == null) return null;
  const tier = QUALITY_TIERS.find((t) => score >= t.min) || QUALITY_TIERS[QUALITY_TIERS.length - 1];
  return (
    <div className="flex items-center gap-1">
      <div className={`w-2 h-2 rounded-full ${TIER_COLORS[tier.label]}`} />
      {labels && <span className={`text-xs ${tier.color}`}>{tier.label}</span>}
    </div>
  );
}
