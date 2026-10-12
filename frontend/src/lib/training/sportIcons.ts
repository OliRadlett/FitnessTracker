import { Dumbbell, Bike, Bed } from 'lucide-react';

export { Dumbbell as DumbbellIcon, Bike as BikeIcon, Bed as BedIcon };

/**
 * V2.1: Replaces the SPORT_EMOJI constants that were scattered across
 * WeeklyView, PlanBuilder, and training/page. Single source of truth
 * for sport-to-icon mapping.
 */
export const SPORT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cycle: Bike,
  strength: Dumbbell,
  rest: Bed,
};

export const sportIconFor = (sport: string) => SPORT_ICON[sport] ?? null;
