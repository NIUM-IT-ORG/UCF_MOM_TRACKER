import { describe, expect, it } from 'vitest';
import { designationLabel } from './display.js';

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
