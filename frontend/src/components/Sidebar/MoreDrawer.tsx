'use client';

import React, { useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Route,
  TrendingUp,
  Video,
  Play,
  Calendar,
  ChartColumn,
  Bell,
  BookOpen,
  Settings,
} from 'lucide-react';

interface MoreDrawerItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const MORE_ITEMS: MoreDrawerItem[] = [
  { label: 'Routes', href: '/routes', icon: Route },
  { label: 'Segments', href: '/segments', icon: TrendingUp },
  { label: 'Videos', href: '/lifting/videos', icon: Video },
  { label: '3D Replay', href: '/replay', icon: Play },
  { label: 'Calendar', href: '/calendar', icon: Calendar },
  { label: 'Analytics', href: '/analytics', icon: ChartColumn },
  { label: 'Notifications', href: '/notifications', icon: Bell },
  { label: 'Wiki', href: '/wiki', icon: BookOpen },
  { label: 'Settings', href: '/settings', icon: Settings },
];

interface MoreDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

export function MoreDrawer({ isOpen, onClose, anchorRect }: MoreDrawerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        if (!popoverRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          firstItemRef.current?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeydown);

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use mousedown for better click-outside detection before focus shifts
    document.addEventListener('mousedown', handleClickOutside);

    firstItemRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !anchorRect) return null;

  // Position the popover below and to the right of the anchor
  const popoverStyle: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 8,
    left: anchorRect.left,
    zIndex: 1000,
  };

  return (
    <div
      ref={popoverRef}
      className="min-w-[200px] bg-surface border border-surface/20 rounded-xl shadow-xl"
      style={popoverStyle}
      role="menu"
      aria-orientation="vertical"
      aria-label="More navigation"
    >
      <div className="py-1">
        {MORE_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              ref={item.label === MORE_ITEMS[0].label ? firstItemRef : undefined}
              href={item.href}
              role="menuitem"
              aria-current={isActive ? 'page' : undefined}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg mx-1 my-0.5 transition-colors ${
                isActive
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'text-muted hover:text-foreground hover:bg-surface-light/20'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
