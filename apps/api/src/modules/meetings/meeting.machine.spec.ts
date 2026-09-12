import { describe, expect, it } from 'vitest';
import type { MeetingStage, MeetingType } from '@mom/shared';
import {
  MEETING_TRANSITIONS,
  advance,
  advanceMonotonic,
  isHeldOrLater,
  isPlanning,
  nextStage,
  stageIndex,
} from './meeting.machine.js';
import {
  formatMeetingCode,
  kindFor,
  meetingScopeFor,
  nextItemRef,
  nextMeetingNumber,
} from './meeting-code.js';

/**
 * docs/05-WORKFLOWS.md says "every transition here is the complete set — a
 * transition not listed does not exist". These tests are that sentence made
 * executable: the first block asserts each listed transition works, and the
 * second asserts the table contains nothing else.
 */

const SCHEDULED_EXPECTED: [MeetingStage, string, MeetingStage][] = [
  ['PLANNED', 'saveDetails', 'AGENDA'],
  ['AGENDA', 'draftAgenda', 'INVITEES'],
  ['INVITEES', 'addInvitees', 'INVITEE_INPUTS'],
  ['INVITEE_INPUTS', 'confirm', 'CONFIRMED'],
  ['CONFIRMED', 'end', 'HELD'],
  ['HELD', 'startMinutes', 'MINUTED'],
  ['MINUTED', 'close', 'CLOSED'],
  ['CONFIRMED', 'reschedule', 'CONFIRMED'],
  ['CONFIRMED', 'cancel', 'CANCELLED'],
  ['INVITEE_INPUTS', 'cancel', 'CANCELLED'],
];

const INSTANT_EXPECTED: [MeetingStage, string, MeetingStage][] = [
  ['COMPOSED', 'launch', 'LIVE'],
  ['LIVE', 'end', 'HELD'],
  ['HELD', 'startMinutes', 'MINUTED'],
  ['MINUTED', 'close', 'CLOSED'],
];

describe('the scheduled meeting machine', () => {
  it.each(SCHEDULED_EXPECTED)('%s --%s--> %s', (from, action, to) => {
    expect(nextStage('SCHEDULED', from, action as never)).toBe(to);
  });

  it('has exactly the listed transitions and no others', () => {
    expect(MEETING_TRANSITIONS.SCHEDULED).toHaveLength(SCHEDULED_EXPECTED.length);
  });

  it('refuses a transition that is not in the table', () => {
    expect(nextStage('SCHEDULED', 'PLANNED', 'confirm')).toBeUndefined();
    expect(nextStage('SCHEDULED', 'CLOSED', 'cancel')).toBeUndefined();
    // A scheduled meeting is never launched; that is the instant journey.
    expect(nextStage('SCHEDULED', 'PLANNED', 'launch')).toBeUndefined();
  });

  it('cannot be cancelled once it has been held', () => {
    for (const stage of ['HELD', 'MINUTED', 'CLOSED'] as MeetingStage[]) {
      expect(nextStage('SCHEDULED', stage, 'cancel')).toBeUndefined();
    }
  });

  it('throws INVALID_TRANSITION rather than returning undefined, when asked to advance', () => {
    expect(() => advance('SCHEDULED', 'PLANNED', 'confirm')).toThrowError(
      /Cannot move from PLANNED/,
    );
  });
});

describe('the instant meeting machine', () => {
  it.each(INSTANT_EXPECTED)('%s --%s--> %s', (from, action, to) => {
    expect(nextStage('INSTANT', from, action as never)).toBe(to);
  });

  it('has exactly the listed transitions and no others', () => {
    expect(MEETING_TRANSITIONS.INSTANT).toHaveLength(INSTANT_EXPECTED.length);
  });

  it('has no agenda, no confirmation and no cancellation', () => {
    expect(nextStage('INSTANT', 'COMPOSED', 'draftAgenda')).toBeUndefined();
    expect(nextStage('INSTANT', 'COMPOSED', 'confirm')).toBeUndefined();
    expect(nextStage('INSTANT', 'LIVE', 'cancel')).toBeUndefined();
  });

  it('is identical to a scheduled meeting from HELD onwards', () => {
    for (const [from, action, to] of [
      ['HELD', 'startMinutes', 'MINUTED'],
      ['MINUTED', 'close', 'CLOSED'],
    ] as [MeetingStage, string, MeetingStage][]) {
      expect(nextStage('INSTANT', from, action as never)).toBe(to);
      expect(nextStage('SCHEDULED', from, action as never)).toBe(to);
    }
  });
});

