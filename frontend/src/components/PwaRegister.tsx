'use client';

import { useEffect, useState } from 'react';

export function PwaRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/fittrack/sw.js').catch(() => {
      // SW registration failed — non-critical, app works without it
    });

    // A freshly-activated SW (e.g. after a deploy) takes control of this tab
    // via clients.claim(), while the page is still running the *previous* JS
    // bundle. That bundle/SW mismatch is what makes newly-deployed routes
    // (such as /lifting/live) fail to load — the stale SW serves old chunks or
    // cached API responses. Prompt the user to reload so the running bundle
    // matches the active SW.
    //
    // `controllerchange` fires when the new SW claims an open tab (the v2 SW
    // calls skipWaiting() + clients.claim() on install, so this is reliable for
    // full navigations). `updatefound`/`waiting` cover in-page installs that
    // go through the "waiting" phase instead.
    const onControllerChange = () => setUpdateAvailable(true);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const checkWaiting = () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) setUpdateAvailable(true);
      });
    };
    checkWaiting();
    const onUpdateFound = () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;
        const installing = reg.installing;
        if (installing) {
          installing.addEventListener('statechange', () => checkWaiting());
        }
      });
    };
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.addEventListener('updatefound', onUpdateFound);
    });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.getRegistration().then((reg) => {
        reg?.removeEventListener('updatefound', onUpdateFound);
      });
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between gap-3 bg-accent text-background px-4 py-2.5 text-sm font-medium shadow-lg">
      <span>A new version of FitTrack is available.</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1 rounded bg-background/90 text-accent text-xs font-semibold"
        >
          Reload
        </button>
        <button
          onClick={() => setUpdateAvailable(false)}
          aria-label="Dismiss"
          className="p-0.5 rounded hover:bg-background/20"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
    </div>
  );
}
