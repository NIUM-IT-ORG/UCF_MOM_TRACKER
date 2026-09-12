import type { Priority } from '@mom/shared';

/**
 * Who may confirm that an action is done.
 *
 * **This is an open client decision** (docs/01-PRD.md §9, docs/05-WORKFLOWS.md
 * §4). The client has not yet said which action priority requires whose
 * sign-off, and inventing that matrix would bake a governance rule into the
 * product that nobody agreed to — the kind of thing that is discovered a year
 * later, in an audit, by which time several hundred items have been confirmed
 * under it.
 *
 * So this ships doing the one thing that is certainly correct: confirmation
 * needs the `confirm_completion` capability and a person who is not an owner.
 * The priority switch below is written out, returning the same answer for every
 * branch, so that filling it in is a change to this file and nothing else.
 *
 * When the decision arrives, the only edit is the body of `designationsFor`.
 * Every caller already routes through here.
 */

/** The designation codes permitted to confirm an item of this priority. */
export function designationsFor(priority: Priority | null | undefined): string[] {
  switch (priority) {
    // ── the matrix goes here ──────────────────────────────────────────
    // The client's expected shape is something like:
    //   VERY_HIGH → ['MD']
    //   HIGH      → ['MD', 'AMD']
    //   MEDIUM    → ['PD', 'PDMC']
    //   LOW/LOWER → ['PDMC']
    // That is a guess, which is exactly why it is a comment and not code.
    case 'VERY_HIGH':
    case 'HIGH':
    case 'MEDIUM':
    case 'LOW':
    case 'LOWER':
    default:
      return DEFAULT_CONFIRMERS;
  }
}

/**
 * Until the matrix exists, anybody holding `confirm_completion` may confirm.
 * An empty list means "no designation restriction", not "nobody" — the
 * difference matters, and returning [] by accident would lock every item.
 */
export const DEFAULT_CONFIRMERS: string[] = [];

export interface ConfirmationCheck {
  ownerIds: string[];
  actorId: string;
  actorDesignation: string;
  priority: Priority | null | undefined;
}

export type ConfirmationVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'SELF_CONFIRMATION' }
  | { allowed: false; reason: 'WRONG_DESIGNATION'; expected: string[] };

/**
 * Nobody confirms their own work.
 *
 * Enforced here, in the service layer, rather than only by hiding the button:
 * the rule is the product's single most important integrity guarantee, and a
 * UI check is one curl away from not existing.
 */
export function mayConfirm(check: ConfirmationCheck): ConfirmationVerdict {
  if (check.ownerIds.includes(check.actorId)) {
    return { allowed: false, reason: 'SELF_CONFIRMATION' };
  }

  const allowed = designationsFor(check.priority);
  if (allowed.length > 0 && !allowed.includes(check.actorDesignation)) {
    return { allowed: false, reason: 'WRONG_DESIGNATION', expected: allowed };
  }

  return { allowed: true };
}
