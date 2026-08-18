'use client';

import React, { useEffect, useState } from 'react';

export interface PREvent {
  exercise_name: string;
  new_1rm: number;
  previous_1rm: number | null;
  improvement_pct: number | null;
}

interface PRCelebrationProps {
  pr: PREvent | null;
  onDismiss: () => void;
}

/**
 * Animated toast notification shown when a new PR is detected.
 * Auto-dismisses after 8 seconds with scale + fade-in CSS animations.
 */
export function PRCelebration({ pr, onDismiss }: PRCelebrationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pr) {
      // Trigger enter animation on next frame
      requestAnimationFrame(() => setVisible(true));

      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300); // wait for exit animation
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, [pr, onDismiss]);

  if (!pr) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 pointer-events-auto"
      role="alert"
      aria-live="polite"
    >
      <div
        className={`
          bg-gradient-to-br from-yellow-500/20 via-amber-500/10 to-orange-500/20
          border border-yellow-400/40 rounded-xl p-5 shadow-2xl
          backdrop-blur-sm max-w-sm
          transition-all duration-300 ease-out
          ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-75 -translate-y-4'}
        `}
      >
        {/* Confetti-like decorative elements */}
        <div className="absolute -top-2 -left-2 text-2xl animate-bounce">🏆</div>
        <div className="absolute -top-1 -right-1 text-xl animate-pulse">⭐</div>
        <div className="absolute -bottom-1 left-4 text-lg" style={{ animation: 'spin 2s linear infinite' }}>✨</div>

        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1">
              🎉 New Personal Record!
            </p>
            <p className="text-lg font-bold text-white truncate">{pr.exercise_name}</p>

            <div className="mt-2 flex items-center gap-3">
              <div className="text-center">
                <p className="text-2xl font-extrabold text-yellow-300">
                  {pr.new_1rm.toFixed(1)}
                </p>
                <p className="text-[10px] text-yellow-400/70 uppercase">Est. 1RM (kg)</p>
              </div>

              {pr.previous_1rm !== null && (
                <>
                  <div className="text-muted text-lg">→</div>
                  <div className="text-center">
                    <p className="text-sm text-muted line-through">
                      {pr.previous_1rm.toFixed(1)}
                    </p>
                    <p className="text-[10px] text-muted">Previous</p>
                  </div>
                </>
              )}

              {pr.improvement_pct !== null && pr.improvement_pct > 0 && (
                <div className="text-center ml-auto">
                  <p className="text-lg font-bold text-green-400">
                    +{pr.improvement_pct.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-green-400/70">Improvement</p>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => {
              setVisible(false);
              setTimeout(onDismiss, 300);
            }}
            className="text-muted hover:text-white transition-colors text-lg leading-none shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
