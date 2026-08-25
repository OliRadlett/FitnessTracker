'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/training', label: 'Training', icon: '📋' },
  { href: '/activities', label: 'Activities', icon: '🏃' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
  { href: '/cycling', label: 'Cycling', icon: '🚴' },
  { href: '/lifting', label: 'Lifting', icon: '🏋️' },
  { href: '/lifting/live', label: 'Live Lift', icon: '⚡' },
  { href: '/goals', label: 'Goals', icon: '🎯' },
  { href: '/routes', label: 'Routes', icon: '🗺️' },
  { href: '/wiki', label: 'Wiki', icon: '📖' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

// ── Sidebar Context ──────────────────────────────────────────────────────────

interface SidebarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isCollapsed: boolean;
  toggleCollapse: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  isCollapsed: false,
  toggleCollapse: () => {},
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
    <SidebarContext.Provider value={{ isOpen, open, close, toggle, isCollapsed, toggleCollapse }}>
      {children}
    </SidebarContext.Provider>
  );
}

// ── Hamburger Button ─────────────────────────────────────────────────────────

export function MobileMenuButton() {
  const { toggle, isOpen } = useSidebar();

  return (
    <button
      onClick={toggle}
      aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
      aria-expanded={isOpen}
      aria-controls="sidebar-navigation"
      className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-surface border border-surface-light/50 text-white hover:bg-surface-light transition-colors"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {isOpen ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        )}
      </svg>
    </button>
  );
}

// ── Sidebar Component ────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isOpen, close, isCollapsed, toggleCollapse } = useSidebar();

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

      {/* Sidebar */}
      <aside
        id="sidebar-navigation"
        role="navigation"
        aria-label="Main navigation"
        className={`
          fixed inset-y-0 left-0 z-40 bg-surface border-r border-surface-light/50 flex flex-col min-h-screen
          transform transition-[width,transform] duration-200 ease-in-out
          md:static md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          ${isCollapsed ? 'md:w-16' : 'md:w-64 w-64'}
        `}
      >
        <div className={`border-b border-surface-light/50 ${isCollapsed ? 'md:px-2 md:py-4 md:flex md:justify-center p-6' : 'p-6'}`}>
          <h1 className={`text-xl font-bold text-white flex items-center gap-2 ${isCollapsed ? 'md:hidden' : ''}`}>
            <span className="text-2xl" aria-hidden="true">💪</span>
            Fitness Tracker
          </h1>
          {isCollapsed && (
            <span className="hidden md:inline text-2xl" aria-hidden="true">💪</span>
          )}
        </div>

        <nav className={`flex-1 p-4 space-y-1 ${isCollapsed ? 'md:px-2' : ''}`}>
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                title={isCollapsed ? item.label : undefined}
                className={`flex items-center rounded-lg text-sm font-medium transition-colors ${
                  isCollapsed ? 'md:justify-center md:px-0 md:py-3 gap-3 px-4 py-3' : 'gap-3 px-4 py-3'
                } ${
                  isActive
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-muted hover:text-white hover:bg-surface-light/50'
                }`}
              >
                <span className="text-lg" aria-hidden="true">{item.icon}</span>
                <span className={isCollapsed ? 'md:hidden' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex items-center justify-center mx-2 mb-2 p-2 rounded-lg text-muted hover:text-white hover:bg-surface-light/50 transition-colors"
        >
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
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
              onClick={() => signOut()}
              aria-label="Sign out of your account"
              className={`w-full text-left text-sm text-muted hover:text-warning rounded-lg hover:bg-surface-light/50 transition-colors ${
                isCollapsed ? 'md:flex md:justify-center md:py-2 px-3 py-2' : 'px-3 py-2'
              }`}
            >
              <span className={isCollapsed ? 'md:hidden' : ''}>Sign out</span>
              {isCollapsed && (
                <svg className="hidden md:inline w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              )}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
