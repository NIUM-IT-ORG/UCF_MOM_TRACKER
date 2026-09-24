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
    /** On the response header and in the body — quote it in a bug report. */
    readonly requestId?: string,
    /** One line naming the fault. Development builds only. */
    readonly fault?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * What to put on the screen.
   *
   * A 500 is the only case where the message alone is useless, so that is the
   * only case where the reference and the cause are appended. Everything else
   * already says what the officer did wrong and how to fix it.
   */
  get display(): string {
    if (this.status < 500) return this.message;
    const parts = [this.message];
    if (this.fault) parts.push(this.fault);
    if (this.requestId) parts.push(`Reference ${this.requestId}`);
    return parts.join(' · ');
  }
}

/** Browser-side base. Requests go through Next's rewrite, so cookies are first-party. */
const BROWSER_BASE = '/api/v1';

function serverBase(): string {
  return `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
}

/**
 * The refresh in flight, if there is one.
 *
 * Single-flight is not a nicety here, it is the whole thing. Refresh tokens
 * rotate, and `auth.service.ts` treats a token presented twice as a leak: it
 * revokes the **entire session family** and writes REFRESH_REUSE_DETECTED.
 * The meeting page alone fires four requests through `Promise.all`, so a
 * naive "refresh on 401" would send four, three of which look exactly like
 * replay — turning an expired access token into a hard sign-out, which is
 * worse than the bug it set out to fix.
 *
 * So every caller that meets a 401 waits on the same promise, and exactly one
 * rotation happens.
 */
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BROWSER_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
  })
    .then((r) => r.ok)
    // A refused or unreachable refresh is simply "no longer signed in"; the
    // original 401 is what the caller gets told about.
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Endpoints that must never trigger a refresh.
 *
 * `/auth/refresh` would recurse. The others are how a session is established
 * in the first place: a 401 from them means the credentials were wrong, and
 * rotating a cookie in response would be nonsense.
 */
const NO_REFRESH = ['/auth/refresh', '/auth/login', '/auth/verify-otp', '/auth/logout'];

export async function api<T>(
  path: string,
  init: RequestInit & { server?: boolean } = {},
): Promise<T> {
  const { server, ...rest } = init;
  const base = server ? serverBase() : BROWSER_BASE;

  const send = () =>
    fetch(`${base}${path}`, {
      ...rest,
      // Cookies are httpOnly, so they have to be sent explicitly on the client.
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(rest.headers ?? {}),
      },
    });

  let res = await send();

  /*
   * An expired access token is not the end of a session.
   *
   * The access token lives fifteen minutes and the refresh token thirty days,
   * and nothing was spending the second to renew the first — so a coordinator
   * who spent a quarter of an hour writing minutes was signed out by their
   * own next click. One rotation, one retry, and the request goes through.
   *
   * Retrying is safe because every body this client sends is a JSON string,
   * so it can be replayed verbatim. A streamed body could not be.
   */
  if (
    res.status === 401 &&
    !server &&
    !NO_REFRESH.some((p) => path === p || path.startsWith(`${p}?`))
  ) {
    if (await refreshSession()) res = await send();
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (
      body as {
        error?: {
          code: string;
          message: string;
          details?: unknown;
          requestId?: string;
          fault?: string;
        };
      }
    )?.error;
    throw new ApiError(
      err?.code ?? 'INTERNAL',
      err?.message ?? `Request failed (${res.status}).`,
      res.status,
      err?.details,
      err?.requestId ?? res.headers.get('x-request-id') ?? undefined,
      err?.fault,
    );
  }

  return (body as { data: T }).data;
}

export const authApi = {
  /**
   * The password step — and the whole of signing in when the deployment has
   * no second factor configured.
   *
   * The response says which happened rather than leaving the caller to infer
   * it from a field being present: with `otpRequired: false` the cookies are
   * already set and there is nothing further to do.
   */
  login: (email: string, password: string) =>
    api<
      | { otpRequired: true; challengeId: string; devOtp?: string }
      | { otpRequired: false; user: SessionUser }
    >('/auth/login', {
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
