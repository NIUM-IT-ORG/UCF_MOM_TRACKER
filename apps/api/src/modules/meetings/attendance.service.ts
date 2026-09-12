import { Injectable } from '@nestjs/common';
import type { AttendanceDto, InviteesDto, RsvpDto } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { visibleUsersScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MeetingsService } from './meetings.service.js';
import { advanceMonotonic, isHeldOrLater } from './meeting.machine.js';

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
