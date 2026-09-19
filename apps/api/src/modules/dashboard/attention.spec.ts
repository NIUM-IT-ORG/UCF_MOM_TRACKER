import { describe, expect, it } from 'vitest';
import { buildAttention, type AttentionInput } from './attention.js';

/**
 * The attention list is only worth reading if an empty one means "nothing is
 * waiting on you". These tests are about who is told what — the failure mode
 * is a list that shows everybody everything, which people stop reading inside
 * a week.
 */
const base: AttentionInput = { userId: 'u-me', caps: [], items: [], meetings: [] };

const action = (over: Partial<AttentionInput['items'][number]> = {}) => ({
  id: 'i1',
  ref: 'ACT-01',
  type: 'ACTION' as const,
  description: 'Lay the pipe',
  actionStatus: 'IN_PROGRESS',
  clarificationStatus: null,
  daysOverdue: 0,
  ownerIds: [] as string[],
  respondedById: null,
  raisedById: 'u-other',
  ...over,
});

const clarification = (over: Partial<AttentionInput['items'][number]> = {}) =>
  action({
    ref: 'CLA-01',
    type: 'CLARIFICATION',
    actionStatus: null,
    clarificationStatus: 'OPEN',
    ...over,
  });

const meeting = (over: Partial<AttentionInput['meetings'][number]> = {}) => ({
  id: 'm1',
  code: 'UCF/P1/RM-01',
  title: 'Monthly review',
  type: 'SCHEDULED' as const,
  stage: 'CONFIRMED',
  momState: null,
  agendaFreezeAt: null,
  ...over,
});

describe('only what this officer can actually act on', () => {
  it('tells an approver that a MoM is with them', () => {
    const out = buildAttention({
      ...base,
      caps: ['approve_mom'],
      meetings: [meeting({ momState: 'SUBMITTED' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toContain('waiting for your approval');
  });

  it('says nothing about it to somebody who cannot approve', () => {
    expect(
      buildAttention({ ...base, meetings: [meeting({ momState: 'SUBMITTED' })] }),
    ).toHaveLength(0);
  });

  it('asks a confirmer to review work reported complete', () => {
    const out = buildAttention({
      ...base,
      caps: ['confirm_completion'],
      items: [action({ actionStatus: 'UNDER_REVIEW' })],
    });
    expect(out[0]?.text).toContain('awaiting your confirmation');
  });

  it('never asks an officer to confirm their own work', () => {
    // Nobody confirms their own: this is the whole reason Under Review exists,
    // and an attention list that invites it teaches people the rule is soft.
    const out = buildAttention({
      ...base,
      caps: ['confirm_completion'],
      items: [action({ actionStatus: 'UNDER_REVIEW', ownerIds: ['u-me'] })],
    });
    expect(out.map((e) => e.text).join(' ')).not.toContain('awaiting your confirmation');
  });

  it('puts a delayed action in front of its owner', () => {
    const out = buildAttention({
      ...base,
      items: [action({ actionStatus: 'DELAYED', daysOverdue: 3, ownerIds: ['u-me'] })],
    });
    expect(out[0]?.tone).toBe('red');
    expect(out[0]?.text).toContain('3 days late');
  });

  it('does not put somebody else’s delayed action in front of a bystander', () => {
    expect(
      buildAttention({ ...base, items: [action({ actionStatus: 'DELAYED', daysOverdue: 3 })] }),
    ).toHaveLength(0);
  });

  it('asks the named responder to answer a clarification', () => {
    const out = buildAttention({
      ...base,
      items: [clarification({ respondedById: 'u-me' })],
    });
    expect(out[0]?.text).toContain('unanswered');
  });

  it('tells whoever raised a clarification that it has been answered', () => {
    const out = buildAttention({
      ...base,
      items: [clarification({ clarificationStatus: 'RESPONDED', raisedById: 'u-me' })],
    });
    expect(out[0]?.text).toContain('close it if the answer will do');
  });

  it('nudges a coordinator about a scheduled meeting still in draft', () => {
    const out = buildAttention({
      ...base,
      caps: ['confirm_meeting'],
      meetings: [meeting({ stage: 'PLANNED' })],
    });
    expect(out[0]?.text).toContain('still a draft');
  });

  it('is empty when nothing is waiting on this officer', () => {
    expect(
      buildAttention({
        ...base,
        items: [action({ actionStatus: 'COMPLETED' }), clarification({ clarificationStatus: 'CLOSED' })],
        meetings: [meeting({ momState: 'SIGNED' })],
      }),
    ).toEqual([]);
  });

  it('caps the list rather than running to fifty rows', () => {
    const many = Array.from({ length: 20 }, (_, n) =>
      action({ id: `i${n}`, ref: `ACT-${n}`, ownerIds: ['u-me'] }),
    );
    expect(buildAttention({ ...base, items: many })).toHaveLength(8);
  });

  it('puts the blocking MoM above an officer’s own work', () => {
    const out = buildAttention({
      ...base,
      caps: ['approve_mom'],
      items: [action({ ownerIds: ['u-me'] })],
      meetings: [meeting({ momState: 'SUBMITTED' })],
    });
    expect(out[0]?.text).toContain('approval');
  });
});
