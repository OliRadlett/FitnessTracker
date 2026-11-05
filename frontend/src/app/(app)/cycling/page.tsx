'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ErrorState } from '@/components/ui/ErrorState';
import { Card } from '@/components/ui/Card';
import { usePageTitle } from '@/lib/usePageTitle';
import { useDeepLink } from '@/lib/useDeepLink';
import { FormMode } from '@/components/cycling/FormMode';
import { RidesMode } from '@/components/cycling/RidesMode';
import { PowerMode } from '@/components/cycling/PowerMode';
import { useCyclingData, type CyclingMode } from '@/lib/cycling/useCyclingData';
import { rideRows, tsbWord, weeklyBuckets } from '@/lib/cycling/selectors';
import { num } from '@/components/cycling/CyclingUi';

const TABS: { value: CyclingMode; label: string }[] = [
  { value: 'form', label: 'Form' },
  { value: 'rides', label: 'Rides' },
  { value: 'power', label: 'Power' },
];

export default function CyclingPage() {
  usePageTitle('Cycling');
  const { getParam, setParam } = useDeepLink();

  // URL state: `?tab=` (mode), `?ride=` (open ride), `?more=1` (Power disclosure).
  const [tab, setTab] = React.useState<CyclingMode>('form');
  React.useEffect(() => {
    const raw = getParam('tab');
    if (raw === 'rides' || raw === 'power' || raw === 'form') setTab(raw);
  }, [getParam]);

  const changeTab = (next: CyclingMode) => {
    setTab(next);
    setParam('tab', next);
    // A ride deep-link belongs to the Rides tab; drop it when leaving.
    if (next !== 'rides') setParam('ride', null);
    if (next !== 'power') setParam('more', null);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const { profile, activities, metrics, load, ramp, ...power } = useCyclingData(tab);

  const now = React.useMemo(() => new Date(), []);
  const rides = React.useMemo(() => rideRows(activities.data ?? []), [activities.data]);
  const buckets = React.useMemo(() => weeklyBuckets(rides, 12, now), [rides, now]);

  const selectedRide = getParam('ride');
  const more = getParam('more') === '1';

  const ctl = load.data?.current_ctl;
  const tsb = load.data?.current_tsb;
  const wkg = metrics.data?.power_to_weight;
  const subtitle = [
    profile.data?.ftp_watts != null ? `${num(profile.data.ftp_watts, 1)} W FTP` : null,
    wkg != null ? `${num(wkg, 2)} W/kg` : null,
    tsb != null ? `form ${tsb > 0 ? '+' : ''}${tsb.toFixed(0)} ${tsbWord(tsb)}` : null,
    rides.length ? `${rides.length} rides` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const coreError = profile.isError || activities.isError;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cycling"
        subtitle={subtitle || 'Fitness, rides and power — the three questions this page answers'}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(next) => changeTab(next as CyclingMode)}
          ariaLabel="Cycling views"
        />
        {ctl != null && (
          <p className="text-[12px] text-muted">
            Fitness <span className="tabular-nums text-foreground">{num(ctl, 1)}</span> · form{' '}
            <span className="tabular-nums text-foreground">
              {tsb != null ? `${tsb > 0 ? '+' : ''}${tsb.toFixed(1)}` : '—'}
            </span>
          </p>
        )}
      </div>

      <ErrorState variant="inline" show={coreError} message="Some cycling data failed to load." />

      {tab === 'form' && (
        <FormMode
          profile={profile.data}
          metrics={metrics.data}
          load={load.data}
          ramp={ramp.data}
          rides={rides}
          buckets={buckets}
          onOpenRide={(id) => {
            setTab('rides');
            setParam('tab', 'rides');
            setParam('ride', id);
          }}
        />
      )}

      {tab === 'rides' && <RidesMode rides={rides} selectedId={selectedRide} onSelect={(id) => setParam('ride', id)} />}

      {tab === 'power' && (
        <PowerMode
          profile={profile.data}
          curveWindow={power.curveWindow.data}
          curveYear={power.curveYear.data}
          percentile={power.percentile.data}
          zones={power.zones.data}
          decoupling={power.decoupling.data}
          model={power.model.data}
          vo2max={power.vo2max.data}
          weather={power.weather.data}
          more={more}
          onToggleMore={() => setParam('more', more ? null : '1')}
        />
      )}

      {tab === 'form' && profile.isLoading && (
        <Card>
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-24 rounded bg-surface-light" />
            <div className="h-8 w-16 rounded bg-surface-light" />
          </div>
        </Card>
      )}
    </div>
  );
}
