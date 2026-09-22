import {
  Activity,
  BarChart3,
  Bike,
  CalendarDays,
  Dumbbell,
  Footprints,
  HeartPulse,
  Map as MapIcon,
  Moon,
  Target,
  Video,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// One icon per domain (1.1) — card headers use these instead of ad-hoc emoji.
export const DOMAIN_ICONS: Record<string, LucideIcon> = {
  training: CalendarDays,
  cycling: Bike,
  running: Footprints,
  swimming: Waves,
  strength: Dumbbell,
  lifting: Dumbbell,
  sleep: Moon,
  recovery: HeartPulse,
  health: Activity,
  routes: MapIcon,
  goals: Target,
  analytics: BarChart3,
  videos: Video,
  readiness: Zap,
};
