import { describe, expect, it } from 'vitest';
import {
  lockoutMessage,
  unknownCapabilities,
  wouldLockEverybodyOut,
  type DesignationRow,
} from './lockout.js';

/**
 * The matrix is editable now, which means it is possible to edit away the
 * ability to edit it. These are the combinations that decide whether the guard
 * is right — none of them need a database, and all of them have been got wrong
 * in some system or other.
 */
const SYS: DesignationRow = {
  id: 'd-sys',
  code: 'SYS',
  caps: ['manage_masters', 'manage_access', 'view_all_projects'],
  activeUsers: 1,
};
const MD: DesignationRow = {
  id: 'd-md',
  code: 'MD',
  caps: ['approve_mom', 'view_all_projects'],
  activeUsers: 1,
};
const EXT: DesignationRow = {
  id: 'd-ext',
  code: 'EXT',
  caps: [],
  activeUsers: 0,
};

describe('a designation edit cannot lock everybody out', () => {
  it('refuses to take the last manage_masters away', () => {
    const lost = wouldLockEverybodyOut([SYS, MD], { id: 'd-sys', caps: ['view_all_projects'] });
    expect(lost).toEqual(['manage_masters', 'manage_access']);
  });

  it('allows it when another designation already holds both, with an active officer', () => {
    const deputy: DesignationRow = {
      id: 'd-dep',
      code: 'DEP',
      caps: ['manage_masters', 'manage_access'],
      activeUsers: 1,
    };
    expect(wouldLockEverybodyOut([SYS, deputy, MD], { id: 'd-sys', caps: [] })).toEqual([]);
  });

  it('does not count a designation nobody active holds', () => {
    // The capability exists on paper, but only on a designation whose only
    // officers are invite-only and cannot sign in to use it.
    const paper: DesignationRow = {
      id: 'd-paper',
      code: 'PAPER',
      caps: ['manage_masters', 'manage_access'],
      activeUsers: 0,
    };
    expect(wouldLockEverybodyOut([SYS, paper], { id: 'd-sys', caps: [] })).toEqual([
      'manage_masters',
      'manage_access',
    ]);
  });

  it('names only the capability actually lost', () => {
    const access: DesignationRow = {
      id: 'd-acc',
      code: 'ACC',
      caps: ['manage_access'],
      activeUsers: 2,
    };
    expect(wouldLockEverybodyOut([SYS, access], { id: 'd-sys', caps: [] })).toEqual([
      'manage_masters',
    ]);
  });

  it('lets an unrelated designation be edited freely', () => {
    expect(wouldLockEverybodyOut([SYS, MD], { id: 'd-md', caps: ['approve_mom'] })).toEqual([]);
  });

  it('treats retiring a designation as losing everything it held', () => {
    expect(wouldLockEverybodyOut([SYS, MD], { id: 'd-sys', caps: [], retired: true })).toEqual([
      'manage_masters',
      'manage_access',
    ]);
  });

  it('allows a new designation: it cannot take anything away', () => {
    expect(
      wouldLockEverybodyOut([SYS, MD, EXT], { id: 'd-new', caps: ['record_minutes'] }),
    ).toEqual([]);
  });

  it('a new designation carrying the capability does not yet rescue it', () => {
    // Nobody holds the new designation the instant it is created, so it cannot
    // be the reason it is safe to strip SYS in the same breath. It cannot be,
    // anyway — one change at a time.
    const lost = wouldLockEverybodyOut([{ ...SYS, caps: [] }, MD], {
      id: 'd-new',
      caps: ['manage_masters', 'manage_access'],
    });
    expect(lost).toEqual(['manage_masters', 'manage_access']);
  });
});

describe('capabilities have to be real', () => {
  it('passes the documented ones', () => {
    expect(unknownCapabilities(['record_minutes', 'approve_mom'])).toEqual([]);
  });

  it('catches a typo rather than storing it', () => {
    expect(unknownCapabilities(['record_minutes', 'aprove_mom'])).toEqual(['aprove_mom']);
  });
});

describe('the refusal says what to do about it', () => {
  it('names the capability in the officer’s language, not the key', () => {
    const message = lockoutMessage(['manage_masters']);
    expect(message).toContain('Manage master data');
    expect(message).not.toContain('manage_masters');
    expect(message).toMatch(/Give it to another designation first/);
  });
});
