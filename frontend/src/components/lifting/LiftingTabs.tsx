'use client';

import { UnderlineTabs, type TabOption } from '@/components/ui/UnderlineTabs';

export type LiftingTab = 'overview' | 'sessions' | 'analytics' | 'prs';

const TABS: TabOption<LiftingTab>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'prs', label: 'PRs' },
];

/**
 * The lifting page's section switch — options only. The behaviour (roving
 * tabindex, arrow/Home/End, underline, 390 px segments) lives in the shared
 * `UnderlineTabs`, which `/cycling` uses with the same props so the two pages
 * cannot drift apart.
 */
export function LiftingTabs({ value, onChange }: { value: LiftingTab; onChange: (tab: LiftingTab) => void }) {
  return <UnderlineTabs options={TABS} value={value} onChange={onChange} ariaLabel="Lifting sections" />;
}
