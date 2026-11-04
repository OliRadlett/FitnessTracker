'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { useDeepLink } from '@/lib/useDeepLink';
import { usePageTitle } from '@/lib/usePageTitle';
import { resolveHealthAlert } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { TimeRangeProvider, timeRangeDays, useTimeRange } from '@/lib/time-range';
import { HealthPageView } from '@/components/health/HealthPageView';
import { SyncLine } from '@/components/health/HealthUi';
import { useHealthPageData } from '@/components/health/useHealthPageData';
import { PullSyncStatus, usePullToSync } from '@/components/health/usePullToSync';
import { fmtFull, type HealthTab } from '@/components/health/healthView';

export default function HealthPage() {
  return (
    <TimeRangeProvider>
      <HealthPageInner />
    </TimeRangeProvider>
  );
}

function HealthPageInner() {
  usePageTitle('Health');
  const [tab, setTab] = useState<HealthTab>('now');
  const [focusAlertId, setFocusAlertId] = useState<string | null>(null);
  const { start, end } = useTimeRange();
  const rangeDays = timeRangeDays(start, end);
  const { getParam } = useDeepLink();
  const alertKey = getParam('alert');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t === 'now' || t === 'trends' || t === 'history') setTab(t);
  }, []);

  const { vm, checking, regenerating, runCheck, regenerate, refetchAll } = useHealthPageData(tab, rangeDays);
  const pullPhase = usePullToSync(refetchAll);

  const chooseTab = (next: HealthTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const targetAlert = useMemo(
    () => resolveHealthAlert(vm.alerts, alertKey),
    [vm.alerts, alertKey],
  );

  useEffect(() => {
    if (!targetAlert) return;
    setTab('history');
    setFocusAlertId(targetAlert.id);
  }, [targetAlert]);

  if (vm.isLoading && !vm.readiness) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><HeartPulse className="h-6 w-6 text-accent" />Health</span>}
          subtitle="Recovery, sleep and strain — powered by Whoop."
        />
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="h-64 animate-pulse rounded-2xl bg-surface" />
          <div className="h-64 animate-pulse rounded-2xl bg-surface" />
        </div>
        <div className="h-40 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PullSyncStatus phase={pullPhase} label="Health sync status" />
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><HeartPulse className="h-6 w-6 text-accent" />Health</span>}
        subtitle="Recovery, sleep and strain — powered by Whoop."
        status={
          <div className="mt-2 flex flex-col gap-1">
            <SyncLine vm={vm} loading={vm.connectionsLoading} />
            <span className={`text-xs ${vm.isStale ? 'text-caution' : 'text-muted'}`}>
              {vm.isStale ? `Last data ${fmtFull(vm.asOf)}` : `As of ${fmtFull(vm.asOf)}`}
            </span>
          </div>
        }
      />
      <HealthPageView
        vm={vm}
        tab={tab}
        onTab={chooseTab}
        rangeDays={rangeDays}
        checking={checking}
        onCheck={runCheck}
        onRetry={refetchAll}
        onConnect={() => window.location.assign('/fittrack/settings')}
        onRegenerate={regenerate}
        regenerating={regenerating}
        focusAlertId={focusAlertId}
      />
    </div>
  );
}
