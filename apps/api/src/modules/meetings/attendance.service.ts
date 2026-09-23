import { Injectable, Logger } from '@nestjs/common';
import type { AttendanceDto, InviteesDto, RsvpDto } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { visibleUsersScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MeetingsService } from './meetings.service.js';
import { advanceMonotonic, isHeldOrLater } from './meeting.machine.js';
import type { ExternalInviteeDto } from './external-invitee.dto.js';

/** Where people who belong to no arm of the mission are filed. */
const EXTERNAL_DEPARTMENT = 'External';

/**
 * Initials from a name, for the avatar. Three characters, because the column
 * is three: "K. Ramesh" gives KR, "Sri Lakshmi Narayana Rao" gives SLN.
 *
 * Non-letters are dropped rather than abbreviated — an initial of "." on an
 * attendance sheet looks like a defect, and a name typed as "Dr. K. Ramesh"
 * is entirely ordinary here.
 */
function initialsFor(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, '').charAt(0))
    .filter(Boolean)
    .join('')
    .toUpperCase();
  // A name that is all punctuation cannot happen past the DTO's min(2), but
  // a single-character initial is legal and "?" beats an empty column.
  return (letters || name.trim().charAt(0).toUpperCase() || '?').slice(0, 3);
}

const INVITEE_SELECT = {
  id: true,
  rsvp: true,
  attendance: true,
  isWalkIn: true,
  user: {
    select: {
      id: true,
      name: true,
      initials: true,
      email: true,
      mobile: true,
      accountState: true,
      designation: { select: { code: true, name: true, band: true } },
      department: { select: { name: true } },
    },
  },
};

