import { apiFetch } from './fetch';
import type { Event, CreateEventPayload, UpdateEventPayload } from './types';

export async function getEvents(upcomingOnly: boolean = false): Promise<Event[]> {
  const query = upcomingOnly ? '?upcoming_only=true' : '';
  return apiFetch<Event[]>(`/api/v1/events${query}`);
}

export async function getEvent(id: string): Promise<Event> {
  return apiFetch<Event>(`/api/v1/events/${id}`);
}

export async function createEvent(payload: CreateEventPayload): Promise<Event> {
  return apiFetch<Event>('/api/v1/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEvent(id: string, payload: UpdateEventPayload): Promise<Event> {
  return apiFetch<Event>(`/api/v1/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteEvent(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/events/${id}`, {
    method: 'DELETE',
  });
}
