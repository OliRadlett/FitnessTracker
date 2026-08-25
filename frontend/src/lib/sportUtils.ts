/**
 * Sport type classification, color, and emoji utilities.
 * Single source of truth — replaces scattered helpers in calendar, activities, Badge.
 */

const STRENGTH_KEYWORDS = ['strength', 'weight', 'workout', 'lift'];
const CYCLING_KEYWORDS = ['cycl', 'bike'];
const RUNNING_KEYWORDS = ['run'];
const SWIMMING_KEYWORDS = ['swim'];
const WALKING_KEYWORDS = ['walk', 'hik'];

export const STRENGTH_TYPES = ['weighttraining', 'workout', 'crossfit', 'strength_training'];

function matches(sportType: string, keywords: string[]): boolean {
  const n = sportType.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

export function isStrengthType(sportType: string): boolean {
  return matches(sportType, STRENGTH_KEYWORDS) || STRENGTH_TYPES.includes(sportType.toLowerCase());
}

export function isCyclingOrRunning(sportType: string): boolean {
  return matches(sportType, CYCLING_KEYWORDS) || matches(sportType, RUNNING_KEYWORDS);
}

export function getSportColor(sportType: string): string {
  if (matches(sportType, CYCLING_KEYWORDS)) return 'bg-blue-500';
  if (matches(sportType, RUNNING_KEYWORDS)) return 'bg-green-500';
  if (matches(sportType, STRENGTH_KEYWORDS)) return 'bg-purple-500';
  if (matches(sportType, SWIMMING_KEYWORDS)) return 'bg-cyan-500';
  if (matches(sportType, WALKING_KEYWORDS)) return 'bg-amber-500';
  return 'bg-gray-500';
}

export function getSportTextColor(sportType: string): string {
  if (matches(sportType, CYCLING_KEYWORDS)) return 'text-blue-400';
  if (matches(sportType, RUNNING_KEYWORDS)) return 'text-green-400';
  if (matches(sportType, STRENGTH_KEYWORDS)) return 'text-purple-400';
  if (matches(sportType, SWIMMING_KEYWORDS)) return 'text-cyan-400';
  if (matches(sportType, WALKING_KEYWORDS)) return 'text-amber-400';
  return 'text-gray-400';
}

export function getSportBorderColor(sportType: string): string {
  if (matches(sportType, CYCLING_KEYWORDS)) return 'border-blue-500/30';
  if (matches(sportType, RUNNING_KEYWORDS)) return 'border-green-500/30';
  if (matches(sportType, STRENGTH_KEYWORDS)) return 'border-purple-500/30';
  if (matches(sportType, SWIMMING_KEYWORDS)) return 'border-cyan-500/30';
  if (matches(sportType, WALKING_KEYWORDS)) return 'border-amber-500/30';
  return 'border-gray-500/30';
}

export function getSportEmoji(sportType: string): string {
  if (matches(sportType, CYCLING_KEYWORDS)) return '🚴';
  if (matches(sportType, RUNNING_KEYWORDS)) return '🏃';
  if (matches(sportType, STRENGTH_KEYWORDS)) return '🏋️';
  if (matches(sportType, SWIMMING_KEYWORDS)) return '🏊';
  if (matches(sportType, WALKING_KEYWORDS)) return '🥾';
  return '⚡';
}

export function getRecoveryColor(score: number): string {
  if (score >= 70) return 'text-green-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-red-400';
}
