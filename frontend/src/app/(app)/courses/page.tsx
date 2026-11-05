'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  FolderPlus,
  Link2,
  MapPin,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Unlink,
  X,
} from 'lucide-react';
import { useAuthFetch } from '@/lib/api';
import {
  confirmRideLink,
  createCourse,
  dismissCourseSuggestion,
  getCourse,
  getCourseSuggestions,
  getCourses,
  getDismissedCourseSuggestions,
  getUncoursedRoutes,
  groupRoute,
  mergeCourse,
  rejectRideLink,
  restoreCourseSuggestion,
  ungroupRoute,
  updateCourse,
} from '@/lib/api/courses';
import { getRouteScanStatus, refreshRouteScan } from '@/lib/api/routes';
import type {
  CourseActivity,
  CourseDetail,
  CourseRoute,
  CourseSuggestion,
  CourseSummary,
  DismissedCourseSuggestion,
} from '@/lib/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { RouteShape } from '@/components/routes/atlas/RouteShape';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatKm } from '@/lib/routeAtlas';
import { usePageTitle } from '@/lib/usePageTitle';

function statusBadge(status: CourseActivity['route_link_status']) {
  if (status === 'confirmed') return <Badge variant="positive">Confirmed</Badge>;
  if (status === 'suggested') return <Badge variant="warning">Suggested</Badge>;
  return <Badge variant="muted">Rejected</Badge>;
}

function SuggestionCard({
  suggestion,
  onMerge,
  onDismiss,
  busy,
  dismissing,
}: {
  suggestion: CourseSuggestion;
  onMerge: () => void;
  onDismiss: () => void;
  busy: boolean;
  dismissing: boolean;
}) {
  const canMerge =
    !!suggestion.route_a_course_id &&
    !!suggestion.route_b_course_id &&
    suggestion.route_a_course_id !== suggestion.route_b_course_id;
  const bd = suggestion.breakdown as
    | { min_coverage?: number; frechet_similarity?: number }
    | null;

  return (
    <div className="rounded-xl border border-surface-light/60 bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="warning">
          {Math.round(suggestion.score * 100)}% pair
        </Badge>
        <span className="text-[11px] uppercase tracking-wide text-muted">
          {suggestion.tier}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          {
            shape: suggestion.route_a_preview_polyline,
            name: suggestion.route_a_name,
            distance: suggestion.route_a_distance_meters,
          },
          {
            shape: suggestion.route_b_preview_polyline,
            name: suggestion.route_b_name,
            distance: suggestion.route_b_distance_meters,
          },
        ].map((side, index) => (
          <div key={index} className="flex min-w-0 items-center gap-2">
            <RouteShape
              encoded={side.shape}
              width={52}
              height={38}
              className="shrink-0 text-muted"
              strokeWidth={2}
              showEndpoints={false}
            />
            <div className="min-w-0">
              <p className="truncate text-xs text-foreground">{side.name}</p>
              <p className="text-[11px] text-muted">{formatKm(side.distance)}</p>
            </div>
          </div>
        ))}
      </div>
      {bd && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
          <span>
            overlap{' '}
            {Math.round((bd.min_coverage ?? 0) * 100)}%
          </span>
          <span>
            shape{' '}
            {Math.round((bd.frechet_similarity ?? 0) * 100)}%
          </span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted">
          {canMerge
            ? 'Review-tier suggestion — nothing is merged automatically.'
            : 'Both routes need a course before they can be merged.'}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            loading={dismissing}
            onClick={onDismiss}
            title="Hide this pair; it will not be suggested again"
          >
            <X className="h-4 w-4" aria-hidden />
            Not the same
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canMerge}
            loading={busy}
            onClick={onMerge}
            title={canMerge ? 'Merge the two courses, keeping every route' : undefined}
          >
            Merge into one course
          </Button>
        </div>
      </div>
    </div>
  );
}

