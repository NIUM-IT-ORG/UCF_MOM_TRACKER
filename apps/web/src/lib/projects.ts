'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Every project this officer may choose from.
 *
 * `user.projects` is the *explicitly mapped* list, and the schema is
 * deliberate that "a user with seesAllProjects = true needs no rows here" —
 * so reading it alone gives an empty picker to precisely the people who see
 * everything. That bug was fixed once on the meeting form and was still
 * sitting in the meetings filter, which is why it lives here now: one
 * definition, so there is no third place for it to come back.
 *
 * The two lists are merged rather than swapped, so a head-office officer who
 * also happens to be mapped somewhere never loses that project while
 * `/projects` is still loading. `/projects` is scoped server-side, so this
 * cannot widen anybody's reach — it only stops a picker being narrower than
 * the caller's own scope.
 */
export function useProjectOptions(): { projects: ProjectOption[]; loading: boolean } {
  const { user, caps } = useSession();
  const seesAll = Boolean(user?.seesAllProjects) || caps.includes('view_all_projects');
  const [all, setAll] = useState<ProjectOption[] | null>(null);

  useEffect(() => {
    if (!seesAll) return;
    let live = true;
    api<ProjectOption[]>('/projects')
      .then((rows) => live && setAll(rows))
      .catch(() => live && setAll([]));
    return () => {
      live = false;
    };
  }, [seesAll]);

  const merged = dedupe([...(user?.projects ?? []), ...(all ?? [])]);
  return { projects: merged, loading: seesAll && all === null };
}

/** By id, keeping the first occurrence, then ordered by code as the API does. */
function dedupe(rows: ProjectOption[]): ProjectOption[] {
  const seen = new Map<string, ProjectOption>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}
