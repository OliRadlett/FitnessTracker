'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import {
  getCalendar,
  useAuthFetch,
  type CalendarResponse,
} from '@/lib/api';
import { isoDate, monthLabel, monthSummary, parseDate } from '@/lib/calendar';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePageTitle } from '@/lib/usePageTitle';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonLine, SkeletonMetric } from '@/components/ui/Skeleton';
import { Agenda } from '@/components/calendar/Agenda';
import { DayInspector } from '@/components/calendar/DayInspector';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { SummaryStrip } from '@/components/calendar/SummaryStrip';
import { Segmented } from '@/components/calendar/calendarUi';

type View = 'month' | 'agenda';

interface InitialState {
  month: Date;
  day: string;
  view: View;
  dayExplicit: boolean;
}

function readParams(): InitialState {
  const params = new URLSearchParams(window.location.search);
  const now = new Date();
  const rawDay = params.get('day');
  const rawMonth = params.get('month');
  let month = startOfMonth(now);

  if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
    month = new Date(Number(rawMonth.slice(0, 4)), Number(rawMonth.slice(5, 7)) - 1, 1);
  } else if (rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay)) {
    month = startOfMonth(parseDate(rawDay));
  }

  return {
    month,
    day: rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : isoDate(now),
    view: params.get('view') === 'agenda' ? 'agenda' : 'month',
    dayExplicit: Boolean(rawDay),
  };
}

function writeParams(next: { month?: Date; day?: string; view?: View }) {
  const params = new URLSearchParams(window.location.search);
  if (next.month) params.set('month', isoDate(next.month).slice(0, 7));
  if (next.day) params.set('day', next.day);
  if (next.view) params.set('view', next.view);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function CalendarSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-3" aria-label="Loading calendar">
      <div className={compact ? 'grid grid-cols-2 gap-2.5' : 'grid grid-cols-2 gap-2.5 lg:grid-cols-4'}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonMetric key={i} />
        ))}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SkeletonLine className="h-[560px] rounded-xl" />
        {!compact && <SkeletonLine className="h-[420px] rounded-xl" />}
      </div>
    </div>
  );
}

function CalendarEmpty({ month }: { month: Date }) {
  return (
    <Card className="!p-8">
      <div className="mx-auto flex max-w-[460px] flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-light/70 bg-surface-light/30">
          <CalendarDays className="h-5 w-5 text-muted/60" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          No training in {format(month, 'MMMM yyyy')}
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-muted/70">
          Build a plan to see planned sessions here, or log a session and it will appear as
          completed work. Empty days stay quiet, so the month reads at a glance.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/training"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-4 text-xs font-semibold text-accent hover:bg-accent/15"
          >
            Open Training
          </Link>
          <Link
            href="/lifting/live"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-surface-light/70 bg-surface-light/30 px-4 text-xs font-semibold text-foreground/80 hover:border-accent/30"
          >
            Log a session
          </Link>
        </div>
      </div>
    </Card>
  );
}

