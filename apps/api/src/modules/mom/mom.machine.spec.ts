import { describe, expect, it } from 'vitest';
import type { MomState } from '@mom/shared';
import {
  MOM_TRANSITIONS,
  advanceMom,
  assertMaySign,
  assertMutable,
  minutesLockedIn,
  nextMomState,
  submitEventFor,
  versionAfter,
} from './mom.machine.js';

const EXPECTED: [MomState, string, MomState][] = [
  ['NOT_GENERATED', 'generate', 'DRAFT'],
  ['DRAFT', 'submit', 'SUBMITTED'],
  ['SUBMITTED', 'return', 'RETURNED'],
  ['SUBMITTED', 'reject', 'DRAFT'],
  ['SUBMITTED', 'approve', 'APPROVED'],
  ['RETURNED', 'resubmit', 'SUBMITTED'],
  ['APPROVED', 'sign', 'SIGNED'],
];

describe('the MoM machine', () => {
  it.each(EXPECTED)('%s --%s--> %s', (from, event, to) => {
    expect(nextMomState(from, event as never)).toBe(to);
  });

  it('has exactly the listed transitions and no others', () => {
    expect(MOM_TRANSITIONS).toHaveLength(EXPECTED.length);
  });

  it('has no transition out of SIGNED at all', () => {
    // This absence *is* the immutability rule. A circulated MoM is corrected by
    // a new document, never by changing the one people have already read.
    for (const event of ['generate', 'submit', 'return', 'reject', 'approve', 'resubmit', 'sign']) {
      expect(nextMomState('SIGNED', event as never)).toBeUndefined();
    }
  });

  it('cannot be approved without being submitted first', () => {
    expect(nextMomState('DRAFT', 'approve')).toBeUndefined();
    expect(nextMomState('RETURNED', 'approve')).toBeUndefined();
  });

  it('cannot be signed before it is approved', () => {
    expect(nextMomState('SUBMITTED', 'sign')).toBeUndefined();
    expect(nextMomState('DRAFT', 'sign')).toBeUndefined();
  });

  it('cannot be generated twice', () => {
    expect(nextMomState('DRAFT', 'generate')).toBeUndefined();
  });

  it('throws INVALID_TRANSITION with both ends named', () => {
    expect(() => advanceMom('DRAFT', 'approve')).toThrowError(/Cannot move from DRAFT to approve/);
  });
});

describe('returning and rejecting differ, on purpose', () => {
  it('returns to RETURNED, and a resubmission advances the version', () => {
    expect(advanceMom('SUBMITTED', 'return')).toBe('RETURNED');
    expect(submitEventFor('RETURNED')).toBe('resubmit');
    expect(versionAfter('RETURNED', 3)).toBe(4);
  });

  it('rejects back to DRAFT, and the version stays', () => {
    // Nothing was accepted as a version, so nothing is numbered.
    expect(advanceMom('SUBMITTED', 'reject')).toBe('DRAFT');
    expect(submitEventFor('DRAFT')).toBe('submit');
    expect(versionAfter('DRAFT', 3)).toBe(3);
  });
});

describe('immutability', () => {
  it('refuses to let a circulated MoM be changed, and says what to do instead', () => {
    expect(() => assertMutable('SIGNED')).toThrowError(/corrigendum/);
  });

  it('allows every other state through', () => {
    for (const s of ['NOT_GENERATED', 'DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] as MomState[]) {
      expect(() => assertMutable(s)).not.toThrow();
    }
  });
});

describe('the minutes lock', () => {
  it('locks from submission onward — the text must not move under an approver', () => {
    expect(minutesLockedIn('SUBMITTED')).toBe(true);
    expect(minutesLockedIn('APPROVED')).toBe(true);
    expect(minutesLockedIn('SIGNED')).toBe(true);
  });

  it('is open while the coordinator still has it', () => {
    expect(minutesLockedIn('NOT_GENERATED')).toBe(false);
    expect(minutesLockedIn('DRAFT')).toBe(false);
    // Returned means it is back with the coordinator to act on the remark, so
    // it has to be editable again — otherwise the remark cannot be answered.
    expect(minutesLockedIn('RETURNED')).toBe(false);
  });
});

describe('the full journey the demo walks', () => {
  it('runs generate → submit → return → resubmit → approve → sign', () => {
    let state: MomState = 'NOT_GENERATED';
    let version = 1;

    state = advanceMom(state, 'generate');
    expect(state).toBe('DRAFT');

    state = advanceMom(state, submitEventFor(state));
    expect(state).toBe('SUBMITTED');

    state = advanceMom(state, 'return');
    expect(state).toBe('RETURNED');
    expect(minutesLockedIn(state)).toBe(false);

    version = versionAfter(state, version);
    state = advanceMom(state, submitEventFor('RETURNED'));
    expect(state).toBe('SUBMITTED');
    expect(version).toBe(2);

    state = advanceMom(state, 'approve');
    expect(state).toBe('APPROVED');

    state = advanceMom(state, 'sign');
    expect(state).toBe('SIGNED');
    expect(() => assertMutable(state)).toThrow();
  });
});

describe('who may sign', () => {
  /*
   * The rule the whole chain rests on: the Project Coordinator nominates one
   * executive at approval, and only that officer can sign. Holding `sign_mom`
   * is necessary and never sufficient — otherwise the routing step would be
   * advisory and the Mission Director could sign anything at any time, which
   * is exactly the control the client asked for.
   */
  const routedToAmd = { signatoryId: 'u-amd', userId: 'u-amd', canSign: true };

  it('lets the officer it was routed to sign', () => {
    expect(() => assertMaySign('APPROVED', routedToAmd)).not.toThrow();
  });

  it('refuses another executive, even one who holds sign_mom', () => {
    expect(() =>
      assertMaySign('APPROVED', { signatoryId: 'u-amd', userId: 'u-md', canSign: true }),
    ).toThrowError(/routed to a different officer/);
  });

  it('says so plainly rather than pretending the MoM is not there', () => {
    // A 404 is right when the officer should not know the thing exists. Here
    // they are looking straight at it, and "not found" would be a lie that
    // generates a support call.
    try {
      assertMaySign('APPROVED', { signatoryId: 'u-amd', userId: 'u-md', canSign: true });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('NOT_YOUR_SIGNATURE');
    }
  });

  it('refuses before approval, whoever is asking', () => {
    for (const state of ['NOT_GENERATED', 'DRAFT', 'SUBMITTED', 'RETURNED'] as MomState[]) {
      expect(() => assertMaySign(state, routedToAmd)).toThrowError(/Cannot move from/);
    }
  });

  it('refuses to sign twice', () => {
    expect(() => assertMaySign('SIGNED', routedToAmd)).toThrowError(/Cannot move from/);
  });

  it('explains a MoM approved before routing existed, rather than throwing a null', () => {
    expect(() =>
      assertMaySign('APPROVED', { signatoryId: null, userId: 'u-md', canSign: true }),
    ).toThrowError(/without a signing officer being chosen/);
  });

  it('refuses a nominee whose designation has since lost the authority', () => {
    expect(() =>
      assertMaySign('APPROVED', { signatoryId: 'u-amd', userId: 'u-amd', canSign: false }),
    ).toThrowError(/no longer carries the authority/);
  });
});
