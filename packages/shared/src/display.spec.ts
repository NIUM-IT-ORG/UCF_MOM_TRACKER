import { describe, expect, it } from 'vitest';
import { designationLabel, wholePercentages } from './display.js';
import { MOM_STATE_LABEL, momStateLabel } from './enums.js';

/**
 * What goes in the Designation column.
 *
 * The rule exists because of one sentence in `docs/01-PRD.md`: an External
 * invitee is a banker or a corporation engineer, "named in attendance". An
 * attendance sheet that records every outsider as "External invitee" cannot
 * answer the question attendance sheets are kept to answer.
 */
describe('the designation a person is shown under', () => {
  it('is the designation they hold, normally', () => {
    expect(designationLabel(null, 'Mission Director')).toBe('Mission Director');
    expect(designationLabel(undefined, 'Meeting Coordinator')).toBe('Meeting Coordinator');
  });

  it('is the typed one when there is one', () => {
    expect(designationLabel('Branch Manager, SBI', 'External invitee')).toBe('Branch Manager, SBI');
  });

  /*
   * A title of spaces is what a form sends when somebody tabs through the
   * field. Printing it would leave the column blank on a document that goes
   * on the record, which is worse than printing the designation row's name.
   */
  it('falls back when the typed one is blank or only spaces', () => {
    expect(designationLabel('', 'External invitee')).toBe('External invitee');
    expect(designationLabel('   ', 'External invitee')).toBe('External invitee');
  });

  it('trims a typed one that is otherwise good', () => {
    expect(designationLabel('  Branch Manager, SBI  ', 'External invitee')).toBe(
      'Branch Manager, SBI',
    );
  });

  /*
   * Worth pinning: this function decides display and nothing else. Capability
   * is read from the designation the person is attached to — rule 1 in
   * CLAUDE.md — and a typed string has no answer to "what may this person
   * do?". Nothing here returns a capability, a code or an id, and it must
   * stay that way.
   */
  it('returns a label and never a code', () => {
    expect(designationLabel('Branch Manager, SBI', 'External invitee')).not.toMatch(/^EXT$/);
  });
});


/**
 * The two signing routes have to be told apart wherever a MoM is named.
 *
 * An office that signs on paper files the signed document, and that document
 * is then the MoM - what circulated, what the annexures sit behind, what
 * anybody opening the meeting is handed. Calling that "Signed & circulated",
 * the same as a document this system generated, loses the only distinction a
 * reader of a closed meeting actually needs.
 */
describe('what a circulated MoM is called', () => {
  it('says the document was uploaded when one was filed', () => {
    expect(momStateLabel('SIGNED', true)).toBe('Uploaded & circulated');
  });

  it('says signed when the signature was the act in the system', () => {
    expect(momStateLabel('SIGNED', false)).toBe('Signed & circulated');
  });

  it('treats an unknown route as signed in the system, never as uploaded', () => {
    expect(momStateLabel('SIGNED')).toBe('Signed & circulated');
  });

  it('leaves every other state exactly as the plain map has it', () => {
    for (const state of ['NOT_GENERATED', 'DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] as const) {
      // Including with uploaded = true: a draft with a file attached is still
      // a draft, and the word for it does not change.
      expect(momStateLabel(state, true)).toBe(MOM_STATE_LABEL[state]);
    }
  });
});


/**
 * The dashboard showed "50% · 13% · 13% · 25%" against sixteen actions. Each
 * figure was correctly rounded and the four of them came to 101, which on a
 * page a Mission Director reads is not a rounding artefact, it is a reason to
 * doubt the other numbers too.
 */
describe('percentages printed beside a donut', () => {
  const pct = (counts: Record<string, number>) => {
    const slices = Object.entries(counts).map(([key, value]) => ({ key, value }));
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    return wholePercentages(slices, total);
  };
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it('adds up to 100 on the breakdown that exposed this', () => {
    const m = pct({ IN_PROGRESS: 8, DELAYED: 2, UNDER_REVIEW: 2, COMPLETED: 4 });
    expect(sum(m)).toBe(100);
    expect(m.get('IN_PROGRESS')).toBe(50);
    expect(m.get('COMPLETED')).toBe(25);
  });

  it('adds up to 100 on thirds, which no per-slice rounding can', () => {
    const m = pct({ a: 1, b: 1, c: 1 });
    expect(sum(m)).toBe(100);
    expect([...m.values()].sort()).toEqual([33, 33, 34]);
  });

  it('never gives a point to a slice with nothing in it', () => {
    const m = pct({ a: 1, b: 1, c: 1, empty: 0 });
    expect(m.get('empty')).toBe(0);
    expect(sum(m)).toBe(100);
  });

  it('gives a single slice the whole hundred', () => {
    expect(pct({ only: 7 }).get('only')).toBe(100);
  });

  it('returns nothing rather than dividing by zero', () => {
    expect(pct({ a: 0, b: 0 }).size).toBe(0);
  });

  it('stays exact when the shares are already whole', () => {
    const m = pct({ a: 1, b: 1, c: 2 });
    expect([...m.values()]).toEqual([25, 25, 50]);
  });
});
