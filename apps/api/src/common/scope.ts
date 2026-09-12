import type { AuthUser } from '../modules/auth/auth-user.js';

/**
 * Project scoping — the second half of the access rule.
 *
 * Capability says what an officer may do; scope says which rows those powers
 * reach. These helpers belong in the repository layer, not the controller and
 * never the UI: a finder that can return rows outside the caller's projects is
 * a security defect, and a filter applied in a controller is one refactor away
 * from being forgotten.
 *
 * Note what a scope failure returns: 404, never 403. An officer must not be
 * able to discover that a meeting exists on a project they cannot see by
 * probing ids and reading the difference in the status code.
 */

/** True when this caller sees everything and needs no filter at all. */
export function seesAll(user: AuthUser): boolean {
  return user.seesAllProjects || user.caps.includes('view_all_projects');
}

/** The caller's project ids, or null meaning "no restriction". */
export function scopedProjectIds(user: AuthUser): string[] | null {
  return seesAll(user) ? null : user.projectIds;
}

/** `where` fragment for anything with a direct `projectId`. */
export function projectScope(user: AuthUser): { projectId?: { in: string[] } } {
  const ids = scopedProjectIds(user);
  return ids === null ? {} : { projectId: { in: ids } };
}

/** `where` fragment for the projects table itself. */
export function projectIdScope(user: AuthUser): { id?: { in: string[] } } {
  const ids = scopedProjectIds(user);
  return ids === null ? {} : { id: { in: ids } };
}

/**
 * `where` fragment for meetings, which cover one or more projects. A meeting is
 * visible when any one of its projects is in scope.
 */
export function meetingScope(user: AuthUser): {
  projects?: { some: { projectId: { in: string[] } } };
} {
  const ids = scopedProjectIds(user);
  return ids === null ? {} : { projects: { some: { projectId: { in: ids } } } };
}

/**
 * `where` fragment for the people picker.
 *
 * This is the one that matters for sharing: you cannot share with someone you
 * cannot see. Officers mapped to a project in scope, plus the people who see
 * every project anyway — head office is visible to everyone, since they turn
 * up in every meeting.
 */
export function visibleUsersScope(user: AuthUser): Record<string, unknown> {
  const ids = scopedProjectIds(user);
  if (ids === null) return {};
  return {
    OR: [
      { projects: { some: { projectId: { in: ids } } } },
      { seesAllProjects: true },
      { id: user.id },
    ],
  };
}

/** True when the caller may see this project. */
export function canSeeProject(user: AuthUser, projectId: string): boolean {
  const ids = scopedProjectIds(user);
  return ids === null || ids.includes(projectId);
}
