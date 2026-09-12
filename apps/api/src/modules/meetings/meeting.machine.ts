import type { MeetingStage, MeetingType } from '@mom/shared';
import { AppError } from '../../common/app-error.js';

/**
 * The two meeting state machines from docs/05-WORKFLOWS.md §1 and §2.
 *
 * They are written as data rather than as a chain of `if`s for one reason: the
 * doc says "every transition here is the complete set — a transition not listed
 * does not exist". A table can be compared against that list by eye and by
 * test; scattered conditionals cannot. Adding a transition means adding a row
 * here, which is exactly the review that a new transition deserves.
 */

export type MeetingAction =
  | 'saveDetails'
  | 'draftAgenda'
  | 'addInvitees'
  | 'openInputs'
  | 'confirm'
  | 'reschedule'
  | 'cancel'
  | 'launch'
  | 'end'
  | 'startMinutes'
  | 'close';

interface Transition {
  from: MeetingStage;
  action: MeetingAction;
  to: MeetingStage;
}

/** Scheduled: PLANNED → AGENDA → INVITEES → INVITEE_INPUTS → CONFIRMED → HELD → MINUTED → CLOSED. */
const SCHEDULED: Transition[] = [
  { from: 'PLANNED', action: 'saveDetails', to: 'AGENDA' },
  { from: 'AGENDA', action: 'draftAgenda', to: 'INVITEES' },
  { from: 'INVITEES', action: 'addInvitees', to: 'INVITEE_INPUTS' },
  { from: 'INVITEE_INPUTS', action: 'confirm', to: 'CONFIRMED' },
  { from: 'CONFIRMED', action: 'end', to: 'HELD' },
  { from: 'HELD', action: 'startMinutes', to: 'MINUTED' },
  { from: 'MINUTED', action: 'close', to: 'CLOSED' },
  // Reschedule is a self-transition: the meeting keeps its code, its agenda and
  // its stage. Only the date moves, and everyone is told again.
  { from: 'CONFIRMED', action: 'reschedule', to: 'CONFIRMED' },
  { from: 'CONFIRMED', action: 'cancel', to: 'CANCELLED' },
  { from: 'INVITEE_INPUTS', action: 'cancel', to: 'CANCELLED' },
];

/** Instant: COMPOSED → LIVE → HELD → MINUTED → CLOSED. No agenda, no RSVP, no freeze. */
const INSTANT: Transition[] = [
  { from: 'COMPOSED', action: 'launch', to: 'LIVE' },
  { from: 'LIVE', action: 'end', to: 'HELD' },
  { from: 'HELD', action: 'startMinutes', to: 'MINUTED' },
  { from: 'MINUTED', action: 'close', to: 'CLOSED' },
];

export const MEETING_TRANSITIONS: Record<MeetingType, Transition[]> = {
  SCHEDULED,
  INSTANT,
};

/** The stage this action leads to, or undefined when it is not a legal move. */
export function nextStage(
  type: MeetingType,
  from: MeetingStage,
  action: MeetingAction,
): MeetingStage | undefined {
  return MEETING_TRANSITIONS[type].find((t) => t.from === from && t.action === action)?.to;
}

/**
 * The stage after this one, or the same stage — used by the planning steps,
 * which are allowed to be re-run without complaint.
 *
 * Saving the agenda on a meeting already at INVITEES should not fail; the
 * coordinator is editing, not advancing. Only a move *backwards* or a move from
 * a stage the action does not apply to is an error.
 */
export function advance(
  type: MeetingType,
  from: MeetingStage,
  action: MeetingAction,
): MeetingStage {
  const to = nextStage(type, from, action);
  if (to) return to;
  throw AppError.badTransition(from, action);
}

/** Ordinal position in this type's ladder, or -1 for a stage it never occupies. */
export function stageIndex(type: MeetingType, stage: MeetingStage): number {
  const ladder =
    type === 'INSTANT'
      ? (['COMPOSED', 'LIVE', 'HELD', 'MINUTED', 'CLOSED'] as MeetingStage[])
      : ([
          'PLANNED',
          'AGENDA',
          'INVITEES',
          'INVITEE_INPUTS',
          'CONFIRMED',
          'HELD',
          'MINUTED',
          'CLOSED',
        ] as MeetingStage[]);
  return ladder.indexOf(stage);
}

/**
 * Raises the stage to the floor this planning action implies, and never lowers
 * it.
 *
 * The four planning stages are a progress indicator, not a gate. A coordinator
 * who goes back to fix the venue after adding invitees has not undone anything,
 * and dropping the meeting from INVITEE_INPUTS back to AGENDA would silently
 * re-open invitee contributions. So this asks "which stage does having done
 * this prove we have reached", not "which transition fires from here" — the
 * second question has no answer once the stage is already past it, and throwing
 * there would refuse an edit that is perfectly legitimate.
 *
 * Only for the progress actions. A real gate — confirm, launch, cancel — goes
 * through `advance`, which refuses anything not in the table.
 */
export function advanceMonotonic(
  type: MeetingType,
  from: MeetingStage,
  action: MeetingAction,
): MeetingStage {
  const here = stageIndex(type, from);
  // Off the ladder entirely: cancelled meetings do not creep forward.
  if (here < 0) return from;

  const floor = MEETING_TRANSITIONS[type].find((t) => t.action === action)?.to;
  if (!floor) throw AppError.badTransition(from, action);

  return stageIndex(type, floor) > here ? floor : from;
}

/** A meeting that has been held is past the point where planning edits apply. */
export function isPlanning(stage: MeetingStage): boolean {
  return (
    stage === 'PLANNED' ||
    stage === 'AGENDA' ||
    stage === 'INVITEES' ||
    stage === 'INVITEE_INPUTS' ||
    stage === 'COMPOSED'
  );
}

/** True once the meeting has actually taken place. */
export function isHeldOrLater(stage: MeetingStage): boolean {
  return stage === 'HELD' || stage === 'MINUTED' || stage === 'CLOSED';
}
