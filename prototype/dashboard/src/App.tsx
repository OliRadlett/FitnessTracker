import React from 'react';
import {
  Activity,
  Bike,
  ChevronLeft,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  Menu,
  Bell,
  MoreHorizontal,
  Search,
  CalendarDays,
} from 'lucide-react';
import { loadFixture } from '@/lab/fixture';
import { PageHead, TodayA, TodayB } from '@/zones/Today';
import { History, Trends } from '@/zones/Trends';

type Zone = 'today' | 'trends' | 'history';
type Variant = 'a' | 'b';

const NAV = [
  { icon: LayoutGrid, label: 'Dashboard', active: true },
  { icon: Bike, label: 'Cycling' },
  { icon: Dumbbell, label: 'Lifting' },
  { icon: HeartPulse, label: 'Health' },
  { icon: CalendarDays, label: 'Training' },
  { icon: Activity, label: 'Activity' },
];

const ZONES: { key: Zone; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'trends', label: 'Trends' },
  { key: 'history', label: 'History' },
];

function useLabState() {
  const params = new URLSearchParams(window.location.search);
  const [zone, setZone] = React.useState<Zone>((params.get('zone') as Zone) || 'today');
  const [variant, setVariant] = React.useState<Variant>((params.get('variant') as Variant) || 'a');
  const capture = params.get('capture') === '1';
  const openAnalysis = params.get('analysis') === 'open';
  const now = params.get('now') || '2026-11-04';

  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('zone', zone);
    url.searchParams.set('variant', variant);
    url.searchParams.set('now', now);
    if (capture) url.searchParams.set('capture', '1');
    window.history.replaceState(null, '', url);
  }, [zone, variant, now, capture]);

  return { zone, setZone, variant, setVariant, capture, now, openAnalysis };
}

export default function App() {
  const f = React.useMemo(() => loadFixture(), []);
  const { zone, setZone, variant, setVariant, capture, now, openAnalysis } = useLabState();

  const body =
    zone === 'today' ? (
      variant === 'a' ? (
        <TodayA f={f} now={now} />
      ) : (
        <TodayB f={f} now={now} />
      )
    ) : zone === 'trends' ? (
      <Trends f={f} now={now} openAnalysis={openAnalysis} />
    ) : (
      <History f={f} />
    );

  return (
    <div className="min-h-full bg-background">
      {/* ── Desktop shell ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[196px] flex-col border-r border-surface-light/40 bg-background px-3 py-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-1">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-background">
            <Activity size={14} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">FitTrack</span>
        </div>
        <button className="mb-4 flex min-h-[40px] items-center gap-2 rounded-lg border border-surface-light/60 px-2 text-[12px] text-muted">
          <Search size={13} /> Search
          <span className="ml-auto rounded border border-surface-light/60 px-1 text-[10px]">⌘K</span>
        </button>
        <nav className="space-y-0.5">
          {NAV.map((n) => (
            <div
              key={n.label}
              className={`flex min-h-[34px] items-center gap-2.5 rounded-lg px-2 text-[13px] ${
                n.active ? 'bg-accent/12 text-accent' : 'text-muted'
              }`}
            >
              <n.icon size={15} />
              {n.label}
            </div>
          ))}
          <div className="flex min-h-[34px] items-center gap-2.5 rounded-lg px-2 text-[13px] text-muted">
            <MoreHorizontal size={15} /> More
          </div>
        </nav>
        <div className="mt-auto border-t border-surface-light/40 pt-3">
          <div className="text-[12px]">Oli Radlett</div>
          <div className="text-[10px] text-muted">o.radlett@gmail.com</div>
        </div>
      </aside>

      {/* ── Mobile top bar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-surface-light/40 bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button aria-label="Menu" className="grid h-9 w-9 place-items-center rounded-lg border border-surface-light/60">
          <Menu size={16} />
        </button>
        <span className="text-[14px] font-semibold">FitTrack</span>
        <button aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-lg border border-surface-light/60">
          <Bell size={16} />
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[9px] font-semibold text-background">
            10
          </span>
        </button>
      </header>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[1160px] px-4 pb-tabbar-clear pt-4 lg:px-6 lg:pb-10 lg:pl-[212px] lg:pt-6">
        {/* Head, then the zone switch — the /lifting pattern: title above tabs. */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          {zone === 'today' ? (
            <PageHead now={now} f={f} />
          ) : (
            <div>
              <h1 className="text-[26px] font-semibold leading-tight">
                {zone === 'trends' ? 'Trends' : 'History'}
              </h1>
              <p className="mt-0.5 text-[13px] text-muted">
                {zone === 'trends'
                  ? 'One range governs every panel below.'
                  : 'The record, as recorded — no derived verdicts.'}
              </p>
            </div>
          )}
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-surface-light bg-surface p-0.5">
            {ZONES.map((z) => (
              <button
                key={z.key}
                onClick={() => setZone(z.key)}
                className={`min-h-[40px] rounded-md px-3.5 text-[12px] font-medium transition-colors ${
                  zone === z.key ? 'bg-accent text-background' : 'text-muted hover:text-foreground'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
          {!capture && (
            <span className="text-[10px] text-muted">
              lab · candidate {variant.toUpperCase()} · pinned {now}
            </span>
          )}
        </div>

        {body}
      </main>

      {/* ── Mobile bottom nav: content must clear it ───────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-surface-light/50 bg-background/95 pb-safe-bottom backdrop-blur lg:hidden">
        <div className="flex items-stretch">
          {[
            { icon: LayoutGrid, label: 'Dashboard', active: true },
            { icon: Bike, label: 'Cycling' },
            { icon: Activity, label: 'Train' },
            { icon: CalendarDays, label: 'Plan' },
            { icon: MoreHorizontal, label: 'More' },
          ].map((n) => (
            <div
              key={n.label}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                n.active ? 'text-accent' : 'text-muted'
              }`}
            >
              <n.icon size={18} />
              {n.label}
            </div>
          ))}
        </div>
      </nav>

      {/* ── Lab switcher (hidden in capture) ──────────────────────────── */}
      {!capture && (
        <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 lg:bottom-4">
          <div className="flex items-center gap-1 rounded-full border border-surface-light bg-surface/95 px-2 py-1 shadow-xl backdrop-blur">
            <ChevronLeft size={12} className="text-muted" />
            <span className="px-1 text-[10px] uppercase tracking-wider text-muted">candidate</span>
            {(['a', 'b'] as Variant[]).map((v) => (
              <button
                key={v}
                onClick={() => setVariant(v)}
                className={`min-h-[24px] rounded-full px-2.5 text-[11px] font-medium ${
                  variant === v ? 'bg-accent text-background' : 'text-muted hover:text-foreground'
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
