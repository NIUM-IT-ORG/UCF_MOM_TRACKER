import type { ActionStatus, ClarificationStatus } from '@mom/shared';
import { AppError } from '../../common/app-error.js';

/**
 * The action and clarification machines from docs/05-WORKFLOWS.md §4 and §5.
 *
 * Two deliberately separate vocabularies. They are not merged and not
 * re-coloured, because the dashboard shows both donuts side by side and a
 * reader has to be able to tell at a glance which chart they are looking at.
 */

export type ActionEvent =
  | 'activate'
  | 'markDelayed'
  | 'reviseDue'
  | 'reportComplete'
  | 'confirm'
  | 'sendBack'
  | 'reopen';

export type ClarificationEvent = 'activate' | 'respond' | 'close' | 'reject' | 'reopen';

const ACTION: { from: ActionStatus | null; event: ActionEvent; to: ActionStatus }[] = [
  // Circulation is what brings an item to life. Before it there is no status.
  { from: null, event: 'activate', to: 'IN_PROGRESS' },
  { from: 'IN_PROGRESS', event: 'markDelayed', to: 'DELAYED' },
  { from: 'DELAYED', event: 'reviseDue', to: 'IN_PROGRESS' },
  { from: 'IN_PROGRESS', event: 'reportComplete', to: 'UNDER_REVIEW' },
  { from: 'DELAYED', event: 'reportComplete', to: 'UNDER_REVIEW' },
  { from: 'UNDER_REVIEW', event: 'confirm', to: 'COMPLETED' },
  { from: 'UNDER_REVIEW', event: 'sendBack', to: 'IN_PROGRESS' },
  { from: 'COMPLETED', event: 'reopen', to: 'IN_PROGRESS' },
];

const CLARIFICATION: { from: ClarificationStatus | null; event: ClarificationEvent; to: ClarificationStatus }[] = [
  { from: null, event: 'activate', to: 'OPEN' },
  { from: 'OPEN', event: 'respond', to: 'RESPONDED' },
  { from: 'RESPONDED', event: 'close', to: 'CLOSED' },
  { from: 'RESPONDED', event: 'reject', to: 'OPEN' },
  { from: 'CLOSED', event: 'reopen', to: 'OPEN' },
];

export const ACTION_TRANSITIONS = ACTION;
export const CLARIFICATION_TRANSITIONS = CLARIFICATION;

export function nextActionStatus(
  from: ActionStatus | null,
  event: ActionEvent,
): ActionStatus | undefined {
  return ACTION.find((t) => t.from === from && t.event === event)?.to;
}

export function nextClarificationStatus(
  from: ClarificationStatus | null,
  event: ClarificationEvent,
): ClarificationStatus | undefined {
  return CLARIFICATION.find((t) => t.from === from && t.event === event)?.to;
}

export function advanceAction(from: ActionStatus | null, event: ActionEvent): ActionStatus {
  const to = nextActionStatus(from, event);
  if (!to) throw AppError.badTransition(from ?? 'NOT_ACTIVE', event);
  return to;
}

export function advanceClarification(
  from: ClarificationStatus | null,
  event: ClarificationEvent,
): ClarificationStatus {
  const to = nextClarificationStatus(from, event);
  if (!to) throw AppError.badTransition(from ?? 'NOT_ACTIVE', event);
  return to;
}

/**
 * Whether the nightly job should move this item to DELAYED.
 *
 * An item already `UNDER_REVIEW` that passes its due date **keeps that status**
 * and is reported as "overdue, awaiting confirmation" — it is waiting on the
 * confirmer, not on the work, and marking it DELAYED would blame the officer
 * who finished it for the delay of the officer who has not looked at it.
 */
export function shouldMarkDelayed(
  item: { actionStatus: ActionStatus | null; dueDate: Date | null; activatedAt: Date | null },
  now: Date,
): boolean {
  if (!item.activatedAt || !item.dueDate) return false;
  if (item.actionStatus !== 'IN_PROGRESS') return false;
  return item.dueDate.getTime() < startOfDay(now).getTime();
}

/**
 * Days past due, or 0 when not overdue. Counted from the *due date*, in whole
 * days, so "15 days overdue" means the same thing to the escalation job and to
 * the register column the officer is reading.
 */
export function daysOverdue(dueDate: Date | null, now: Date): number {
  if (!dueDate) return 0;
  const diff = startOfDay(now).getTime() - startOfDay(dueDate).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}
