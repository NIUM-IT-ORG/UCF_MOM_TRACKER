import { describe, expect, it } from 'vitest';
import type { ActionStatus, ClarificationStatus } from '@mom/shared';
import {
  ACTION_TRANSITIONS,
  CLARIFICATION_TRANSITIONS,
  advanceAction,
  advanceClarification,
  daysOverdue,
  nextActionStatus,
  nextClarificationStatus,
  shouldMarkDelayed,
} from './item.machine.js';
import { DEFAULT_CONFIRMERS, designationsFor, mayConfirm } from './confirmation.policy.js';

const ACTION_EXPECTED: [ActionStatus | null, string, ActionStatus][] = [
  [null, 'activate', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'markDelayed', 'DELAYED'],
  ['DELAYED', 'reviseDue', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'reportComplete', 'UNDER_REVIEW'],
  ['DELAYED', 'reportComplete', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'confirm', 'COMPLETED'],
  ['UNDER_REVIEW', 'sendBack', 'IN_PROGRESS'],
  ['COMPLETED', 'reopen', 'IN_PROGRESS'],
];

const CLARIFICATION_EXPECTED: [ClarificationStatus | null, string, ClarificationStatus][] = [
  [null, 'activate', 'OPEN'],
  ['OPEN', 'respond', 'RESPONDED'],
  ['RESPONDED', 'close', 'CLOSED'],
  ['RESPONDED', 'reject', 'OPEN'],
  ['CLOSED', 'reopen', 'OPEN'],
];

describe('the action machine', () => {
  it.each(ACTION_EXPECTED)('%s --%s--> %s', (from, event, to) => {
    expect(nextActionStatus(from, event as never)).toBe(to);
  });

  it('has exactly the listed transitions and no others', () => {
    expect(ACTION_TRANSITIONS).toHaveLength(ACTION_EXPECTED.length);
  });

  it('starts from null, because an item has no status until circulation', () => {
    // docs/05 §4: before activatedAt the item has no status transitions and no
    // notifications. This is that rule in the type.
    expect(nextActionStatus(null, 'activate')).toBe('IN_PROGRESS');
    expect(nextActionStatus(null, 'reportComplete')).toBeUndefined();
    expect(nextActionStatus(null, 'confirm')).toBeUndefined();
  });

  it('cannot be confirmed straight from IN_PROGRESS — somebody has to report it first', () => {
    expect(nextActionStatus('IN_PROGRESS', 'confirm')).toBeUndefined();
    expect(nextActionStatus('DELAYED', 'confirm')).toBeUndefined();
  });

  it('cannot be completed twice', () => {
    expect(nextActionStatus('COMPLETED', 'confirm')).toBeUndefined();
  });

  it('throws INVALID_TRANSITION rather than returning undefined', () => {
    expect(() => advanceAction('IN_PROGRESS', 'confirm')).toThrowError(/Cannot move/);
    expect(() => advanceAction(null, 'reportComplete')).toThrowError(/NOT_ACTIVE/);
  });
});

describe('the clarification machine', () => {
  it.each(CLARIFICATION_EXPECTED)('%s --%s--> %s', (from, event, to) => {
    expect(nextClarificationStatus(from, event as never)).toBe(to);
  });

  it('has exactly the listed transitions and no others', () => {
    expect(CLARIFICATION_TRANSITIONS).toHaveLength(CLARIFICATION_EXPECTED.length);
  });

  it('keeps a vocabulary entirely separate from actions', () => {
    // The two donuts sit side by side on the dashboard. Sharing a word between
    // them would make the charts unreadable.
    const actionWords = new Set(ACTION_EXPECTED.map(([, , to]) => to as string));
    const clarificationWords = new Set(CLARIFICATION_EXPECTED.map(([, , to]) => to as string));
    for (const word of clarificationWords) expect(actionWords.has(word)).toBe(false);
  });

  it('cannot be closed without an answer', () => {
    expect(nextClarificationStatus('OPEN', 'close')).toBeUndefined();
  });

  it('throws on an illegal move', () => {
    expect(() => advanceClarification('OPEN', 'close')).toThrowError(/Cannot move from OPEN/);
  });
});