export default function CalendarPage() {
  usePageTitle('Calendar');
  const { authFetch, token } = useAuthFetch();
  const isMobile = useIsMobile('(max-width: 1023px)');

  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(() => isoDate(new Date()));
  const [view, setView] = useState<View>('month');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Read URL state after mount to avoid a server/client hydration mismatch.
  useEffect(() => {
    const initial = readParams();
    setMonth(initial.month);
    setSelectedDay(initial.day);
    setView(initial.view);
    if (initial.dayExplicit && window.matchMedia('(max-width: 1023px)').matches) {
      setSheetOpen(true);
    }

    const onPop = () => {
      const next = readParams();
      setMonth(next.month);
      setSelectedDay(next.day);
      setView(next.view);
      setSheetOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { fetchStart, fetchEnd } = useMemo(() => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    return {
      fetchStart: format(startOfWeek(monthStart, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      fetchEnd: format(endOfWeek(monthEnd, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  }, [month]);

  const { data, isLoading, isError, refetch } = useQuery<CalendarResponse>({
    queryKey: ['calendar', fetchStart, fetchEnd],
    queryFn: () => getCalendar(authFetch, { start: fetchStart, end: fetchEnd }),
    enabled: !!token,
    staleTime: 60_000,
  });

  const today = data?.today ?? isoDate(new Date());
  const summary = data ? monthSummary(data, month) : null;
  const selected = data?.days.find((day) => day.date === selectedDay);
  const hasAnyData =
    !!data &&
    (data.plan !== null ||
      data.days.some((day) => day.plan.length || day.activities.length || day.lifts.length) ||
      data.events.length > 0 ||
      data.goals.length > 0);

  function changeMonth(next: Date) {
    const normalized = startOfMonth(next);
    setMonth(normalized);
    const current = parseDate(selectedDay);
    if (
      current.getMonth() !== normalized.getMonth() ||
      current.getFullYear() !== normalized.getFullYear()
    ) {
      const first = isoDate(normalized);
      setSelectedDay(first);
      writeParams({ month: normalized, day: first });
    } else {
      writeParams({ month: normalized });
    }
  }

  function goToday() {
    const now = new Date();
    const normalized = startOfMonth(now);
    setMonth(normalized);
    setSelectedDay(isoDate(now));
    setSheetOpen(false);
    writeParams({ month: normalized, day: isoDate(now) });
  }

  function selectDay(date: string) {
    setSelectedDay(date);
    writeParams({ day: date });
    if (isMobile) setSheetOpen(true);
  }

  function changeView(next: View) {
    setView(next);
    writeParams({ view: next });
  }

  function closeSheet() {
    setSheetOpen(false);
  }

  const unavailable = data ? Object.keys(data.unavailable) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        subtitle="Planned vs actual, load, and the day ahead — cycling and lifting in one time surface."
        actions={
          <div className="flex flex-wrap items-center gap-2 pr-12">
            {!isMobile && (
              <Segmented
                value={view}
                options={[
                  { value: 'month', label: 'Month' },
                  { value: 'agenda', label: 'Agenda' },
                ]}
                onChange={changeView}
                label="Calendar view"
              />
            )}
            <div className="inline-flex items-center rounded-xl border border-surface-light bg-surface-light/25 p-0.5">
              <IconButton label="Previous month" onClick={() => changeMonth(subMonths(month, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <span className="min-w-[118px] px-2 text-center text-xs font-semibold text-foreground/85">
                {monthLabel(month)}
              </span>
              <IconButton label="Next month" onClick={() => changeMonth(addMonths(month, 1))}>
                <ChevronRight className="h-4 w-4" />
              </IconButton>
            </div>
            <Button variant="secondary" size="sm" onClick={goToday}>
              Today
            </Button>
          </div>
        }
      />

      {unavailable.length > 0 && (
        <p className="text-[10px] text-muted/60" role="status">
          Some context is temporarily unavailable: {unavailable.join(', ')}.
        </p>
      )}

      {isLoading ? (
        <CalendarSkeleton compact={isMobile} />
      ) : isError ? (
        <ErrorState
          title="Couldn't load the calendar"
          message="The calendar data did not arrive. Check your connection and try again."
          onRetry={() => refetch()}
        />
      ) : !data ? null : !hasAnyData ? (
        <CalendarEmpty month={month} />
      ) : (
        <>
          <SummaryStrip fixture={data} month={month} summary={summary!} compact={isMobile} />
          <div className="grid items-start gap-4 min-[1440px]:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              {isMobile || view === 'agenda' ? (
                <Agenda
                  fixture={data}
                  month={month}
                  today={today}
                  selectedDate={selectedDay}
                  onSelect={selectDay}
                  onOpenDay={selectDay}
                />
              ) : (
                <MonthGrid
                  fixture={data}
                  month={month}
                  today={today}
                  selectedDate={selectedDay}
                  onSelect={selectDay}
                />
              )}
            </div>

            {!isMobile && (
              <div className="mx-auto w-full max-w-[760px] min-[1440px]:sticky min-[1440px]:top-4 min-[1440px]:mx-0 min-[1440px]:max-w-none">
                <DayInspector
                  fixture={data}
                  day={selected}
                  today={today}
                  variant="panel"
                />
              </div>
            )}
          </div>
        </>
      )}

      {isMobile && data && (
        <Modal
          open={sheetOpen}
          onClose={closeSheet}
          aria-label="Day detail"
          size="lg"
        >
          <DayInspector
            fixture={data}
            day={selected}
            today={today}
            variant="sheet"
            surface="bare"
            onClose={closeSheet}
          />
        </Modal>
      )}
    </div>
  );
}
