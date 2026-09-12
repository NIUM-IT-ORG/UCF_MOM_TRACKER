'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Capability, SessionUser } from '@mom/shared';
import { ApiError, authApi } from './api';

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  caps: Capability[];
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Holds the signed-in officer, fetched from `/auth/me`.
 *
 * The capability list comes from the server every time it is fetched — the
 * client never computes permissions and never trusts a stored copy. This is
 * only for deciding what to render; every one of these checks is made again on
 * the server, where it actually matters.
 */
export function SessionProvider({
  initialUser,
  children,
}: {
  initialUser: SessionUser | null;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await authApi.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
    router.push('/login');
    router.refresh();
  }, [router]);

  /*
   * Adopt the server's answer whenever it changes.
   *
   * `useState(initialUser)` takes the prop once and then ignores it. The
   * provider lives in the root layout and is not remounted by client-side
   * navigation, so after signing in - which re-runs the server layout with a
   * cookie this time - the new user would never reach this state, and the top
   * bar would sit there saying "Sign in" while /auth/me happily returned 200.
   */
  useEffect(() => {
    if (initialUser) setUser(initialUser);
  }, [initialUser]);

  // Pick up a session established in another tab, or dropped in this one.
  // Not on the sign-in page: there is no session there by definition, and
  // asking produces a 401 in the console on every visit.
  useEffect(() => {
    if (!initialUser && pathname !== '/login') void refresh();
  }, [initialUser, pathname, refresh]);

  return (
    <SessionContext.Provider
      value={{ user, loading, caps: (user?.caps ?? []) as Capability[], refresh, signOut }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession used outside SessionProvider');
  return ctx;
}
