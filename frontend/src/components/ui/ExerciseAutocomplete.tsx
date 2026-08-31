'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ExerciseSuggestion } from '@/lib/api';

interface ExerciseAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** Debounce hook */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const CATEGORY_LABELS: Record<string, string> = {
  big3: 'Big 3',
  compound: 'Compound',
  accessory: 'Accessory',
};

const CATEGORY_COLOURS: Record<string, string> = {
  big3: 'text-blue-400',
  compound: 'text-green-400',
  accessory: 'text-muted',
};

export function ExerciseAutocomplete({
  value,
  onChange,
  placeholder = 'e.g. Bench Press',
  required = false,
  autoFocus = false,
  className = '',
}: ExerciseAutocompleteProps) {
  const { authFetch, token } = useAuthFetch();
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(inputValue, 200);

  const { data: suggestions } = useQuery<ExerciseSuggestion[]>({
    queryKey: ['exercise-suggestions', debouncedQuery],
    queryFn: () => authFetch<ExerciseSuggestion[]>(`/api/v1/lifting/exercises?q=${encodeURIComponent(debouncedQuery)}&limit=15`),
    enabled: !!token && !!debouncedQuery,
  });

  // Sync external value changes
  useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Group suggestions by category, preserving Big 3 → Compound → Accessory order
  const groupedSuggestions = useMemo(() => {
    if (!suggestions) return [];
    const groups: { category: string; items: ExerciseSuggestion[] }[] = [];
    const seen = new Set<string>();

    for (const cat of ['big3', 'compound', 'accessory']) {
      const items = suggestions.filter((s) => s.category === cat && !seen.has(s.name));
      if (items.length > 0) {
        groups.push({ category: cat, items });
        items.forEach((s) => seen.add(s.name));
      }
    }
    // Any uncategorised
    const remaining = suggestions.filter((s) => !seen.has(s.name));
    if (remaining.length > 0) {
      groups.push({ category: 'other', items: remaining });
    }
    return groups;
  }, [suggestions]);

  const flatItems = useMemo(
    () => groupedSuggestions.flatMap((g) => g.items),
    [groupedSuggestions],
  );

  function handleSelect(name: string) {
    setInputValue(name);
    onChange(name);
    setIsOpen(false);
    setHighlightIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || flatItems.length === 0) {
      if (e.key === 'ArrowDown' && suggestions && suggestions.length > 0) {
        setIsOpen(true);
        setHighlightIndex(0);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        if (highlightIndex >= 0 && highlightIndex < flatItems.length) {
          e.preventDefault();
          handleSelect(flatItems[highlightIndex].name);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className={className || 'w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent'}
        autoComplete="off"
      />
      {isOpen && suggestions && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-surface-light rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {groupedSuggestions.map((group) => {
            let flatOffset = 0;
            for (const g of groupedSuggestions) {
              if (g.category === group.category) break;
              flatOffset += g.items.length;
            }

            return (
              <div key={group.category}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted bg-surface-light/50">
                  {CATEGORY_LABELS[group.category] || group.category}
                </div>
                {group.items.map((item, i) => {
                  const idx = flatOffset + i;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => handleSelect(item.name)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        idx === highlightIndex
                          ? 'bg-accent/20 text-white'
                          : 'text-white hover:bg-surface-light/40'
                      }`}
                    >
                      <span>{item.name}</span>
                      <span className={`ml-2 text-[10px] ${CATEGORY_COLOURS[item.category] || 'text-muted'}`}>
                        {CATEGORY_LABELS[item.category] || item.category}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
