import type { MomState } from '@mom/shared';
import { AppError } from '../../common/app-error.js';

/**
 * The MoM state machine from docs/05-WORKFLOWS.md §3.
 *
 * Note what is *not* here: there is no transition out of SIGNED. A circulated
 * MoM is immutable — a correction is a new MoM row pointing back at it. That
 * absence is the rule, and it is enforced by there being no row to find.
 */

export type MomEvent =
  | 'generate'
  | 'submit'
  | 'return'
  | 'reject'
  | 'approve'
  | 'resubmit'
  | 'sign';

const TRANSITIONS: { from: MomState; event: MomEvent; to: MomState }[] = [
  { from: 'NOT_GENERATED', event: 'generate', to: 'DRAFT' },
  { from: 'DRAFT', event: 'submit', to: 'SUBMITTED' },
  { from: 'SUBMITTED', event: 'return', to: 'RETURNED' },
  // Reject differs from return: the version does not advance, because nothing
  // was accepted as a version. Both need a remark.
  { from: 'SUBMITTED', event: 'reject', to: 'DRAFT' },
  { from: 'SUBMITTED', event: 'approve', to: 'APPROVED' },
  { from: 'RETURNED', event: 'resubmit', to: 'SUBMITTED' },
  { from: 'APPROVED', event: 'sign', to: 'SIGNED' },
];

export const MOM_TRANSITIONS = TRANSITIONS;

export function nextMomState(from: MomState, event: MomEvent): MomState | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.event === event)?.to;
}

export function advanceMom(from: MomState, event: MomEvent): MomState {
  const to = nextMomState(from, event);
  if (!to) throw AppError.badTransition(from, event);
  return to;
}

/** Submitting from RETURNED is a resubmission, and it advances the version. */
export function submitEventFor(from: MomState): MomEvent {
  return from === 'RETURNED' ? 'resubmit' : 'submit';
}

/** A resubmission is version n+1; a rejection and retry is still version n. */
export function versionAfter(from: MomState, current: number): number {
  return from === 'RETURNED' ? current + 1 : current;
}

/** Once circulated, nothing about it may change. */
export function assertMutable(state: MomState): void {
  if (state === 'SIGNED') {
    throw new AppError(
      'MOM_IMMUTABLE',
      'This MoM has been signed and circulated. Issue a corrigendum instead — the original stays as it was read.',
    );
  }
}

/** The minutes are locked from submission until the MoM comes back. */
export function minutesLockedIn(state: MomState): boolean {
  return state === 'SUBMITTED' || state === 'APPROVED' || state === 'SIGNED';
}
