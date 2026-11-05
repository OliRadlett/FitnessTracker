import { apiFetch } from './fetch';
import type {
  CourseCreatePayload,
  CourseDetail,
  CourseRoute,
  CourseSummary,
  RideLinkResult,
} from './types';

export async function getCourses(token?: string): Promise<CourseSummary[]> {
  return apiFetch<CourseSummary[]>('/api/v1/courses', {}, token);
}

export async function getCourse(id: string, token?: string): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(`/api/v1/courses/${id}`, {}, token);
}

export async function getUncoursedRoutes(token?: string): Promise<CourseRoute[]> {
  return apiFetch<CourseRoute[]>('/api/v1/courses/uncoursed', {}, token);
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