@Injectable()
export class AttendanceService {
  private readonly log = new Logger('Invitees');

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
    private readonly events: NotificationsService,
  ) {}

  async list(user: AuthUser, meetingId: string) {
    await this.meetings.mustSee(user, meetingId);
    return this.prisma.meetingInvitee.findMany({
      where: { meetingId },
      select: INVITEE_SELECT,
      orderBy: [{ isWalkIn: 'asc' }, { user: { name: 'asc' } }],
    });
  }

  /**
   * Replaces the invitee set, keeping the chairperson and anyone who has
   * already answered or attended.
   *
   * Dropping someone who has already RSVP'd or been marked present would throw
   * away a record of what happened, and on a held meeting it would rewrite the
   * attendance sheet after the fact.
   */
  async setInvitees(user: AuthUser, meetingId: string, dto: InviteesDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);

    // You cannot invite someone you cannot see — the same rule as sharing.
    const visible = await this.prisma.user.findMany({
      where: { AND: [{ id: { in: dto.userIds } }, visibleUsersScope(user)] },
      select: { id: true, accountState: true, name: true },
    });
    if (visible.length !== new Set(dto.userIds).size) {
      throw AppError.notFound('One of those officers');
    }
    const suspended = visible.find((v) => v.accountState === 'SUSPENDED');
    if (suspended) {
      throw new AppError('VALIDATION_FAILED', `${suspended.name}'s account is suspended.`);
    }

    const wanted = new Set([...dto.userIds, meeting.chairId]);
    const existing = await this.prisma.meetingInvitee.findMany({
      where: { meetingId },
      select: { id: true, userId: true, rsvp: true, attendance: true, isWalkIn: true },
    });

    const keep = existing.filter(
      (e) => wanted.has(e.userId) || e.rsvp !== null || e.attendance !== null || e.isWalkIn,
    );
    const remove = existing.filter((e) => !keep.includes(e));
    const add = [...wanted].filter((id) => !existing.some((e) => e.userId === id));

    await this.prisma.$transaction(async (tx) => {
      if (remove.length > 0) {
        await tx.meetingInvitee.deleteMany({ where: { id: { in: remove.map((r) => r.id) } } });
      }
      if (add.length > 0) {
        await tx.meetingInvitee.createMany({
          data: add.map((userId) => ({ meetingId, userId })),
        });
      }
      if (meeting.type === 'SCHEDULED') {
        const stage = advanceMonotonic('SCHEDULED', meeting.stage, 'addInvitees');
        await tx.meeting.update({
          where: { id: meetingId },
          data: {
            stage,
            // The freeze is set the moment invitees exist, because that is when
            // they can start contributing: 24 hours before the meeting starts.
            ...(meeting.agendaFreezeAt
              ? {}
              : { agendaFreezeAt: freezeAt(meeting.meetingDate) }),
          },
        });
      }
    });

    return this.list(user, meetingId);
  }

  /**
   * Adds somebody who is not on the system, and invites them.
   *
   * The PRD's External invitee: a banker or a corporation engineer who
   * receives notifications and is named in attendance, and never signs in.
   * They become a real person record, because everything downstream — the
   * attendance sheet, the MoM, the circulation log — is keyed on one, and a
   * name held loose on the invitee row would be absent from all of it.
   *
   * What makes them unable to act, belt and braces:
   *   - the EXT designation, whose capability row is empty;
   *   - no password, so `accountState` is INVITE_ONLY;
   *   - and, decisively, no email — `resolveUser` refuses a session to
   *     anyone without one, so even an address added later is not a login
   *     until somebody deliberately sets a password.
   *
   * The typed designation is kept in `title` and printed in place of the
   * designation's own name. `designationId` still points at a real row,
   * because capability is read from there and a typed string cannot answer
   * the question.
   */
  async addExternalInvitee(user: AuthUser, meetingId: string, dto: ExternalInviteeDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    if (isHeldOrLater(meeting.stage)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This meeting has already been held. Add somebody who turned up as a walk-in instead.',
      );
    }

    const designation = await this.prisma.designation.findUnique({
      where: { code: 'EXT' },
      select: { id: true },
    });
    if (!designation) {
      // Seeded master data; if it is missing the installation is incomplete
      // and saying so beats creating a designation nobody configured.
      throw new AppError(
        'INTERNAL',
        'The External invitee designation is missing from the master data, so external people cannot be added. Restore it under People > Designations.',
      );
    }

    if (dto.email) {
      const clash = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true, name: true },
      });
      if (clash) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${clash.name} already uses that email address. Invite them from the list instead of adding them again.`,
          { field: 'email' },
        );
      }
    }

    const departmentId = await this.externalDepartmentId();

    const created = await this.prisma.$transaction(async (tx) => {
      const person = await tx.user.create({
        data: {
          name: dto.name,
          initials: initialsFor(dto.name),
          email: dto.email ?? null,
          mobile: dto.mobile ?? null,
          title: dto.designation,
          designationId: designation.id,
          departmentId,
          accountState: 'INVITE_ONLY',
          passwordHash: null,
        },
        select: { id: true, name: true },
      });

      await tx.meetingInvitee.create({ data: { meetingId, userId: person.id } });

      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MEETING',
          objectId: meetingId,
          objectRef: meeting.code,
          event: 'EXTERNAL_INVITEE_ADDED',
          detail: `${dto.name} (${dto.designation}) added as an external invitee`,
          after: {
            userId: person.id,
            name: dto.name,
            title: dto.designation,
            email: dto.email ?? null,
            mobile: dto.mobile ?? null,
          },
        },
      });

      if (meeting.type === 'SCHEDULED') {
        await tx.meeting.update({
          where: { id: meetingId },
          data: {
            stage: advanceMonotonic('SCHEDULED', meeting.stage, 'addInvitees'),
            ...(meeting.agendaFreezeAt ? {} : { agendaFreezeAt: freezeAt(meeting.meetingDate) }),
          },
        });
      }

      return person;
    });

    this.log.log(`${meeting.code}: external invitee ${created.name} added`);
    return this.list(user, meetingId);
  }

  /**
   * The department external people are filed under.
   *
   * `users.department_id` is required and an external belongs to no arm of
   * the mission, so one well-known row holds them all. Created on first use
   * rather than seeded, so an existing installation needs no migration and
   * an office that never adds an external never grows the row.
   */
  private async externalDepartmentId(): Promise<string> {
    const found = await this.prisma.department.findUnique({
      where: { name: EXTERNAL_DEPARTMENT },
      select: { id: true },
    });
    if (found) return found.id;
    const made = await this.prisma.department.create({
      data: { name: EXTERNAL_DEPARTMENT },
      select: { id: true },
    });
    return made.id;
  }

  /** Your own response, and nobody else's. */
  async rsvp(user: AuthUser, meetingId: string, dto: RsvpDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    if (meeting.type === 'INSTANT') {
      throw new AppError('VALIDATION_FAILED', 'An instant meeting has no RSVP — it is already under way.');
    }

    const row = await this.prisma.meetingInvitee.findUnique({
      where: { meetingId_userId: { meetingId, userId: user.id } },
      select: { id: true },
    });
    if (!row) throw AppError.notFound('Your invitation to that meeting');

    await this.prisma.meetingInvitee.update({
      where: { id: row.id },
      data: { rsvp: dto.response },
    });
    return this.list(user, meetingId);
  }

  /**
   * Attendance can only be recorded once the meeting has happened.
   *
   * Saving it is also what starts the minutes: the MoM cannot be generated
   * until every invitee is marked, so the two belong to the same moment.
   */
  async setAttendance(user: AuthUser, meetingId: string, dto: AttendanceDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    if (!isHeldOrLater(meeting.stage)) {
      throw new AppError(
        'INVALID_TRANSITION',
        'Attendance is recorded after the meeting has been held.',
        { from: meeting.stage, to: 'HELD' },
      );
    }

    const invitees = await this.prisma.meetingInvitee.findMany({
      where: { meetingId },
      select: { id: true, userId: true },
    });
    const byUser = new Map(invitees.map((i) => [i.userId, i.id]));

    const unknown = Object.keys(dto.marks).filter((userId) => !byUser.has(userId));
    if (unknown.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Someone in that list was not invited to this meeting. Add them as a walk-in first.',
        { userIds: unknown },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [userId, mark] of Object.entries(dto.marks)) {
        await tx.meetingInvitee.update({
          where: { id: byUser.get(userId) as string },
          data: { attendance: mark },
        });
      }
      if (meeting.stage === 'HELD') {
        await tx.meeting.update({
          where: { id: meetingId },
          data: { stage: advanceMonotonic(meeting.type, meeting.stage, 'startMinutes') },
        });
      }
    });

    return this.list(user, meetingId);
  }

  /**
   * Someone who turned up without being invited. They are marked as a walk-in
   * permanently: the MoM distinguishes "invited and present" from "attended",
   * and collapsing the two would misrepresent who the meeting was called for.
   */
  async walkIn(user: AuthUser, meetingId: string, userId: string) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    if (!isHeldOrLater(meeting.stage) && meeting.stage !== 'LIVE') {
      throw new AppError(
        'INVALID_TRANSITION',
        'A walk-in can only be added to a meeting that is under way or has been held.',
        { from: meeting.stage, to: 'HELD' },
      );
    }

    const person = await this.prisma.user.findFirst({
      where: { AND: [{ id: userId }, visibleUsersScope(user)] },
      select: { id: true, name: true },
    });
    if (!person) throw AppError.notFound('That officer');

    await this.prisma.meetingInvitee.upsert({
      where: { meetingId_userId: { meetingId, userId } },
      create: { meetingId, userId, isWalkIn: true, attendance: 'PRESENT' },
      update: { attendance: 'PRESENT' },
    });
    return this.list(user, meetingId);
  }

  /** Every invitee marked — the precondition for generating the MoM. */
  async attendanceComplete(meetingId: string): Promise<{ complete: boolean; unmarked: string[] }> {
    const rows = await this.prisma.meetingInvitee.findMany({
      where: { meetingId },
      select: { attendance: true, user: { select: { name: true } } },
    });
    const unmarked = rows.filter((r) => r.attendance === null).map((r) => r.user.name);
    return { complete: rows.length > 0 && unmarked.length === 0, unmarked };
  }

  /** Recipients for a meeting-wide notification. */
  async recipients(meetingId: string): Promise<string[]> {
    const rows = await this.prisma.meetingInvitee.findMany({
      where: { meetingId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** Not used yet; Phase 5's agenda-freeze job calls it. Kept beside the rule it enforces. */
  static freezeAt = freezeAt;
}

/** 24 hours before the meeting date, at the start of that day's business. */
function freezeAt(meetingDate: Date): Date {
  const freeze = new Date(meetingDate);
  freeze.setUTCDate(freeze.getUTCDate() - 1);
  freeze.setUTCHours(12, 0, 0, 0);
  return freeze;
}
