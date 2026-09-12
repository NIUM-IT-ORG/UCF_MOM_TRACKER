import type {
  ActionStatus,
  AttendanceMark,
  ClarificationStatus,
  ItemType,
  MeetingCategory,
  MeetingStage,
  MeetingType,
  MomState,
  Priority,
  RsvpResponse,
} from '@mom/shared';

/**
 * The shapes the meeting screens read.
 *
 * Declared once rather than per page: the list, the detail and the minutes
 * editor all render the same meeting, and three near-identical interfaces is
 * how a field ends up optional in one place and required in another.
 */

export interface Person {
  id: string;
  name: string;
  initials: string;
  email?: string;
  mobile?: string;
  designation: { code: string; name: string; band?: string };
  department?: { name: string };
}

export interface MeetingRow {
  id: string;
  code: string;
  type: MeetingType;
  category: MeetingCategory;
  title: string;
  meetingDate: string;
  startTime: string;
  endTime: string;
  venue: string;
  vcLink: string | null;
  stage: MeetingStage;
  agendaFreezeAt: string | null;
  confirmedAt: string | null;
  cancelledReason: string | null;
  chair: Person | null;
  createdBy: { id: string; name: string; initials: string };
  projects: { project: { id: string; code: string; name: string } }[];
  moms: { id: string; state: MomState; version: number; circulatedAt: string | null }[];
  _count: { agenda: number; invitees: number; items: number; documents: number };
}

export interface CarriedItem {
  revisedDue: string | null;
  item: {
    id: string;
    ref: string;
    type: ItemType;
    description: string;
    dueDate: string | null;
    actionStatus: ActionStatus | null;
    clarificationStatus: ClarificationStatus | null;
    carryCount: number;
  };
}

export interface AgendaRow {
  id: string;
  ordinal: number;
  text: string;
  projectId: string | null;
  isCarryBlock: boolean;
  isDeferred: boolean;
  carriedItems: CarriedItem[];
}

export interface InviteeRow {
  id: string;
  rsvp: RsvpResponse | null;
  attendance: AttendanceMark | null;
  isWalkIn: boolean;
  user: Person;
}

export interface MeetingDetail extends MeetingRow {
  agenda: AgendaRow[];
  invitees: InviteeRow[];
  minutes: { id: string; lockedAt: string | null; updatedAt: string } | null;
}

export interface ItemRow {
  id: string;
  ref: string;
  type: ItemType;
  description: string;
  remarks: string | null;
  dueDate: string | null;
  originalDue: string | null;
  priority: Priority | null;
  actionStatus: ActionStatus | null;
  clarificationStatus: ClarificationStatus | null;
  activatedAt: string | null;
  carryCount: number;
  daysOverdue: number;
  awaitingConfirmation: boolean;
  isActive: boolean;
  project: { id: string; code: string; name: string };
  meeting: { id: string; code: string; title: string; meetingDate: string; type: MeetingType };
  raisedBy: { id: string; name: string; initials: string };
  respondedBy: { id: string; name: string; initials: string } | null;
  owners: { user: Person }[];
  _count: { updates: number; documents: number };
}

export interface MomRow {
  id: string;
  state: MomState;
  version: number;
  signedFileId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  circulatedAt: string | null;
  correctsMomId: string | null;
  meeting: {
    id: string;
    code: string;
    title: string;
    type: MeetingType;
    meetingDate: string;
    stage: MeetingStage;
    projects: { project: { id: string; code: string; name: string } }[];
  };
}

export interface MomHistoryRow {
  id: string;
  event: string;
  version: number;
  remark: string | null;
  createdAt: string;
  actor: { id: string; name: string; initials: string; designation: { code: string } } | null;
}

/** `12:30` on a date the officer can read, for the list rows. */
export function timeRange(m: { startTime: string; endTime: string }): string {
  return `${m.startTime} – ${m.endTime}`;
}

/**
 * What this meeting is waiting for, in the words the coordinator would use.
 *
 * The stage label says where it is; this says what to do about it, which is the
 * question a list of thirty meetings actually has to answer.
 */
export function nextStep(m: MeetingRow): string {
  const mom = m.moms[0];
  switch (m.stage) {
    case 'PLANNED':
      return 'Add the details';
    case 'AGENDA':
      return 'Draft the agenda';
    case 'INVITEES':
      return 'Add the invitees';
    case 'INVITEE_INPUTS':
      return 'Confirm it, and the agenda goes out';
    case 'CONFIRMED':
      return 'Waiting for the meeting';
    case 'COMPOSED':
      return 'Launch it';
    case 'LIVE':
      return 'In progress — end it when you are done';
    case 'HELD':
      return 'Record attendance';
    case 'MINUTED':
      if (!mom || mom.state === 'NOT_GENERATED') return 'Write the minutes, then generate the MoM';
      if (mom.state === 'DRAFT') return 'Submit the MoM for approval';
      if (mom.state === 'SUBMITTED') return 'Waiting for approval';
      if (mom.state === 'RETURNED') return 'Returned — act on the remark';
      if (mom.state === 'APPROVED') return 'Upload the signed copy and circulate';
      return 'Circulate the signed MoM';
    case 'CLOSED':
      return 'Closed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return '';
  }
}
