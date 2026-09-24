import { describe, expect, it } from 'vitest';
import { createItemDto } from './item.js';
import { ALL_CAPABILITIES, SEED_DESIGNATION_CAPS } from '../capabilities.js';

const ids = { meetingId: 'm1', projectId: 'p1', raisedById: 'u1' };

describe('createItemDto — the two shapes', () => {
  it('accepts an action with owners and a due date', () => {
    const r = createItemDto.safeParse({
      type: 'ACTION',
      ...ids,
      description: 'Deploy an additional work crew in Zone A',
      ownerIds: ['u8'],
      dueDate: '2026-09-25',
      priority: 'HIGH',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an action with no owners — joint ownership still needs one name', () => {
    const r = createItemDto.safeParse({
      type: 'ACTION',
      ...ids,
      description: 'Deploy an additional work crew in Zone A',
      ownerIds: [],
      dueDate: '2026-09-25',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an action with no due date', () => {
    const r = createItemDto.safeParse({
      type: 'ACTION',
      ...ids,
      description: 'Deploy an additional work crew in Zone A',
      ownerIds: ['u8'],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a clarification with no owners and no date', () => {
    const r = createItemDto.safeParse({
      type: 'CLARIFICATION',
      ...ids,
      description: 'Is barricading cost met from the contingency head?',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a clarification carrying a due date rather than dropping it', () => {
    const r = createItemDto.safeParse({
      type: 'CLARIFICATION',
      ...ids,
      description: 'Is barricading cost met from the contingency head?',
      dueDate: '2026-09-25',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a clarification carrying a priority', () => {
    const r = createItemDto.safeParse({
      type: 'CLARIFICATION',
      ...ids,
      description: 'Is barricading cost met from the contingency head?',
      priority: 'HIGH',
    });
    expect(r.success).toBe(false);
  });
});

describe('seed capability grants', () => {
  it('only grants capabilities that exist', () => {
    for (const [designation, caps] of Object.entries(SEED_DESIGNATION_CAPS)) {
      for (const cap of caps) {
        expect(ALL_CAPABILITIES, `${designation} grants unknown "${cap}"`).toContain(cap);
      }
    }
  });

  it('gives the external invitee nothing', () => {
    expect(SEED_DESIGNATION_CAPS.EXT).toEqual([]);
  });

  it('keeps approval away from the coordinator — nobody approves their own MoM', () => {
    expect(SEED_DESIGNATION_CAPS.MC).not.toContain('approve_mom');
  });
});

/**
 * A clarification settled in the room.
 *
 * This exists because the minutes were misreporting their own meeting. A
 * clarification cannot be answered until the MoM is circulated, and the MoM
 * is generated *before* circulation — so a question asked and answered in
 * front of everybody was printed on the signed document as "Open". The
 * status is on the page, which is precisely why it has to be true.
 */
describe('a clarification answered in the meeting', () => {
  const asked = {
    type: 'CLARIFICATION' as const,
    ...ids,
    description: 'Is barricading cost met from the contingency head?',
  };

  it('is still fine with no answer — most are taken away and answered later', () => {
    expect(createItemDto.safeParse(asked).success).toBe(true);
  });

  it('accepts an answer when the officer who gave it is named', () => {
    const r = createItemDto.safeParse({
      ...asked,
      respondedById: 'u2',
      response: 'Yes, from the contingency head, confirmed by the PD in the meeting.',
    });
    expect(r.success).toBe(true);
  });

  /*
   * The rule worth having: a minute that says an answer was given and cannot
   * say by whom has recorded the one half that is useless on its own.
   */
  it('refuses an answer from nobody', () => {
    const r = createItemDto.safeParse({ ...asked, response: 'Yes, from contingency.' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['respondedById']);
  });

  it('refuses an answer too short to be one', () => {
    for (const response of ['', ' ', 'ok']) {
      const r = createItemDto.safeParse({ ...asked, respondedById: 'u2', response });
      expect(r.success, JSON.stringify(response)).toBe(false);
    }
  });

  /*
   * Naming a responder without an answer is the ordinary case — somebody is
   * nominated in the meeting and answers next week.
   */
  it('still allows a responder with no answer yet', () => {
    expect(createItemDto.safeParse({ ...asked, respondedById: 'u2' }).success).toBe(true);
  });

  it('does not let an action carry an answer', () => {
    const r = createItemDto.safeParse({
      type: 'ACTION',
      ...ids,
      description: 'Submit the revised estimate for Zone A',
      ownerIds: ['u2'],
      dueDate: '2026-10-10',
      response: 'Already done',
    });
    expect(r.success).toBe(false);
  });
});
