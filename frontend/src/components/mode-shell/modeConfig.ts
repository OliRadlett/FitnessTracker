import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  LayoutDashboard,
  Settings,
  Sunrise,
} from 'lucide-react';
import type { TrainingWeekDay } from '@/lib/api';

/**
 * Phase 2 (plans/ui-redesign-v2.md §2) — four-mode shell config.
 *
 * Modes are SHELLS, not pages: every route keeps its identity, URL, and
 * deep-link params (`?activity=` `?session=` `?tab=` `?route=` `?replay=`)
 * untouched, so bookmarks never break. This map only decides which mode
 * rail item + secondary nav is shown for a given pathname.
 *
 * Membership (Walkthrough §2 + task scope):
 *   TODAY  /today + the Train action (/lifting/live)
 *   REVIEW /dashboard (overview home) + /cycling /health /activities
 *          /lifting (history) /lifting/videos /segments /analytics
 *   PLAN   /training /goals /calendar
 *   SYSTEM /routes (+/duplicates tab) /notifications /wiki /settings
 */

export type ModeId = 'today' | 'review' | 'plan' | 'system';

export interface ModeNavLink {
  href: string;
  label: string;
}

export interface ModeConfig {
  id: ModeId;
  label: string;
  icon: LucideIcon;
  /** Primary landing route for the mode (rail button + mobile bar target). */
  href: string;
  /** Route prefixes belonging to this mode (prefix match, see below). */
  routes: string[];
  /** Secondary nav for the mode — existing routes only, no new pages. */
  links: ModeNavLink[];
  /**
   * TODAY shows the whole-history unread count. The data lives in SYSTEM
   * (notifications center); the badge reads the existing
   * `['notifications', 'summary']` query, so no new endpoint is involved.
   */
  badge?: 'notifications-unread';
}

export const MODES: ModeConfig[] = [
  {
    id: 'today',
    label: 'Today',
    icon: Sunrise,
    href: '/today',
    routes: ['/today', '/lifting/live'],
    links: [
      { href: '/today', label: 'Today Brief' },
      { href: '/lifting/live', label: 'Live Lift' },
    ],
    badge: 'notifications-unread',
  },
  {
    id: 'review',
    label: 'Review',
    icon: LayoutDashboard,
    href: '/dashboard',
    routes: [
      '/dashboard',
      '/activities',
      '/cycling',
      '/health',
      '/lifting',
      '/lifting/videos',
      '/segments',
      '/analytics',
    ],
    links: [
      { href: '/dashboard', label: 'Overview' },
      { href: '/activities', label: 'Activities' },
      { href: '/cycling', label: 'Cycling' },
      { href: '/health', label: 'Health' },
      { href: '/lifting', label: 'Lifting' },
      { href: '/lifting/videos', label: 'Videos' },
      { href: '/segments', label: 'Climbs' },
      { href: '/analytics', label: 'Analytics' },
    ],
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: ClipboardList,
    href: '/training',
    routes: ['/training', '/goals', '/calendar'],
    links: [
      { href: '/training', label: 'Training' },
      { href: '/goals', label: 'Goals' },
      { href: '/calendar', label: 'Calendar' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    href: '/routes',
    routes: ['/routes', '/notifications', '/wiki', '/settings'],
    links: [
      { href: '/routes', label: 'Routes' },
      { href: '/notifications', label: 'Notifications' },
      { href: '/wiki', label: 'Wiki' },
      { href: '/settings', label: 'Settings' },
    ],
  },
];

/**
 * Map a pathname to its mode by longest-prefix match, so child routes win
 * over parents: `/lifting/live` → TODAY beats `/lifting` → REVIEW, and
 * `/routes/duplicates` → SYSTEM via the `/routes` prefix. Unknown paths
 * fall back to REVIEW (the overview home is the neutral default shell).
 */
export function matchModeForPath(pathname: string | null | undefined): ModeId {
  if (!pathname) return 'review';
  const path =
    pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  let best: ModeId = 'review';
  let bestLen = -1;
  for (const mode of MODES) {
    for (const route of mode.routes) {
      if (path === route || path.startsWith(route + '/')) {
        if (route.length > bestLen) {
          bestLen = route.length;
          best = mode.id;
        }
      }
    }
  }
  return best;
}

/**
 * Resolve the central Train action target from today's plan slice.
 *
 * Plan-precedence verdict philosophy (Walkthrough §2): adjust-or-affirm the
 * plan, never an invented workout. Every branch deep-links an EXISTING
 * route — rest days, completed days, and no-plan days land on `/today`,
 * whose verdict already says "rest" / "done" / "no plan" without
 * prescribing. No synthetic session is ever constructed here.
 */
export function resolveTrainTarget(
  today: Pick<TrainingWeekDay, 'sport' | 'completed'> | null | undefined,
): string {
  if (!today || today.completed) return '/today';
  if (today.sport === 'strength') return '/lifting/live';
  if (today.sport === 'rest') return '/today';
  return '/training';
}
