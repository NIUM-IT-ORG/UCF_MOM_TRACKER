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

/**
 * Who may sign this MoM.
 *
 * Approval and signature are separate acts by separate offices: the Project
 * Coordinator validates the document and nominates one executive, and that
 * executive signs. So "may I sign?" is not a capability question — holding
 * `sign_mom` is necessary and not sufficient. The Mission Director may not
 * sign a MoM routed to the Additional Mission Director, and the reverse.
 *
 * Written as a pure function, and separately from the service, because it is
 * the rule the whole chain rests on and it should be readable without a
 * database.
 */
export interface SigningCheck {
  /** The officer the Project Coordinator nominated. Null before approval. */
  signatoryId: string | null;
  /** Who is asking. */
  userId: string;
  /** Does this user's designation carry `sign_mom` at all? */
  canSign: boolean;
}

export function assertMaySign(state: MomState, check: SigningCheck): void {
  if (state !== 'APPROVED') {
    throw AppError.badTransition(state, 'sign');
  }
  if (!check.signatoryId) {
    // Only reachable for a MoM approved before the routing step existed.
    throw new AppError(
      'VALIDATION_FAILED',
      'This MoM was approved without a signing officer being chosen. ' +
        'Ask the Project Coordinator to return it and approve it again.',
    );
  }
  if (check.signatoryId !== check.userId) {
    /*
     * 404-shaped elsewhere, deliberately not here. This is not "you may not
     * see this"; the officer can see the document perfectly well and is
     * looking at it. Telling them plainly that it is with someone else is the
     * whole reason they opened the screen.
     */
    throw new AppError(
      'NOT_YOUR_SIGNATURE',
      'This MoM was routed to a different officer for signature. Only the officer it was sent to can sign it.',
    );
  }
  if (!check.canSign) {
    // Belt and braces: someone nominated before their designation changed.
    throw new AppError(
      'FORBIDDEN_CAPABILITY',
      'Your designation no longer carries the authority to sign a MoM.',
      { capability: 'sign_mom' },
    );
  }
}
