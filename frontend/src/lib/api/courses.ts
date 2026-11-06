import { apiFetch } from './fetch';
import type {
  CourseCreatePayload,
  CourseDetail,
  CourseMergeCandidate,
  CourseRoute,
  CourseSuggestion,
  CourseSummary,
  DismissedCourseSuggestion,
  RideLinkResult,
} from './types';

export async function getCourses(token?: string): Promise<CourseSummary[]> {
  return apiFetch<CourseSummary[]>('/api/v1/courses', {}, token);
}

export async function getCourse(id: string, token?: string): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(`/api/v1/courses/${id}`, {}, token);
}

export async function updateCourse(
  id: string,
  payload: { name?: string; sport_type?: string },
  token?: string,
): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(
    `/api/v1/courses/${id}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export async function getUncoursedRoutes(token?: string): Promise<CourseRoute[]> {
  return apiFetch<CourseRoute[]>('/api/v1/courses/uncoursed', {}, token);
}

export async function getCourseMergeCandidates(
  token?: string,
): Promise<CourseMergeCandidate[]> {
  return apiFetch<CourseMergeCandidate[]>(
    '/api/v1/courses/merge-candidates',
    {},
    token,
  );
}

export async function getCourseSuggestions(
  token?: string,
  limit = 50,
): Promise<CourseSuggestion[]> {
  return apiFetch<CourseSuggestion[]>(
    `/api/v1/courses/suggestions?limit=${limit}`,
    {},
    token,
  );
}

export async function createCourse(
  payload: CourseCreatePayload,
  token?: string,
): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(
    '/api/v1/courses',
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export async function groupRoute(
  courseId: string,
  routeId: string,
  token?: string,
): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(
    `/api/v1/courses/${courseId}/routes/${routeId}`,
    { method: 'POST' },
    token,
  );
}

export async function ungroupRoute(
  courseId: string,
  routeId: string,
  token?: string,
): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(
    `/api/v1/courses/${courseId}/routes/${routeId}`,
    { method: 'DELETE' },
    token,
  );
}

export async function getDismissedCourseSuggestions(
  token?: string,
): Promise<DismissedCourseSuggestion[]> {
  return apiFetch<DismissedCourseSuggestion[]>(
    '/api/v1/courses/suggestions/dismissed',
    {},
    token,
  );
}

export async function dismissCourseSuggestion(
  routeAId: string,
  routeBId: string,
  token?: string,
): Promise<{ dismissed: boolean }> {
  return apiFetch<{ dismissed: boolean }>(
    `/api/v1/courses/suggestions/${routeAId}/${routeBId}/dismiss`,
    { method: 'POST' },
    token,
  );
}

export async function restoreCourseSuggestion(
  routeAId: string,
  routeBId: string,
  token?: string,
): Promise<{ restored: boolean }> {
  return apiFetch<{ restored: boolean }>(
    `/api/v1/courses/suggestions/${routeAId}/${routeBId}/dismiss`,
    { method: 'DELETE' },
    token,
  );
}

export async function mergeCourse(
  targetCourseId: string,
  sourceCourseId: string,
  token?: string,
): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(
    `/api/v1/courses/${targetCourseId}/merge/${sourceCourseId}`,
    { method: 'POST' },
    token,
  );
}

export async function confirmRideLink(
  activityId: string,
  token?: string,
): Promise<RideLinkResult> {
  return apiFetch<RideLinkResult>(
    `/api/v1/courses/ride-links/${activityId}/confirm`,
    { method: 'POST' },
    token,
  );
}

export async function rejectRideLink(
  activityId: string,
  token?: string,
): Promise<RideLinkResult> {
  return apiFetch<RideLinkResult>(
    `/api/v1/courses/ride-links/${activityId}/reject`,
    { method: 'POST' },
    token,
  );
}