describe('the nightly delayed job', () => {
  const now = new Date('2026-09-12T02:00:00Z');
  const past = new Date('2026-09-01T00:00:00Z');
  const future = new Date('2026-10-01T00:00:00Z');
  const activated = new Date('2026-08-01T00:00:00Z');

  it('marks an overdue IN_PROGRESS action delayed', () => {
    expect(
      shouldMarkDelayed({ actionStatus: 'IN_PROGRESS', dueDate: past, activatedAt: activated }, now),
    ).toBe(true);
  });

  it('leaves an item that is not yet due alone', () => {
    expect(
      shouldMarkDelayed({ actionStatus: 'IN_PROGRESS', dueDate: future, activatedAt: activated }, now),
    ).toBe(false);
  });

  it('leaves UNDER_REVIEW alone even when it is overdue', () => {
    // It is waiting on the confirmer, not on the work. Marking it DELAYED would
    // blame the officer who finished it for somebody else's inaction.
    expect(
      shouldMarkDelayed({ actionStatus: 'UNDER_REVIEW', dueDate: past, activatedAt: activated }, now),
    ).toBe(false);
  });

  it('never touches an item that has not been circulated', () => {
    expect(
      shouldMarkDelayed({ actionStatus: 'IN_PROGRESS', dueDate: past, activatedAt: null }, now),
    ).toBe(false);
  });

  it('is idempotent — an item already DELAYED is not re-marked', () => {
    expect(
      shouldMarkDelayed({ actionStatus: 'DELAYED', dueDate: past, activatedAt: activated }, now),
    ).toBe(false);
  });
});

describe('daysOverdue', () => {
  const now = new Date('2026-09-12T09:30:00Z');

  it('counts whole days from the due date', () => {
    expect(daysOverdue(new Date('2026-09-01T00:00:00Z'), now)).toBe(11);
  });

  it('is zero on the due date itself', () => {
    expect(daysOverdue(new Date('2026-09-12T00:00:00Z'), now)).toBe(0);
  });

  it('is zero, not negative, before the due date', () => {
    expect(daysOverdue(new Date('2026-10-01T00:00:00Z'), now)).toBe(0);
  });

  it('is zero for a clarification, which has no due date', () => {
    expect(daysOverdue(null, now)).toBe(0);
  });

  it('ignores the time of day, so the register and the job agree', () => {
    const early = daysOverdue(new Date('2026-09-10T23:00:00Z'), new Date('2026-09-12T00:05:00Z'));
    const late = daysOverdue(new Date('2026-09-10T01:00:00Z'), new Date('2026-09-12T23:55:00Z'));
    expect(early).toBe(late);
  });
});

describe('nobody confirms their own work', () => {
  const base = {
    actorDesignation: 'MD',
    priority: 'HIGH' as const,
  };

  it('refuses an owner confirming their own action', () => {
    expect(
      mayConfirm({ ...base, ownerIds: ['u1', 'u2'], actorId: 'u1' }),
    ).toEqual({ allowed: false, reason: 'SELF_CONFIRMATION' });
  });

  it('refuses any one of several joint owners', () => {
    // Joint ownership means every one of them is equally accountable, so every
    // one of them is equally disqualified from signing it off.
    expect(mayConfirm({ ...base, ownerIds: ['u1', 'u2', 'u3'], actorId: 'u3' }).allowed).toBe(false);
  });

  it('allows somebody who is not an owner', () => {
    expect(mayConfirm({ ...base, ownerIds: ['u1', 'u2'], actorId: 'u9' })).toEqual({
      allowed: true,
    });
  });

  it('allows an item with no owners at all to be confirmed by anyone', () => {
    expect(mayConfirm({ ...base, ownerIds: [], actorId: 'u1' }).allowed).toBe(true);
  });
});

describe('the priority routing stub', () => {
  it('returns the same answer for every priority, because the matrix is undecided', () => {
    const answers = (['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'LOWER'] as const).map((p) =>
      designationsFor(p),
    );
    for (const a of answers) expect(a).toEqual(DEFAULT_CONFIRMERS);
  });

  it('handles a missing priority', () => {
    expect(designationsFor(null)).toEqual(DEFAULT_CONFIRMERS);
    expect(designationsFor(undefined)).toEqual(DEFAULT_CONFIRMERS);
  });

  it('imposes no designation restriction while the list is empty', () => {
    // An empty list means "no restriction", not "nobody". Reading it the other
    // way round would lock every item in the system.
    expect(DEFAULT_CONFIRMERS).toHaveLength(0);
    expect(
      mayConfirm({ ownerIds: ['u1'], actorId: 'u2', actorDesignation: 'ULB', priority: 'VERY_HIGH' })
        .allowed,
    ).toBe(true);
  });
});