describe('planning stages only ever move forward', () => {
  it('does not drop a meeting back to AGENDA when details are re-saved', () => {
    // The coordinator fixing the venue after adding invitees must not silently
    // re-open invitee contributions.
    expect(advanceMonotonic('SCHEDULED', 'INVITEE_INPUTS', 'saveDetails')).toBe('INVITEE_INPUTS');
  });

  it('still advances when the move is genuinely forward', () => {
    expect(advanceMonotonic('SCHEDULED', 'PLANNED', 'saveDetails')).toBe('AGENDA');
    expect(advanceMonotonic('SCHEDULED', 'AGENDA', 'draftAgenda')).toBe('INVITEES');
  });

  it('keeps CONFIRMED on reschedule rather than treating it as backwards', () => {
    expect(advanceMonotonic('SCHEDULED', 'CONFIRMED', 'reschedule')).toBe('CONFIRMED');
  });

  it('orders the ladder as the document does', () => {
    expect(stageIndex('SCHEDULED', 'PLANNED')).toBeLessThan(stageIndex('SCHEDULED', 'CONFIRMED'));
    expect(stageIndex('SCHEDULED', 'CONFIRMED')).toBeLessThan(stageIndex('SCHEDULED', 'CLOSED'));
    // CANCELLED is off the ladder — it is an end, not a position on it.
    expect(stageIndex('SCHEDULED', 'CANCELLED')).toBe(-1);
  });
});

describe('stage predicates', () => {
  it('knows which stages are still planning', () => {
    for (const s of ['PLANNED', 'AGENDA', 'INVITEES', 'INVITEE_INPUTS', 'COMPOSED'] as MeetingStage[]) {
      expect(isPlanning(s)).toBe(true);
    }
    for (const s of ['CONFIRMED', 'LIVE', 'HELD', 'MINUTED', 'CLOSED', 'CANCELLED'] as MeetingStage[]) {
      expect(isPlanning(s)).toBe(false);
    }
  });

  it('knows which stages mean the meeting happened', () => {
    expect(isHeldOrLater('HELD')).toBe(true);
    expect(isHeldOrLater('MINUTED')).toBe(true);
    expect(isHeldOrLater('CLOSED')).toBe(true);
    expect(isHeldOrLater('LIVE')).toBe(false);
    expect(isHeldOrLater('CANCELLED')).toBe(false);
  });
});

describe('meeting references', () => {
  it('uses the project code for a single-project meeting and HO for several', () => {
    expect(meetingScopeFor(['P1'])).toBe('P1');
    expect(meetingScopeFor(['P1', 'P2'])).toBe('HO');
    expect(meetingScopeFor([])).toBe('HO');
  });

  it('marks an instant meeting IM, so a reader knows no agenda was circulated', () => {
    expect(kindFor('INSTANT' as MeetingType)).toBe('IM');
    expect(kindFor('SCHEDULED' as MeetingType)).toBe('RM');
  });

  it('formats with a two-digit number', () => {
    expect(formatMeetingCode('P1', 'RM', 4)).toBe('UCF/P1/RM-04');
    expect(formatMeetingCode('HO', 'IM', 12)).toBe('UCF/HO/IM-12');
  });

  it('numbers per scope and per kind', () => {
    const existing = ['UCF/P1/RM-01', 'UCF/P1/RM-02', 'UCF/P2/RM-01', 'UCF/P1/IM-01'];
    expect(nextMeetingNumber(existing, 'P1', 'RM')).toBe(3);
    expect(nextMeetingNumber(existing, 'P1', 'IM')).toBe(2);
    expect(nextMeetingNumber(existing, 'P2', 'RM')).toBe(2);
    expect(nextMeetingNumber(existing, 'P3', 'RM')).toBe(1);
  });

  it('derives the next number from the highest, not from the count', () => {
    // If RM-02 were ever removed, a count would reissue 02 and two meetings
    // would share a reference in documents nobody can correct afterwards.
    expect(nextMeetingNumber(['UCF/P1/RM-01', 'UCF/P1/RM-03'], 'P1', 'RM')).toBe(4);
  });

  it('ignores a malformed code rather than producing NaN', () => {
    expect(nextMeetingNumber(['UCF/P1/RM-oops', 'UCF/P1/RM-02'], 'P1', 'RM')).toBe(3);
  });

  it('issues item references per type', () => {
    const refs = ['ACT-01', 'ACT-02', 'CLA-01'];
    expect(nextItemRef(refs, 'ACTION')).toBe('ACT-03');
    expect(nextItemRef(refs, 'CLARIFICATION')).toBe('CLA-02');
    expect(nextItemRef([], 'ACTION')).toBe('ACT-01');
  });
});
