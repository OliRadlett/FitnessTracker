'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { AppIcon } from '@/components/ui/AppIcon';
import { useAuthFetch } from '@/lib/api';
import { logoutBackend } from '@/lib/api/account';
import { MODES, matchModeForPath } from './modeConfig';
import { useTodayBadge } from './useTodayBadge';

/**
 * Phase 2 (plans/ui-redesign-v2.md §2.2) — desktop 4-mode rail + contextual
 * secondary nav per mode. Replaces the 17-item flat sidebar on desktop
 * (`hidden md:flex`; the flat `Sidebar` stays as the mobile drawer).
 *
 * Shell-only: every link is an existing route, so URLs and deep-links
 * (`?activity=` `?session=` `?tab=` `?route=` `?replay=`) keep working
 * untouched. Targets are ≥44px, dark tokens only, 12px type floor.
 */
export function ModeRail() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { authFetch } = useAuthFetch();
  const unread = useTodayBadge();

  const activeMode = matchModeForPath(pathname);
  const active = MODES.find((m) => m.id === activeMode) ?? MODES[1];

  return (
    <div className="hidden md:flex shrink-0">
      {/* Mode rail — one button per mode */}
      <nav
        aria-label="Modes"
        className="sticky top-0 h-screen w-[76px] shrink-0 flex flex-col items-center gap-1 overflow-y-auto border-r border-surface-light/50 bg-surface px-2 py-4"
      >
        <span
          className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-accent"
          aria-hidden="true"
        >
          <AppIcon icon={active.icon} size={20} className="text-foreground" />
        </span>
        {MODES.map((mode) => {
          const isActive = mode.id === active.id;
          const badgeCount = mode.badge === 'notifications-unread' ? unread : 0;
          return (
            <Link
              key={mode.id}
              href={mode.href}
              aria-current={isActive ? 'page' : undefined}
              aria-label={
                badgeCount > 0
                  ? `${mode.label} (${badgeCount} unread notifications)`
                  : `${mode.label} mode`
              }
              className={`relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted hover:bg-surface-light/50 hover:text-foreground'
              }`}
            >
              <AppIcon icon={mode.icon} size={20} />
              <span className="leading-tight">{mode.label}</span>
              {badgeCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Secondary nav — sections of the active mode */}
      <nav
        aria-label={`${active.label} sections`}
        className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-surface-light/50 bg-surface px-3 py-4"
      >
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {active.label}
        </p>
        <div className="flex-1 space-y-1">
          {active.links.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(link.href + '/');
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex min-h-[44px] items-center rounded-lg px-4 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border border-accent/30 bg-accent/20 text-accent'
                    : 'text-muted hover:bg-surface-light/50 hover:text-foreground'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent"
                  />
                )}
                {link.label}
              </Link>
            );
          })}
        </div>

        <button
          onClick={() => window.dispatchEvent(new Event('fittrack:command-palette'))}
          className="mb-1 flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-surface-light/30 px-4 text-left text-sm font-medium text-muted transition-colors hover:bg-surface-light/50 hover:text-foreground"
        >
          <span aria-hidden="true">⌘P</span>
          <span className="flex-1">Search</span>
        </button>

        {session?.user && (
          <div className="border-t border-surface-light/50 px-1 pt-3">
            <p className="truncate px-3 text-sm font-medium text-foreground">
              {session.user.name}
            </p>
            <p className="truncate px-3 text-xs text-muted">{session.user.email}</p>
            <button
              onClick={async () => {
                // SEC-07: revoke the backend JWT first; sign out regardless.
                try {
                  await logoutBackend(authFetch);
                } catch {
                  // Best-effort — a failed revocation must not trap the user.
                }
                await signOut();
              }}
              aria-label="Sign out of your account"
              className="mt-1 min-h-[44px] w-full rounded-lg px-3 text-left text-sm text-muted transition-colors hover:bg-surface-light/50 hover:text-warning"
            >
              Sign out
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}
