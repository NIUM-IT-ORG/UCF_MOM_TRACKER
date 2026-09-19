import { describe, expect, it } from 'vitest';
import {
  canSeeProject,
  meetingScope,
  projectIdScope,
  projectScope,
  scopedProjectIds,
  seesAll,
  visibleUsersScope,
} from './scope.js';
import type { AuthUser } from '../modules/auth/auth-user.js';

const coordinator: AuthUser = {
  id: 'u4',
  name: 'Officer D',
  email: 'officer.d@example.gov',
  designationCode: 'MC',
  designationName: 'Meeting Coordinator',
  caps: ['plan_instant', 'record_minutes', 'share_object'],
  projectIds: ['P1'],
  seesAllProjects: false,
};

const director: AuthUser = {
  id: 'u1',
  name: 'Officer A',
  email: 'officer.a@example.gov',
  designationCode: 'MD',
  designationName: 'Mission Director',
  caps: ['sign_mom', 'view_all_projects', 'share_object'],
  projectIds: [],
  seesAllProjects: true,
};

const stranded: AuthUser = { ...coordinator, id: 'u99', projectIds: [] };

describe('project scoping', () => {
  it('does not filter for someone who sees every project', () => {
    expect(seesAll(director)).toBe(true);
    expect(scopedProjectIds(director)).toBeNull();
    expect(projectScope(director)).toEqual({});
    expect(meetingScope(director)).toEqual({});
  });

  it('filters to the mapped projects for everyone else', () => {
    expect(seesAll(coordinator)).toBe(false);
    expect(projectScope(coordinator)).toEqual({ projectId: { in: ['P1'] } });
    expect(projectIdScope(coordinator)).toEqual({ id: { in: ['P1'] } });
  });

  it('treats view_all_projects as equivalent to the flag', () => {
    const cdma: AuthUser = { ...coordinator, caps: ['view_all_projects'], projectIds: [] };
    expect(seesAll(cdma)).toBe(true);
    expect(projectScope(cdma)).toEqual({});
  });

  it('sees a meeting when any one of its projects is in scope', () => {
    expect(meetingScope(coordinator)).toEqual({
      projects: { some: { projectId: { in: ['P1'] } } },
    });
  });

  it('gives an unmapped officer an empty filter, not an absent one', () => {
    // The distinction that matters: `{ in: [] }` matches nothing, `{}` matches
    // everything. Getting this backwards would show every project to someone
    // mapped to none.
    expect(projectScope(stranded)).toEqual({ projectId: { in: [] } });
    expect(canSeeProject(stranded, 'P1')).toBe(false);
  });

  it('answers canSeeProject per project', () => {
    expect(canSeeProject(coordinator, 'P1')).toBe(true);
    expect(canSeeProject(coordinator, 'P2')).toBe(false);
    expect(canSeeProject(director, 'P2')).toBe(true);
  });

  describe('the people picker - you cannot share with someone you cannot see', () => {
    it('is unfiltered for someone who sees everything', () => {
      expect(visibleUsersScope(director)).toEqual({});
    });

    it('covers project colleagues, head office, and yourself', () => {
      expect(visibleUsersScope(coordinator)).toEqual({
        OR: [
          { projects: { some: { projectId: { in: ['P1'] } } } },
          { seesAllProjects: true },
          { id: 'u4' },
        ],
      });
    });

    it('still lets an unmapped officer see themselves', () => {
      const scope = visibleUsersScope(stranded) as { OR: Record<string, unknown>[] };
      expect(scope.OR).toContainEqual({ id: 'u99' });
    });
  });
});
