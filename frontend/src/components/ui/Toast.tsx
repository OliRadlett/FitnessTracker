'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  success: (message: string, action?: ToastAction) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { icon: React.ReactNode; ring: string }> = {
  success: {
    icon: <CircleCheck size={18} aria-hidden="true" className="text-positive shrink-0" />,
    ring: 'border-positive/30',
  },
  error: {
    icon: <TriangleAlert size={18} aria-hidden="true" className="text-warning shrink-0" />,
    ring: 'border-warning/30',
  },
  info: {
    icon: <Info size={18} aria-hidden="true" className="text-info shrink-0" />,
    ring: 'border-surface-light',
  },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const style = TONE_STYLES[item.tone];
  const role = item.tone === 'error' ? 'alert' : 'status';
  return (
    <div
      role={role}
      className={`pointer-events-auto w-full flex items-center gap-2.5 bg-surface border ${style.ring} rounded-xl px-4 py-3 shadow-2xl`}
    >
      {style.icon}
      <p className="flex-1 text-sm text-foreground min-w-0">{item.message}</p>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-lg text-muted hover:text-foreground hover:bg-surface-light/50 transition-colors"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * App-wide toast system. Success/info auto-dismiss; errors stay until
 * dismissed. Mounted once in `Providers`.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'info', action?: ToastAction) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message, action }]);
    // An actionable toast waits for the user; a plain success/info auto-dismisses.
    if (tone !== 'error' && !action) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: (message: string, tone: ToastTone = 'info', action?: ToastAction) => push(message, tone, action),
      success: (message: string, action?: ToastAction) => push(message, 'success', action),
      error: (message: string) => push(message, 'error'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 w-full max-w-md px-4 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
