import type { Capability } from '@mom/shared';

/**
 * What needs this officer, today.
 *
 * The rule that makes this useful rather than decorative: an entry appears
 * only when the officer reading it can actually do the thing. A list that
 * shows everybody everything is a newsfeed, and people stop reading it in a
 * week — the point is that an empty list means nothing is waiting on *you*.
 *
 * Pure on purpose. The queries live in the service; the judgement about who
 * should be told what lives here, where it can be tested against a designation
 * matrix rather than a database.
 */
export type Tone = 'red' | 'amber' | 'violet' | 'plain';

export interface AttentionEntry {
  tone: Tone;
  /** One sentence, already in the officer's language. */
  text: string;
  /** Where the officer goes to deal with it. */
  href: string;
  action: string;
}

export interface AttentionInput {
  userId: string;
  caps: Capability[];
  items: {
    id: string;
    ref: string;
    type: 'ACTION' | 'CLARIFICATION';
    description: string;
    actionStatus: string | null;
    clarificationStatus: string | null;
    daysOverdue: number;
    ownerIds: string[];
    respondedById: string | null;
    raisedById: string | null;
  }[];
  meetings: {
    id: string;
    code: string;
    title: string;
    type: 'INSTANT' | 'SCHEDULED';
    stage: string;
    momState: string | null;
    agendaFreezeAt: string | null;
  }[];
}

const ageing = (days: number) =>
  days > 0 ? `${days} day${days === 1 ? '' : 's'} late` : 'not yet due';

export function buildAttention(input: AttentionInput, limit = 8): AttentionEntry[] {
  const { userId, caps, items, meetings } = input;
  const can = (c: Capability) => caps.includes(c);
  const out: AttentionEntry[] = [];
  const mine = (i: AttentionInput['items'][number]) => i.ownerIds.includes(userId);

  // Ordered by how much somebody else is waiting on this officer, which is not
  // the same as how urgent the work is. A MoM stuck with an approver blocks
  // every action in it, so it goes first.
  if (can('approve_mom')) {
    for (const m of meetings.filter((x) => x.momState === 'SUBMITTED')) {
      out.push({
        tone: 'amber',
        text: `The MoM for ${m.code} is waiting for your approval.`,
        href: `/mom?meeting=${m.id}`,
        action: 'Open the MoM',
      });
    }
  }

  if (can('upload_signed')) {
    for (const m of meetings.filter((x) => x.momState === 'APPROVED')) {
      out.push({
        tone: 'amber',
        text: `${m.code} is approved and waiting for the signed copy before it can circulate.`,
        href: `/mom?meeting=${m.id}`,
        action: 'Upload and circulate',
      });
    }
  }

  if (can('confirm_completion')) {
    for (const i of items.filter(
      (x) => x.type === 'ACTION' && x.actionStatus === 'UNDER_REVIEW' && !mine(x),
    )) {
      out.push({
        tone: 'violet',
        text: `${i.ref} — ${i.description} — reported complete, awaiting your confirmation.`,
        href: `/register?item=${i.id}`,
        action: 'Review it',
      });
    }
  }

  if (can('confirm_meeting')) {
    for (const m of meetings.filter((x) => x.type === 'SCHEDULED' && x.stage === 'INVITEE_INPUTS')) {
      out.push({
        tone: 'amber',
        text: `Invitees are still adding to ${m.title}. Confirm it once the agenda freezes.`,
        href: `/meetings/${m.id}`,
        action: 'Open',
      });
    }
    for (const m of meetings.filter((x) => x.type === 'SCHEDULED' && x.stage === 'PLANNED')) {
      out.push({
        tone: 'plain',
        text: `${m.title} is still a draft — no agenda and no invitees yet.`,
        href: `/meetings/${m.id}`,
        action: 'Continue',
      });
    }
  }

  for (const i of items) {
    if (i.type === 'ACTION' && i.actionStatus === 'DELAYED' && (mine(i) || can('confirm_completion'))) {
      out.push({
        tone: 'red',
        text: `${i.ref} is ${ageing(i.daysOverdue)} — ${i.description}`,
        href: `/register?item=${i.id}`,
        action: 'Open',
      });
    }
    if (
      i.type === 'CLARIFICATION' &&
      i.clarificationStatus === 'OPEN' &&
      (i.respondedById === userId || can('respond_clarification'))
    ) {
      out.push({
        tone: 'plain',
        text: `${i.ref} is unanswered — ${i.description}`,
        href: `/register?item=${i.id}`,
        action: 'Respond',
      });
    }
    if (
      i.type === 'CLARIFICATION' &&
      i.clarificationStatus === 'RESPONDED' &&
      i.raisedById === userId
    ) {
      out.push({
        tone: 'plain',
        text: `${i.ref} has been answered. You raised it — close it if the answer will do.`,
        href: `/register?item=${i.id}`,
        action: 'Read the answer',
      });
    }
    if (i.type === 'ACTION' && mine(i) && i.actionStatus === 'IN_PROGRESS') {
      out.push({
        tone: 'plain',
        text: `${i.ref} is assigned to you · ${ageing(i.daysOverdue)}`,
        href: `/register?item=${i.id}`,
        action: 'Update',
      });
    }
  }

  return out.slice(0, limit);
}
