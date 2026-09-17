'use client';

export type DifficultyLevel = 'Easy' | 'Moderate' | 'Hard' | 'Extreme';

export const DIFFICULTY_STYLES: Record<DifficultyLevel, string> = {
  Easy: 'bg-green-500/20 text-positive border-green-500/30',
  Moderate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Hard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Extreme: 'bg-red-500/20 text-warning border-red-500/30',
};

export function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${DIFFICULTY_STYLES[level]}`}
    >
      {level}
    </span>
  );
}
