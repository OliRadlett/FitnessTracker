'use client';

import React from 'react';

interface Tab {
  key: string;
  label: string;
}

interface TabGroupProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function TabGroup({ tabs, active, onChange, className = '' }: TabGroupProps) {
  return (
    <div
      className={`flex gap-1 bg-surface rounded-xl p-1 border border-surface-light/50 w-fit ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
            active === tab.key
              ? 'bg-accent text-white'
              : 'text-muted hover:text-white hover:bg-surface-light/50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