function DismissedSuggestionRow({
  suggestion,
  onRestore,
  busy,
}: {
  suggestion: DismissedCourseSuggestion;
  onRestore: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-surface-light/30 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        {[
          {
            shape: suggestion.route_a_preview_polyline,
            name: suggestion.route_a_name,
            distance: suggestion.route_a_distance_meters,
          },
          {
            shape: suggestion.route_b_preview_polyline,
            name: suggestion.route_b_name,
            distance: suggestion.route_b_distance_meters,
          },
        ].map((side, index) => (
          <div key={index} className="flex min-w-0 items-center gap-2">
            <RouteShape
              encoded={side.shape}
              width={42}
              height={32}
              className="shrink-0 text-muted"
              strokeWidth={2}
              showEndpoints={false}
            />
            <span className="min-w-0">
              <span className="block truncate text-xs text-foreground">
                {side.name}
              </span>
              <span className="block text-[11px] text-muted">
                {formatKm(side.distance)}
              </span>
            </span>
          </div>
        ))}
      </div>
      <span className="text-[11px] text-muted">
        Dismissed {formatDate(suggestion.dismissed_at)}
      </span>
      <Button variant="secondary" size="sm" loading={busy} onClick={onRestore}>
        Restore
      </Button>
    </div>
  );
}

