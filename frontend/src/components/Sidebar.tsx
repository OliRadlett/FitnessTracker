  'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/activities', label: 'Activities', icon: '🏃' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
  { href: '/cycling', label: 'Cycling', icon: '🚴' },
  { href: '/lifting', label: 'Lifting', icon: '🏋️' },
  { href: '/routes', label: 'Routes', icon: '🗺️' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="w-64 bg-surface border-r border-surface-light/50 flex flex-col min-h-screen">
      <div className="p-6 border-b border-surface-light/50">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-2xl">💪</span>
          Fitness Tracker
        </h1>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'text-muted hover:text-white hover:bg-surface-light/50'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {session?.user && (
        <div className="p-4 border-t border-surface-light/50">
          <div className="flex items-center gap-3 mb-3">
            {session.user.image && (
              <img
                src={session.user.image}
                alt={session.user.name || 'User'}
                className="w-8 h-8 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{session.user.name}</p>
              <p className="text-xs text-muted truncate">{session.user.email}</p>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full text-left px-3 py-2 text-sm text-muted hover:text-warning rounded-lg hover:bg-surface-light/50 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
