/**
 * Auth helpers — all platform API calls include credentials (cookie).
 * On 401, callers should redirect to /login.
 */

export const BASE = '/api';

/** fetch wrapper that always includes credentials so signed cookie is sent */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' });
}