function CourseCard({
  course,
  active,
  onSelect,
}: {
  course: CourseSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/10'
          : 'border-surface-light/60 bg-surface hover:border-accent/40'
      }`}
    >
      <RouteShape
        encoded={course.preview_polyline}
        width={76}
        height={56}
        className="shrink-0 text-accent"
        strokeWidth={2.4}
        showEndpoints={false}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {course.name}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">
          {course.route_count} {course.route_count === 1 ? 'variant' : 'variants'}
          {' · '}
          {course.confirmed_ride_count} confirmed
          {course.suggested_ride_count > 0
            ? ` · ${course.suggested_ride_count} suggested`
            : ''}
        </span>
        {course.last_ridden_date && (
          <span className="mt-0.5 block text-[11px] text-muted">
            Last ridden {formatDate(course.last_ridden_date)}
          </span>
        )}
      </span>
    </button>
  );
}

function CourseRouteRow({
  route,
  onUngroup,
  busy,
}: {
  route: CourseRoute;
  onUngroup: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-surface-light/30 py-2 last:border-b-0">
      <RouteShape
        encoded={route.preview_polyline}
        width={54}
        height={40}
        className="shrink-0 text-muted"
        strokeWidth={2}
        showEndpoints={false}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm text-foreground">{route.name}</span>
          {route.is_canonical && <Badge variant="default">Canonical</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
          <span>{formatKm(route.distance_meters)}</span>
          <span>{route.confirmed_ride_count} confirmed</span>
          {route.suggested_ride_count > 0 && (
            <span>{route.suggested_ride_count} suggested</span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onUngroup}
        loading={busy}
        title="Remove this variant from the course (the route is kept)"
      >
        <Unlink className="h-4 w-4" aria-hidden />
        Ungroup
      </Button>
    </div>
  );
}

function CourseDetailPanel({
  detail,
  loading,
  onUngroup,
  onLink,
  onRename,
  busyRouteId,
  busyActivityId,
  renaming,
}: {
  detail: CourseDetail | undefined;
  loading: boolean;
  onUngroup: (routeId: string) => void;
  onLink: (activityId: string, status: 'confirmed' | 'rejected') => void;
  onRename: (name: string) => void;
  busyRouteId: string | null;
  busyActivityId: string | null;
  renaming: boolean;
}) {
  const [showAllRides, setShowAllRides] = useState(false);
  const [renamingOpen, setRenamingOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    setNameDraft(detail?.name ?? '');
    setRenamingOpen(false);
  }, [detail?.id, detail?.name]);

  if (loading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">Loading course…</p>
      </Card>
    );
  }
  if (!detail) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">Select a course to see its variants and rides.</p>
      </Card>
    );
  }

  const suggested = detail.activities.filter((a) => a.route_link_status === 'suggested');
  const confirmed = detail.activities.filter((a) => a.route_link_status === 'confirmed');
  const rides = [...confirmed, ...suggested];
  const visibleRides = showAllRides ? rides : rides.slice(0, 6);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renamingOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-surface-light/60 bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-accent"
                aria-label="Course name"
              />
              <Button
                size="sm"
                loading={renaming}
                disabled={!nameDraft.trim()}
                onClick={() => onRename(nameDraft)}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRenamingOpen(false);
                  setNameDraft(detail.name);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{detail.name}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNameDraft(detail.name);
                  setRenamingOpen(true);
                }}
              >
                Rename
              </Button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted">
            {detail.route_count} {detail.route_count === 1 ? 'variant' : 'variants'}
            {' · '}
            {detail.confirmed_ride_count} confirmed rides
            {detail.suggested_ride_count > 0
              ? ` · ${detail.suggested_ride_count} suggested`
              : ''}
            {' · '}source: {detail.identity_source}
          </p>
        </div>
        <Badge variant="muted">{detail.sport_type}</Badge>
      </div>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
        Route variants
      </h3>
      <div className="mt-1">
        {detail.routes.length === 0 ? (
          <p className="py-3 text-sm text-muted">No routes in this course yet.</p>
        ) : (
          detail.routes.map((route) => (
            <CourseRouteRow
              key={route.id}
              route={route}
              onUngroup={() => onUngroup(route.id)}
              busy={busyRouteId === route.id}
            />
          ))
        )}
      </div>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">
        Rides
      </h3>
      <p className="mt-1 text-[11px] text-muted">
        Existing links came from the WIP matcher. Confirm a ride before it counts as
        course history; reject it to keep the route without it.
      </p>
      {detail.activities.length === 0 ? (
        <p className="py-3 text-sm text-muted">No confirmed or suggested rides.</p>
      ) : (
        <>
          <div className="mt-2 space-y-2">
            {visibleRides.map((activity) => (
            <div
              key={activity.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-light/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{activity.name}</p>
                <p className="text-[11px] text-muted">
                  {formatDate(activity.start_date)}
                  {activity.distance_meters
                    ? ` · ${formatKm(activity.distance_meters)}`
                    : ''}
                  {activity.route_name ? ` · ${activity.route_name}` : ''}
                </p>
              </div>
              {statusBadge(activity.route_link_status)}
              {activity.route_link_status === 'suggested' && (
                <div className="flex gap-1">
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => onLink(activity.id, 'confirmed')}
                    loading={busyActivityId === activity.id}
                    title="Count this ride as course history"
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onLink(activity.id, 'rejected')}
                    loading={busyActivityId === activity.id}
                    title="Keep the route, but not this ride link"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {rides.length > 6 && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => setShowAllRides((v) => !v)}
          >
            {showAllRides ? 'Show fewer rides' : `Show all ${rides.length} rides`}
          </Button>
        )}
        </>
      )}
    </Card>
  );
}

export default function CoursesPage() {
  usePageTitle('Courses');
  const { token } = useAuthFetch();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [uncoursedFilter, setUncoursedFilter] = useState('');
  const [showAllUncoursed, setShowAllUncoursed] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [busyActivityId, setBusyActivityId] = useState<string | null>(null);

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => getCourses(token),
    enabled: !!token,
  });
  const uncoursedQuery = useQuery({
    queryKey: ['courses', 'uncoursed'],
    queryFn: () => getUncoursedRoutes(token),
    enabled: !!token,
  });
  const suggestionsQuery = useQuery({
    queryKey: ['course-suggestions'],
    queryFn: () => getCourseSuggestions(token),
    enabled: !!token,
  });
  const dismissedQuery = useQuery({
    queryKey: ['course-suggestions', 'dismissed'],
    queryFn: () => getDismissedCourseSuggestions(token),
    enabled: !!token,
  });
  const scanQuery = useQuery({
    queryKey: ['route-scan-status'],
    queryFn: () => getRouteScanStatus(token),
    enabled: !!token,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'queued' || state === 'running' ? 4000 : false;
    },
  });
  const previousScanState = useRef<string | undefined>(undefined);

  useEffect(() => {
    const state = scanQuery.data?.state;
    if (
      state === 'ready' &&
      previousScanState.current &&
      previousScanState.current !== 'ready'
    ) {
      queryClient.invalidateQueries({ queryKey: ['course-suggestions'] });
    }
    previousScanState.current = state;
  }, [queryClient, scanQuery.data?.state]);

  const courses = coursesQuery.data ?? [];
  const uncoursed = uncoursedQuery.data ?? [];
  const suggestions = suggestionsQuery.data ?? [];
  const dismissed = dismissedQuery.data ?? [];
  const scan = scanQuery.data;
  const scanning = scan?.state === 'queued' || scan?.state === 'running';
  const visibleSuggestions = showAllSuggestions ? suggestions : suggestions.slice(0, 6);
  const filteredUncoursed = useMemo(() => {
    const query = uncoursedFilter.trim().toLowerCase();
    if (!query) return uncoursed;
    return uncoursed.filter((route) => route.name.toLowerCase().includes(query));
  }, [uncoursed, uncoursedFilter]);
  const visibleUncoursed = showAllUncoursed
    ? filteredUncoursed
    : filteredUncoursed.slice(0, 18);
  const filteredCourses = useMemo(() => {
    const query = courseFilter.trim().toLowerCase();
    if (!query) return courses;
    return courses.filter((course) => course.name.toLowerCase().includes(query));
  }, [courseFilter, courses]);
  const visibleCourses = showAllCourses
    ? filteredCourses
    : filteredCourses.slice(0, 12);
  const activeCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) ?? courses[0] ?? null,
    [courses, selectedCourseId],
  );

  const detailQuery = useQuery({
    queryKey: ['course', activeCourse?.id],
    queryFn: () => getCourse(activeCourse!.id, token),
    enabled: !!token && !!activeCourse,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['courses'] });
    queryClient.invalidateQueries({ queryKey: ['course'] });
    queryClient.invalidateQueries({ queryKey: ['course-suggestions'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createCourse(
        {
          name: newCourseName.trim(),
          sport_type: 'cycling',
          route_ids: Array.from(selectedRouteIds),
        },
        token,
      ),
    onSuccess: (course) => {
      setSelectedCourseId(course.id);
      setNewCourseName('');
      setSelectedRouteIds(new Set());
      invalidate();
      toast.success(`Created “${course.name}” with ${course.route_count} variants.`);
    },
    onError: (err) =>
      toast.error(`Could not create the course: ${(err as Error).message}`),
  });

  const groupMutation = useMutation({
    mutationFn: ({ courseId, routeId }: { courseId: string; routeId: string }) =>
      groupRoute(courseId, routeId, token),
    onMutate: ({ routeId }) => setBusyRouteId(routeId),
    onSuccess: (_course, variables) => {
      setSelectedRouteIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.routeId);
        return next;
      });
      invalidate();
      toast.success('Route grouped into the course.');
    },
    onError: (err) => toast.error(`Could not group the route: ${(err as Error).message}`),
    onSettled: () => setBusyRouteId(null),
  });

  const ungroupMutation = useMutation({
    mutationFn: ({ courseId, routeId }: { courseId: string; routeId: string }) =>
      ungroupRoute(courseId, routeId, token),
    onMutate: ({ routeId }) => setBusyRouteId(routeId),
    onSuccess: () => {
      invalidate();
      toast.success('Route removed from the course; the route is still in the library.');
    },
    onError: (err) =>
      toast.error(`Could not ungroup the route: ${(err as Error).message}`),
    onSettled: () => setBusyRouteId(null),
  });

  const mergeMutation = useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
      mergeCourse(targetId, sourceId, token),
    onSuccess: (course) => {
      setSelectedCourseId(course.id);
      setMergeSourceId('');
      invalidate();
      toast.success(
        `Merged into “${course.name}” — ${course.route_count} variants, no routes deleted.`,
      );
    },
    onError: (err) =>
      toast.error(`Could not merge the courses: ${(err as Error).message}`),
  });

  const startScanMutation = useMutation({
    mutationFn: () => refreshRouteScan(token),
    onSuccess: () => {
      scanQuery.refetch();
      toast.success('Duplicate scan queued — suggestions update when it finishes.');
    },
    onError: (err) =>
      toast.error(`Could not queue the scan: ${(err as Error).message}`),
  });

  const restoreMutation = useMutation({
    mutationFn: ({ routeAId, routeBId }: { routeAId: string; routeBId: string }) =>
      restoreCourseSuggestion(routeAId, routeBId, token),
    onSuccess: () => {
      invalidate();
      toast.success('Suggestion restored.');
    },
    onError: (err) =>
      toast.error(`Could not restore the suggestion: ${(err as Error).message}`),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      updateCourse(activeCourse!.id, { name: name.trim() }, token),
    onSuccess: (course) => {
      invalidate();
      toast.success(`Course renamed to “${course.name}”.`);
    },
    onError: (err) =>
      toast.error(`Could not rename the course: ${(err as Error).message}`),
  });

  const dismissMutation = useMutation({
    mutationFn: ({ routeAId, routeBId }: { routeAId: string; routeBId: string }) =>
      dismissCourseSuggestion(routeAId, routeBId, token),
    onSuccess: () => {
      invalidate();
      toast.success('Suggestion dismissed — it will not be proposed again.');
    },
    onError: (err) =>
      toast.error(`Could not dismiss the suggestion: ${(err as Error).message}`),
  });

  const linkMutation = useMutation({
    mutationFn: ({
      activityId,
      status,
    }: {
      activityId: string;
      status: 'confirmed' | 'rejected';
    }) =>
      status === 'confirmed'
        ? confirmRideLink(activityId, token)
        : rejectRideLink(activityId, token),
    onMutate: ({ activityId }) => setBusyActivityId(activityId),
    onSuccess: (_result, variables) => {
      invalidate();
      toast.success(
        variables.status === 'confirmed'
          ? 'Ride confirmed as course history.'
          : 'Ride link rejected.',
      );
    },
    onError: (err) => toast.error(`Could not update the ride link: ${(err as Error).message}`),
    onSettled: () => setBusyActivityId(null),
  });

  const toggleRoute = (routeId: string) => {
    setSelectedRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const totalRoutes = courses.reduce((sum, course) => sum + course.route_count, 0);
  const totalConfirmed = courses.reduce(
    (sum, course) => sum + course.confirmed_ride_count,
    0,
  );
  const totalSuggested = courses.reduce(
    (sum, course) => sum + course.suggested_ride_count,
    0,
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 pb-24 lg:pb-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Courses</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              A course is the identity; a route is a concrete variant. Grouping keeps
              every route and every ride — it does not merge or delete them.
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="muted">{courses.length} courses</Badge>
            <Badge variant="muted">{totalRoutes} variants</Badge>
            <Badge variant="muted">{uncoursed.length} uncoursed</Badge>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          <span className="rounded-full bg-surface px-3 py-1">
            {totalConfirmed} confirmed rides
          </span>
          <span className="rounded-full bg-surface px-3 py-1">
            {totalSuggested} suggested rides
          </span>
          <span className="rounded-full bg-surface px-3 py-1">
            Suggested links are not history until you confirm them
          </span>
        </div>
      </header>

      <ErrorState
        variant="inline"
        show={coursesQuery.isError || uncoursedQuery.isError}
        message="Courses failed to load."
      />

      <section aria-label="Suggested course groups" className="mb-5">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Suggested course groups
            </h2>
            <p className="text-xs text-muted">
              Review-tier pairs from the cached similarity graph. Nothing is merged
              automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted">
              {scan?.finished_at
                ? `Scanned ${formatDate(scan.finished_at)}`
                : 'Not scanned yet'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => startScanMutation.mutate()}
              loading={startScanMutation.isPending || scanning}
              title="Recompute the similarity graph in the background"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {scanning
                ? 'Scanning…'
                : scan?.state === 'never'
                  ? 'Run scan'
                  : 'Refresh suggestions'}
            </Button>
            <Badge variant="muted">{suggestions.length} suggestions</Badge>
            {dismissed.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDismissed((v) => !v)}
              >
                {showDismissed ? 'Hide dismissed' : `Dismissed ${dismissed.length}`}
              </Button>
            )}
            {suggestions.length > 6 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAllSuggestions((v) => !v)}
              >
                {showAllSuggestions ? 'Show fewer' : `Show all ${suggestions.length}`}
              </Button>
            )}
          </div>
        </div>
        {scan?.state === 'failed' && (
          <p className="mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            The last scan failed: {scan.error || 'unknown error'}
          </p>
        )}
        {suggestionsQuery.isLoading ? (
          <Card className="p-4">
            <p className="text-sm text-muted">Loading suggestions…</p>
          </Card>
        ) : suggestions.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted">
              No similarity pairs waiting for review. Run the scan above after adding
              routes or changing the matcher.
            </p>
          </Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {visibleSuggestions.map((suggestion) => (
              <SuggestionCard
                key={`${suggestion.route_a_id}-${suggestion.route_b_id}`}
                suggestion={suggestion}
                busy={
                  mergeMutation.isPending &&
                  mergeMutation.variables?.sourceId === suggestion.route_b_course_id
                }
                dismissing={
                  dismissMutation.isPending &&
                  dismissMutation.variables?.routeBId === suggestion.route_b_id
                }
                onDismiss={() =>
                  dismissMutation.mutate({
                    routeAId: suggestion.route_a_id,
                    routeBId: suggestion.route_b_id,
                  })
                }
                onMerge={() => {
                  if (
                    !suggestion.route_a_course_id ||
                    !suggestion.route_b_course_id
                  ) {
                    return;
                  }
                  mergeMutation.mutate({
                    targetId: suggestion.route_a_course_id,
                    sourceId: suggestion.route_b_course_id,
                  });
                }}
              />
            ))}
          </div>
        )}
        {showDismissed && dismissed.length > 0 && (
          <Card className="mt-2 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Dismissed suggestions
            </h3>
            <p className="mt-1 text-[11px] text-muted">
              Restore one if the pair was dismissed by mistake; it will be proposed
              again on the next cache rebuild.
            </p>
            <div className="mt-2">
              {dismissed.map((suggestion) => (
                <DismissedSuggestionRow
                  key={`${suggestion.route_a_id}-${suggestion.route_b_id}`}
                  suggestion={suggestion}
                  busy={
                    restoreMutation.isPending &&
                    restoreMutation.variables?.routeBId === suggestion.route_b_id
                  }
                  onRestore={() =>
                    restoreMutation.mutate({
                      routeAId: suggestion.route_a_id,
                      routeBId: suggestion.route_b_id,
                    })
                  }
                />
              ))}
            </div>
          </Card>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section aria-label="Courses">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Your courses</h2>
            <div className="flex items-center gap-2">
              <input
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                placeholder="Filter courses…"
                className="h-9 w-40 rounded-lg border border-surface-light/60 bg-background px-3 text-xs text-foreground outline-none focus:border-accent"
                aria-label="Filter courses"
              />
              <span className="text-xs text-muted">
                {filteredCourses.length} of {courses.length}
              </span>
              {filteredCourses.length > 12 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowAllCourses((v) => !v)}
                >
                  {showAllCourses ? 'Show fewer' : `Show all ${filteredCourses.length}`}
                </Button>
              )}
            </div>
          </div>
          {coursesQuery.isLoading ? (
            <Card className="p-4">
              <p className="text-sm text-muted">Loading courses…</p>
            </Card>
          ) : courses.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-8 w-8 text-muted" />}
              title="No courses yet"
              description="Group routes from the uncoursed list below into your first course."
            />
          ) : filteredCourses.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-muted">
                No courses match “{courseFilter}”.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {visibleCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  active={course.id === activeCourse?.id}
                  onSelect={() => setSelectedCourseId(course.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Course detail">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Course detail</h2>
            {activeCourse && (
              <span className="text-xs text-muted">{activeCourse.name}</span>
            )}
          </div>
          {activeCourse && courses.length > 1 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                value={mergeSourceId}
                onChange={(e) => setMergeSourceId(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-surface-light/60 bg-background px-3 text-xs text-foreground outline-none focus:border-accent"
                aria-label="Course to merge into the selected course"
              >
                <option value="">Merge another course into this one…</option>
                {courses
                  .filter((c) => c.id !== activeCourse.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.route_count} variants)
                    </option>
                  ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                disabled={!mergeSourceId}
                loading={mergeMutation.isPending}
                onClick={() => {
                  if (!mergeSourceId) return;
                  mergeMutation.mutate({
                    targetId: activeCourse.id,
                    sourceId: mergeSourceId,
                  });
                }}
              >
                Merge
              </Button>
            </div>
          )}
          <CourseDetailPanel
            detail={detailQuery.data}
            loading={detailQuery.isLoading && !!activeCourse}
            onUngroup={(routeId) => {
              if (!activeCourse) return;
              ungroupMutation.mutate({ courseId: activeCourse.id, routeId });
            }}
            onLink={(activityId, status) =>
              linkMutation.mutate({ activityId, status })
            }
            onRename={(name) => renameMutation.mutate(name)}
            busyRouteId={busyRouteId}
            busyActivityId={busyActivityId}
            renaming={renameMutation.isPending}
          />
        </section>
      </div>

      <section aria-label="Uncoursed routes" className="mt-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Uncoursed routes</h2>
            <p className="text-xs text-muted">
              Select routes to create a course, or add one to the course selected above.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={uncoursedFilter}
              onChange={(e) => setUncoursedFilter(e.target.value)}
              placeholder="Filter routes…"
              className="h-9 w-44 rounded-lg border border-surface-light/60 bg-background px-3 text-xs text-foreground outline-none focus:border-accent"
              aria-label="Filter uncoursed routes"
            />
            <span className="text-xs text-muted">
              {filteredUncoursed.length} of {uncoursed.length}
            </span>
            {filteredUncoursed.length > 18 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAllUncoursed((v) => !v)}
              >
                {showAllUncoursed ? 'Show fewer' : `Show all ${filteredUncoursed.length}`}
              </Button>
            )}
          </div>
        </div>

        {uncoursedQuery.isLoading ? (
          <Card className="p-4">
            <p className="text-sm text-muted">Loading routes…</p>
          </Card>
        ) : uncoursed.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted">
              Every route belongs to a course. Nothing to group.
            </p>
          </Card>
        ) : filteredUncoursed.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted">
              No uncoursed routes match “{uncoursedFilter}”.
            </p>
          </Card>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {visibleUncoursed.map((route) => {
                const checked = selectedRouteIds.has(route.id);
                return (
                  <div
                    key={route.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 ${
                      checked
                        ? 'border-accent/60 bg-accent/5'
                        : 'border-surface-light/60 bg-surface'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRoute(route.id)}
                      aria-label={`Select ${route.name}`}
                      className="h-4 w-4 shrink-0"
                    />
                    <RouteShape
                      encoded={route.preview_polyline}
                      width={58}
                      height={42}
                      className="shrink-0 text-muted"
                      strokeWidth={2}
                      showEndpoints={false}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{route.name}</p>
                      <p className="text-[11px] text-muted">
                        {formatKm(route.distance_meters)}
                        {route.suggested_ride_count > 0
                          ? ` · ${route.suggested_ride_count} suggested rides`
                          : ''}
                      </p>
                    </div>
                    {activeCourse && (
                      <Button
                        variant="tinted"
                        size="sm"
                        onClick={() =>
                          groupMutation.mutate({
                            courseId: activeCourse.id,
                            routeId: route.id,
                          })
                        }
                        loading={busyRouteId === route.id}
                        title={`Add to ${activeCourse.name}`}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Add
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <Card className="mt-3 p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-xs font-medium text-muted">
                    New course name
                  </span>
                  <input
                    value={newCourseName}
                    onChange={(e) => setNewCourseName(e.target.value)}
                    placeholder="e.g. Queensferry loop"
                    className="h-11 w-full rounded-lg border border-surface-light/60 bg-background px-3 text-sm text-foreground outline-none focus:border-accent"
                  />
                </label>
                <Button
                  onClick={() => createMutation.mutate()}
                  loading={createMutation.isPending}
                  disabled={!newCourseName.trim() || selectedRouteIds.size === 0}
                >
                  <FolderPlus className="h-4 w-4" aria-hidden />
                  Create course with {selectedRouteIds.size}{' '}
                  {selectedRouteIds.size === 1 ? 'route' : 'routes'}
                </Button>
              </div>
            </Card>
          </>
        )}
      </section>

      <p className="mt-6 flex items-center gap-2 text-xs text-muted">
        <Link2 className="h-4 w-4" aria-hidden />
        Grouping is audited in <code>course_link_log</code>; a route can be ungrouped
        without losing its geometry or rides.
        <RouteIcon className="ml-auto h-4 w-4" aria-hidden />
      </p>
    </main>
  );
}
