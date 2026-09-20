'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  Activity,
  Bell,
  Bike,
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ClipboardList,
  Dumbbell,
  HeartPulse,
  House,
  LayoutDashboard,
  LogOut,
  Menu,
  Route,
  Search,
  Settings,
  Target,
  Video,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components/ui/AppIcon';
import { useAuthFetch } from '@/lib/api';
import { logoutBackend } from '@/lib/api/account';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: 'Overview' | 'Train' | 'Resources';
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, section: 'Overview' },
  { href: '/notifications', label: 'Notifications', icon: Bell, section: 'Overview' },
  { href: '/training', label: 'Training', icon: ClipboardList, section: 'Train' },
  { href: '/goals', label: 'Goals', icon: Target, section: 'Train' },
  { href: '/activities', label: 'Activities', icon: Activity, section: 'Train' },
  { href: '/lifting', label: 'Lifting', icon: Dumbbell, section: 'Train' },
  { href: '/lifting/live', label: 'Live Lift', icon: Zap, section: 'Train' },
  { href: '/lifting/videos', label: 'Videos', icon: Video, section: 'Train' },
  { href: '/cycling', label: 'Cycling', icon: Bike, section: 'Train' },
  { href: '/health', label: 'Health', icon: HeartPulse, section: 'Train' },
  { href: '/routes', label: 'Routes', icon: Route, section: 'Train' },
  { href: '/wiki', label: 'Wiki', icon: BookOpen, section: 'Resources' },
  { href: '/settings', label: 'Settings', icon: Settings, section: 'Resources' },
];

// ── Sidebar Context ──────────────────────────────────────────────────────────

interface SidebarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement>;
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  isCollapsed: false,
  toggleCollapse: () => {},
  menuButtonRef: { current: null },
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Initialize collapsed state from localStorage (client-only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('fittrack-sidebar-collapsed');
      if (stored === 'true') {
        setIsCollapsed(true);
      }
    } catch {
      // localStorage unavailable (SSR or private browsing)
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fittrack-sidebar-collapsed', String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  // Close sidebar on route change (mobile)
  const pathname = usePathname();
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close sidebar on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <SidebarContext.Provider value={{ isOpen, open, close, toggle, isCollapsed, toggleCollapse, menuButtonRef }}>
      {children}
    </SidebarContext.Provider>
  );
}

// ── Hamburger Button ─────────────────────────────────────────────────────────

export function MobileMenuButton() {
  const { toggle, isOpen, menuButtonRef } = useSidebar();

  return (
    <button
      ref={menuButtonRef}
      onClick={toggle}
      aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
      aria-expanded={isOpen}
      aria-controls="sidebar-navigation"
      className="md:hidden fixed top-4 left-4 z-50 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-surface border border-surface-light/50 text-white hover:bg-surface-light transition-colors"
    >
      {isOpen ? <AppIcon icon={X} size={24} /> : <AppIcon icon={Menu} size={24} />}
    </button>
  );
}

// ── Mobile Bottom Navigation ───────────────────────────────────────────────
// Thumb-friendly primary destinations for phones (OnePlus 11 ~412px).
// The full 14-item list stays in the hamburger drawer; this bar covers the
// 4 most-used pages + a More button that opens the drawer.

const bottomNavItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Home', icon: House },
  { href: '/activities', label: 'Activity', icon: Activity },
  { href: '/training', label: 'Training', icon: ClipboardList },
  { href: '/lifting/live', label: 'Live Lift', icon: Zap },
  { href: '/routes', label: 'Routes', icon: Route },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { open } = useSidebar();

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-surface-light/50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-6 gap-0.5 px-1 pt-1">
        {bottomNavItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-[60px] rounded-lg text-[11px] font-medium transition-colors ${
                isActive
                  ? 'text-accent bg-accent/15'
                  : 'text-muted hover:text-white active:bg-surface-light/50'
              }`}
            >
              <AppIcon icon={item.icon} size={20} />
              <span className="leading-tight truncate max-w-full px-0.5">
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          onClick={open}
          aria-label="Open full navigation menu"
          className="flex flex-col items-center justify-center gap-0.5 min-h-[60px] rounded-lg text-[11px] font-medium text-muted hover:text-white active:bg-surface-light/50 transition-colors"
        >
          <span className="text-xl leading-none" aria-hidden="true">☰</span>
          <span className="leading-tight">More</span>
        </button>
      </div>
    </nav>
  );
}

// ── Sidebar Component ────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { authFetch } = useAuthFetch();
  const { isOpen, close, isCollapsed, toggleCollapse, menuButtonRef } = useSidebar();
  const asideRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);
  const wasOpen = useRef(false);

  // Move focus into the drawer on open (mobile dialog behaviour) and return
  // focus to the hamburger on close so keyboard users don't lose their place.
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      wasOpen.current = true;
      asideRef.current
        ?.querySelector<HTMLElement>('a[href], button:not([disabled])')
        ?.focus();
    } else if (!isOpen && wasOpen.current) {
      wasOpen.current = false;
      menuButtonRef.current?.focus();
    }
  }, [isOpen, menuButtonRef]);

  // Keep Tab inside the open drawer.
  useEffect(() => {
    if (!isOpen) return;
    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !asideRef.current) return;
      const items = Array.from(
        asideRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  return (
    <>
      {/* Backdrop overlay — visible only on mobile when sidebar is open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — a modal dialog on mobile, static nav on desktop */}
      <aside
        ref={asideRef}
        id="sidebar-navigation"
        role={isOpen ? 'dialog' : 'navigation'}
        aria-label="Main navigation"
        aria-modal={isOpen ? true : undefined}
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null) return;
          const dx = touchStartX.current - e.changedTouches[0].clientX;
          touchStartX.current = null;
          // Swipe left to dismiss the drawer
          if (dx > 60) close();
        }}
        className={`
          fixed inset-y-0 left-0 z-40 bg-surface border-r border-surface-light/50 flex flex-col min-h-screen
          transform transition-[width,transform] duration-200 ease-in-out
          md:static md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          ${isCollapsed ? 'md:w-16' : 'md:w-64'} w-[85vw] max-w-[320px] md:max-w-none
        `}
      >
        <div className={`border-b border-surface-light/50 ${isCollapsed ? 'md:px-2 md:py-4 md:flex md:justify-center p-6' : 'p-6'}`}>
          <h1 className={`text-xl font-bold text-white flex items-center gap-2.5 ${isCollapsed ? 'md:hidden' : ''}`}>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent" aria-hidden="true">
              <Zap size={18} strokeWidth={2.5} className="text-white" aria-hidden="true" />
            </span>
            FitTrack
          </h1>
          {isCollapsed && (
            <span className="hidden md:inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent" aria-hidden="true">
              <Zap size={18} strokeWidth={2.5} className="text-white" aria-hidden="true" />
            </span>
          )}
        </div>

        <nav className={`flex-1 p-4 space-y-1 ${isCollapsed ? 'md:px-2' : ''}`}>
          <button
            onClick={() => window.dispatchEvent(new Event('fittrack:command-palette'))}
            title={isCollapsed ? 'Search (Ctrl+P)' : undefined}
            className={`flex items-center rounded-lg text-sm font-medium transition-colors w-full text-left ${
              isCollapsed ? 'md:justify-center md:px-0 md:py-3 gap-3 px-4 py-3' : 'gap-3 px-4 py-3'
            } text-muted hover:text-white hover:bg-surface-light/50 border border-surface-light/30 mb-1`}
          >
            <AppIcon icon={Search} size={18} className="shrink-0" />
            <span className={`flex-1 ${isCollapsed ? 'md:hidden' : ''}`}>Search</span>
            <kbd className={`hidden sm:inline-flex px-1.5 py-0.5 rounded bg-surface-light/60 text-[11px] text-muted ${isCollapsed ? 'md:hidden' : ''}`}>
              Ctrl+P
            </kbd>
          </button>
          {(() => {
            // Longest-prefix match so sub-pages (e.g. /routes/duplicates)
            // highlight their parent item, and child items win over parents
            // (e.g. /lifting/live over /lifting) on their own pages.
            const activeHref = navItems
              .filter((i) => pathname === i.href || pathname.startsWith(i.href + '/'))
              .reduce<string | undefined>(
                (best, i) => (!best || i.href.length > best.length ? i.href : best),
                undefined,
              );
            let lastSection: NavItem['section'] | null = null;
            return navItems.map((item) => {
              const isActive = activeHref === item.href;
              const showSection = item.section !== lastSection;
              lastSection = item.section;
              return (
                <React.Fragment key={item.href}>
                  {showSection && !isCollapsed && (
                    <p className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted/70 uppercase tracking-wider" aria-hidden="true">
                      {item.section}
                    </p>
                  )}
                  {showSection && isCollapsed && (
                    <span className="hidden md:block mx-4 my-2 border-t border-surface-light/50" aria-hidden="true" />
                  )}
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    title={isCollapsed ? item.label : undefined}
                    className={`relative flex items-center rounded-lg text-sm font-medium transition-colors ${
                      isCollapsed ? 'md:justify-center md:px-0 md:py-3 gap-3 px-4 py-3' : 'gap-3 px-4 py-3'
                    } ${
                      isActive
                        ? 'bg-accent/20 text-accent border border-accent/30'
                        : 'text-muted hover:text-white hover:bg-surface-light/50'
                    }`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-accent"
                      />
                    )}
                    <AppIcon icon={item.icon} size={18} className="shrink-0" />
                    <span className={isCollapsed ? 'md:hidden' : ''}>{item.label}</span>
                  </Link>
                </React.Fragment>
              );
            });
          })()}
        </nav>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex items-center justify-center mx-2 mb-2 p-2 rounded-lg text-muted hover:text-white hover:bg-surface-light/50 transition-colors"
        >
          <span className={`inline-flex transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}>
            <AppIcon icon={ChevronsLeft} size={20} />
          </span>
        </button>

        {session?.user && (
          <div className={`border-t border-surface-light/50 ${isCollapsed ? 'md:px-2 md:py-3 p-4' : 'p-4'}`}>
            <div className={`flex items-center gap-3 mb-3 ${isCollapsed ? 'md:justify-center md:mb-0' : ''}`}>
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt={session.user.name ? `${session.user.name}'s avatar` : 'User avatar'}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <div className={`flex-1 min-w-0 ${isCollapsed ? 'md:hidden' : ''}`}>
                <p className="text-sm font-medium text-white truncate">{session.user.name}</p>
                <p className="text-xs text-muted truncate">{session.user.email}</p>
              </div>
            </div>
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
              className={`w-full text-left text-sm text-muted hover:text-warning rounded-lg hover:bg-surface-light/50 transition-colors ${
                isCollapsed ? 'md:flex md:justify-center md:py-2 px-3 py-2' : 'px-3 py-2'
              }`}
            >
              <span className={isCollapsed ? 'md:hidden' : ''}>Sign out</span>
              {isCollapsed && (
                <span className="hidden md:inline-flex">
                  <AppIcon icon={LogOut} size={20} />
                </span>
              )}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
