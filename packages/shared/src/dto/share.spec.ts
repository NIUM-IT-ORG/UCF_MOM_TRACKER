import { describe, expect, it } from 'vitest';
import { shareDto } from './share.js';

/**
 * The manual share, checked at the boundary it is stated at.
 *
 * The service enforces the scope rules again — you cannot share with someone
 * you cannot see, and that check cannot live in a DTO because it depends on
 * who is asking. What a DTO *can* refuse is a share that could never be
 * delivered to anybody: no recipients, no channel, or a WhatsApp message with
 * no pre-approved template to send.
 */
const good = {
  subjectType: 'MEETING' as const,
  subjectId: 'ckmeeting1',
  recipientIds: ['ckuser00000000000000000001'],
  channels: ['EMAIL' as const],
  attachmentFileIds: [],
  subject: 'Agenda for the monthly review',
};

describe('a share needs somebody to send to', () => {
  it('accepts a complete one', () => {
    expect(shareDto.safeParse(good).success).toBe(true);
  });

  it('refuses one with no recipients', () => {
    const r = shareDto.safeParse({ ...good, recipientIds: [] });
    expect(r.success).toBe(false);
  });

  it('refuses one with no channel', () => {
    expect(shareDto.safeParse({ ...good, channels: [] }).success).toBe(false);
  });

  it('refuses a channel that is not one of the three', () => {
    expect(shareDto.safeParse({ ...good, channels: ['FAX'] }).success).toBe(false);
  });

  it('refuses a subject type that is not shareable', () => {
    expect(shareDto.safeParse({ ...good, subjectType: 'AUDIT' }).success).toBe(false);
  });

  it('accepts each of the five subject types', () => {
    for (const subjectType of ['MEETING', 'MOM', 'ITEM', 'PROJECT', 'REPORT']) {
      expect(shareDto.safeParse({ ...good, subjectType }).success, subjectType).toBe(true);
    }
  });
});

describe('a share needs something to say', () => {
  it('refuses a subject that is not a subject', () => {
    // "", " ", "ok" — the point of the rule is something readable in an
    // inbox, and a two-character one is the same problem as none at all.
    for (const subject of ['', ' ', 'ok']) {
      expect(shareDto.safeParse({ ...good, subject }).success, JSON.stringify(subject)).toBe(false);
    }
  });

  it('treats the note as optional — a link with no covering note is a real share', () => {
    expect(shareDto.safeParse({ ...good, note: undefined }).success).toBe(true);
  });
});

describe('WhatsApp needs a pre-approved template', () => {
  /*
   * An Indian aggregator will not deliver free-form text to a number that has
   * not messaged first; every business-initiated message goes out as a
   * template registered in advance. Refusing this here means the officer is
   * told at the dialog rather than by a provider rejection nobody reads.
   */
  it('refuses WhatsApp with no template key', () => {
    const r = shareDto.safeParse({ ...good, channels: ['WHATSAPP'] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['templateKey']);
    }
  });

  it('accepts WhatsApp once a template is named', () => {
    const r = shareDto.safeParse({
      ...good,
      channels: ['WHATSAPP'],
      templateKey: 'ucf_generic_share',
    });
    expect(r.success).toBe(true);
  });

  it('refuses a mixed send where only the WhatsApp half is unsendable', () => {
    expect(shareDto.safeParse({ ...good, channels: ['EMAIL', 'WHATSAPP'] }).success).toBe(false);
  });

  it('does not demand a template for email or in-app', () => {
    expect(shareDto.safeParse({ ...good, channels: ['EMAIL', 'IN_APP'] }).success).toBe(true);
  });
});

describe('the shape is closed', () => {
  it('refuses a field nobody declared', () => {
    // `.strict()`, so a renamed field fails loudly instead of being dropped
    // and leaving the officer wondering why their note never arrived.
    expect(shareDto.safeParse({ ...good, body: 'the note, misnamed' }).success).toBe(false);
  });

  it('defaults the attachments to none rather than undefined', () => {
    const r = shareDto.safeParse({ ...good, attachmentFileIds: undefined });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.attachmentFileIds).toEqual([]);
  });
});
