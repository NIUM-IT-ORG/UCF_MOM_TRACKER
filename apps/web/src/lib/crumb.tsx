'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * The last segment of the breadcrumb, supplied by a detail screen.
 *
 * The first two segments are derived from the route, which is what stops the
 * breadcrumb ever disagreeing with the page. A record's name cannot be derived
 * that way — `/projects/clx…` is not readable — so the screen that has already
 * loaded the record hands it over here. Phase 3 onwards has several of these
 * (a meeting, a MoM, an item), which is why it is a context rather than a prop
 * threaded through the shell.
 */
const CrumbTail = createContext<{
  tail: string | null;
  setTail: (v: string | null) => void;
}>({ tail: null, setTail: () => {} });

export function CrumbProvider({ children }: { children: React.ReactNode }) {
  const [tail, setTail] = useState<string | null>(null);
  return <CrumbTail.Provider value={{ tail, setTail }}>{children}</CrumbTail.Provider>;
}

export function useCrumbTail(): string | null {
  return useContext(CrumbTail).tail;
}

/**
 * Sets the tail while the screen is mounted and clears it on the way out, so a
 * stale record name can never linger over the next page.
 */
export function useSetCrumbTail(value: string | null | undefined): void {
  const { setTail } = useContext(CrumbTail);
  useEffect(() => {
    setTail(value ?? null);
    return () => setTail(null);
  }, [value, setTail]);
}
