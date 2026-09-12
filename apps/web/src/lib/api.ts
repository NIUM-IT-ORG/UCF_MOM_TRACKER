import type { SessionUser } from '@mom/shared';

/**
 * One place that knows how to talk to the API.
 *
 * Every response is the documented envelope — `{ data }` or
 * `{ error: { code, message } }` — so this unwraps it once and throws an
 * `ApiError` carrying the code. Screens then branch on a code, never on a
 * message, and a reworded message never breaks a screen.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Browser-side base. Requests go through Next's rewrite, so cookies are first-party. */
const BROWSER_BASE = '/api/v1';

function serverBase(): string {
  return `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
}

export async function api<T>(
  path: string,
  init: RequestInit & { server?: boolean } = {},
): Promise<T> {
  const { server, ...rest } = init;
  const base = server ? serverBase() : BROWSER_BASE;

  const res = await fetch(`${base}${path}`, {
    ...rest,
    // Cookies are httpOnly, so they have to be sent explicitly on the client.
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(rest.headers ?? {}),
    },
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string; details?: unknown } })?.error;
    throw new ApiError(
      err?.code ?? 'INTERNAL',
      err?.message ?? `Request failed (${res.status}).`,
      res.status,
      err?.details,
    );
  }

  return (body as { data: T }).data;
}

export const authApi = {
  login: (email: string, password: string) =>
    api<{ challengeId: string; devOtp?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  verifyOtp: (challengeId: string, otp: string) =>
    api<SessionUser>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ challengeId, otp }),
    }),

  logout: () => api<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: () => api<SessionUser>('/auth/me'),
};
