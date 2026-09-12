import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CancelDto,
  CreateMeetingDto,
  MeetingStage,
  RescheduleDto,
  UpdateMeetingDto,
} from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { canSeeProject, meetingScope, scopedProjectIds } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { advanceMonotonic, isPlanning, nextStage } from './meeting.machine.js';
import { formatMeetingCode, kindFor, meetingScopeFor, nextMeetingNumber } from './meeting-code.js';

const LIST_SELECT = {
  id: true,
  code: true,
  type: true,
  category: true,
  title: true,
  meetingDate: true,
  startTime: true,
  endTime: true,
  venue: true,
  vcLink: true,
  stage: true,
  agendaFreezeAt: true,
  confirmedAt: true,
  cancelledReason: true,
  chair: { select: { id: true, name: true, initials: true, designation: { select: { code: true, name: true } } } },
  createdBy: { select: { id: true, name: true, initials: true } },
  projects: { select: { project: { select: { id: true, code: true, name: true } } } },
  // Newest version only: a meeting with a corrigendum has more than one row,
  // and the list shows the document currently in force.
  moms: {
    select: { id: true, state: true, version: true, circulatedAt: true, correctsMomId: true },
    orderBy: { version: 'desc' },
    take: 1,
  },
  _count: { select: { agenda: true, invitees: true, items: true, documents: true } },
} satisfies Prisma.MeetingSelect;

export interface MeetingQuery {
  type?: string;
  category?: string;
  projectId?: string;
  stage?: string;
  q?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NotificationsService,
  ) {}

  // ── reading ──────────────────────────────────────────────────────────

  async list(user: AuthUser, query: MeetingQuery = {}) {
    const where: Prisma.MeetingWhereInput = { ...meetingScope(user) };

    if (query.type) where.type = query.type as Prisma.MeetingWhereInput['type'];
    if (query.category) where.category = query.category as Prisma.MeetingWhereInput['category'];
    if (query.stage) where.stage = { in: query.stage.split(',') as MeetingStage[] };
    if (query.projectId) {
      // Narrowing to one project must not widen scope: the scope clause above
      // still applies, and an out-of-scope id simply matches nothing.
      if (!canSeeProject(user, query.projectId)) return [];
      where.projects = { some: { projectId: query.projectId } };
    }
    if (query.from || query.to) {
      where.meetingDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { code: { contains: query.q, mode: 'insensitive' } },
        { venue: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.meeting.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ meetingDate: 'desc' }, { startTime: 'desc' }],
    });
  }

  /** The full aggregate behind the five tabs. */
  async get(user: AuthUser, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id }, meetingScope(user)] },
      select: {
        ...LIST_SELECT,
        createdAt: true,
        agenda: {
          select: {
            id: true,
            ordinal: true,
            text: true,
            isCarryBlock: true,
            isDeferred: true,
            projectId: true,
            carriedItems: {
              select: {
                revisedDue: true,
                item: {
                  select: {
                    id: true,
                    ref: true,
                    type: true,
                    description: true,
                    dueDate: true,
                    actionStatus: true,
                    clarificationStatus: true,
                    carryCount: true,
                  },
                },
              },
            },
          },
          orderBy: { ordinal: 'asc' },
        },
        invitees: {
          select: {
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
                designation: { select: { code: true, name: true, band: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
        minutes: { select: { id: true, lockedAt: true, updatedAt: true } },
      },
    });
    if (!meeting) throw AppError.notFound('That meeting');
    return meeting;
  }

  /** The row plus the fields the services need, scope already applied. */
  async mustSee(user: AuthUser, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id }, meetingScope(user)] },
      select: {
        id: true,
        code: true,
        type: true,
        title: true,
        stage: true,
        meetingDate: true,
        agendaFreezeAt: true,
        chairId: true,
        projects: { select: { projectId: true } },
        invitees: { select: { userId: true } },
      },
    });
    if (!meeting) throw AppError.notFound('That meeting');
    return meeting;
  }

  // ── creating and editing ─────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateMeetingDto) {
    // Every project must be one the caller can see, or a coordinator could
    // create a meeting on a project they have no business knowing exists.
    for (const projectId of dto.projectIds) {
      if (!canSeeProject(user, projectId)) throw AppError.notFound('One of those projects');
    }

    const projects = await this.prisma.project.findMany({
      where: { id: { in: dto.projectIds } },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    if (projects.length !== dto.projectIds.length) {
      throw AppError.notFound('One of those projects');
    }

    await this.mustBeInvitable(dto.chairId);

    const scope = meetingScopeFor(projects.map((p) => p.code));
    const kind = kindFor(dto.type);
    const stage: MeetingStage = dto.type === 'INSTANT' ? 'COMPOSED' : 'PLANNED';

    // Two coordinators creating a meeting on the same project in the same
    // second would otherwise race for a number. The unique index on `code` is
    // the real defence; this retries around it rather than failing the user.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.prisma.meeting.findMany({
        where: { code: { startsWith: `UCF/${scope}/${kind}-` } },
        select: { code: true },
      });
      const code = formatMeetingCode(
        scope,
        kind,
        nextMeetingNumber(existing.map((m) => m.code), scope, kind),
      );

      try {
        return await this.prisma.meeting.create({
          data: {
            code,
            type: dto.type,
            category: dto.category,
            title: dto.title,
            meetingDate: new Date(dto.meetingDate),
            startTime: dto.startTime,
            endTime: dto.endTime,
            venue: dto.venue,
            vcLink: dto.vcLink || null,
            chairId: dto.chairId,
            createdById: user.id,
            stage,
            projects: { create: dto.projectIds.map((projectId) => ({ projectId })) },
            // The chair is always an invitee. A meeting whose chairperson is not
            // on the list would drop them from every notification and from the
            // attendance sheet.
            invitees: { create: [{ userId: dto.chairId }] },
          },
          select: LIST_SELECT,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new AppError('INTERNAL', 'Could not allocate a meeting reference. Try again.');
  }

  async update(user: AuthUser, id: string, dto: UpdateMeetingDto) {
    const meeting = await this.mustSee(user, id);

    // Details are editable while planning. After confirmation the date moves
    // only through `reschedule`, which notifies; a silent PATCH would leave
    // everyone holding the old time.
    if (!isPlanning(meeting.stage)) {
      throw new AppError(
        'INVALID_TRANSITION',
        meeting.stage === 'CANCELLED'
          ? 'This meeting was cancelled. Its record is kept as it was.'
          : 'This meeting is confirmed. Use reschedule to move it, so everyone is told.',
        { from: meeting.stage, to: meeting.stage },
      );
    }

    if (dto.projectIds) {
      for (const projectId of dto.projectIds) {
        if (!canSeeProject(user, projectId)) throw AppError.notFound('One of those projects');
      }
    }
    if (dto.chairId) await this.mustBeInvitable(dto.chairId);

    const stage =
      meeting.type === 'SCHEDULED'
        ? advanceMonotonic('SCHEDULED', meeting.stage, 'saveDetails')
        : meeting.stage;

    return this.prisma.$transaction(async (tx) => {
      if (dto.projectIds) {
        await tx.meetingProject.deleteMany({ where: { meetingId: id } });
        await tx.meetingProject.createMany({
          data: dto.projectIds.map((projectId) => ({ meetingId: id, projectId })),
        });
      }
      if (dto.chairId && dto.chairId !== meeting.chairId) {
        await tx.meetingInvitee.upsert({
          where: { meetingId_userId: { meetingId: id, userId: dto.chairId } },
          create: { meetingId: id, userId: dto.chairId },
          update: {},
        });
      }
      return tx.meeting.update({
        where: { id },
        data: {
          ...(dto.category ? { category: dto.category } : {}),
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.meetingDate ? { meetingDate: new Date(dto.meetingDate) } : {}),
          ...(dto.startTime ? { startTime: dto.startTime } : {}),
          ...(dto.endTime ? { endTime: dto.endTime } : {}),
          ...(dto.venue ? { venue: dto.venue } : {}),
          ...(dto.vcLink !== undefined ? { vcLink: dto.vcLink || null } : {}),
          ...(dto.chairId ? { chairId: dto.chairId } : {}),
          stage,
        },
        select: LIST_SELECT,
      });
    });
  }

  // ── the instant journey ──────────────────────────────────────────────

  /**
   * Launch requires a title, one project and one invitee — and nothing else.
   * The whole point of an instant meeting is that it starts before anyone has
   * time to fill a form; venue and category can be corrected afterwards.
   */
  async launch(user: AuthUser, id: string) {
    const meeting = await this.mustSee(user, id);
    this.mustBeInstant(meeting.type);
    const to = this.mustTransition(meeting.type, meeting.stage, 'launch');

    if (meeting.projects.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Name the project this meeting is about.');
    }
    if (meeting.invitees.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Add at least one person before launching.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meeting.update({
        where: { id },
        data: { stage: to },
        select: LIST_SELECT,
      });
      await this.events.emit(
        {
          eventCode: 'MTG-02',
          subjectType: 'MEETING',
          subjectId: id,
          subjectRef: meeting.code,
          templateKey: 'ucf_meeting_started',
          triggeredById: user.id,
          recipientIds: meeting.invitees.map((i) => i.userId),
          payload: { title: meeting.title, startedAt: new Date().toISOString() },
        },
        tx,
      );
      return updated;
    });
  }

  /** Ends an instant meeting, or marks a confirmed scheduled meeting as held. */
  async end(user: AuthUser, id: string) {
    const meeting = await this.mustSee(user, id);
    const to = this.mustTransition(meeting.type, meeting.stage, 'end');
    return this.prisma.meeting.update({
      where: { id },
      data: { stage: to },
      select: LIST_SELECT,
    });
  }

  // ── the scheduled journey ────────────────────────────────────────────

  /**
   * Confirmation is the Meeting Coordinator's, not an executive's — there is no
   * approval gate on a meeting (docs/05 §1). What it does gate is completeness:
   * an agenda, an invitee and a chairperson, because circulating an agenda with
   * nothing on it is worse than not circulating one.
   */
  async confirm(user: AuthUser, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id }, meetingScope(user)] },
      select: {
        id: true,
        code: true,
        type: true,
        title: true,
        stage: true,
        chairId: true,
        meetingDate: true,
        startTime: true,
        venue: true,
        agenda: { select: { id: true } },
        invitees: { select: { userId: true } },
      },
    });
    if (!meeting) throw AppError.notFound('That meeting');
    this.mustBeScheduled(meeting.type);
    const to = this.mustTransition(meeting.type, meeting.stage, 'confirm');

    const missing: string[] = [];
    if (meeting.agenda.length === 0) missing.push('at least one agenda point');
    if (meeting.invitees.length === 0) missing.push('at least one invitee');
    if (!meeting.chairId) missing.push('a chairperson');
    if (missing.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `This meeting still needs ${missing.join(', ')} before it can be confirmed.`,
        { missing },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meeting.update({
        where: { id },
        data: { stage: to, confirmedById: user.id, confirmedAt: new Date() },
        select: LIST_SELECT,
      });
      await this.events.emit(
        {
          eventCode: 'MTG-01',
          subjectType: 'MEETING',
          subjectId: id,
          subjectRef: meeting.code,
          templateKey: 'ucf_meeting_confirmed',
          triggeredById: user.id,
          recipientIds: meeting.invitees.map((i) => i.userId),
          payload: {
            title: meeting.title,
            meetingDate: meeting.meetingDate.toISOString().slice(0, 10),
            startTime: meeting.startTime,
            venue: meeting.venue,
          },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Reschedule keeps the code and the agenda, records the reason, and
   * re-notifies. It is a self-transition, not a trip back through planning:
   * an agenda that was frozen stays frozen.
   */
  async reschedule(user: AuthUser, id: string, dto: RescheduleDto) {
    const meeting = await this.mustSee(user, id);
    this.mustTransition(meeting.type, meeting.stage, 'reschedule');

    if (dto.endTime <= dto.startTime) {
      throw new AppError('VALIDATION_FAILED', 'The meeting must end after it starts.', {
        field: 'endTime',
      });
    }

    const from = meeting.meetingDate.toISOString().slice(0, 10);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meeting.update({
        where: { id },
        data: {
          meetingDate: new Date(dto.meetingDate),
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
        select: LIST_SELECT,
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MEETING',
          objectId: id,
          objectRef: meeting.code,
          event: 'MEETING_RESCHEDULED',
          // The reason is the point. A date that moved with no recorded reason
          // is the thing an auditor asks about first.
          detail: dto.reason,
          before: { meetingDate: from },
          after: { meetingDate: dto.meetingDate, startTime: dto.startTime, endTime: dto.endTime },
        },
      });
      await this.events.emit(
        {
          eventCode: 'MTG-07',
          subjectType: 'MEETING',
          subjectId: id,
          subjectRef: meeting.code,
          templateKey: 'ucf_meeting_rescheduled',
          triggeredById: user.id,
          recipientIds: meeting.invitees.map((i) => i.userId),
          payload: { from, to: dto.meetingDate, startTime: dto.startTime, reason: dto.reason },
        },
        tx,
      );
      return updated;
    });
  }

  /** A cancelled meeting keeps its record; it never disappears. */
  async cancel(user: AuthUser, id: string, dto: CancelDto) {
    const meeting = await this.mustSee(user, id);
    const to = this.mustTransition(meeting.type, meeting.stage, 'cancel');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meeting.update({
        where: { id },
        data: { stage: to, cancelledReason: dto.reason },
        select: LIST_SELECT,
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MEETING',
          objectId: id,
          objectRef: meeting.code,
          event: 'MEETING_CANCELLED',
          detail: dto.reason,
          before: { stage: meeting.stage },
          after: { stage: to },
        },
      });
      await this.events.emit(
        {
          eventCode: 'MTG-08',
          subjectType: 'MEETING',
          subjectId: id,
          subjectRef: meeting.code,
          templateKey: 'ucf_meeting_cancelled',
          triggeredById: user.id,
          recipientIds: meeting.invitees.map((i) => i.userId),
          payload: { title: meeting.title, reason: dto.reason },
        },
        tx,
      );
      return updated;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private mustTransition(
    type: 'INSTANT' | 'SCHEDULED',
    from: MeetingStage,
    action: Parameters<typeof nextStage>[2],
  ): MeetingStage {
    const to = nextStage(type, from, action);
    if (!to) throw AppError.badTransition(from, action);
    return to;
  }

  private mustBeInstant(type: string) {
    if (type !== 'INSTANT') {
      throw new AppError('INVALID_TRANSITION', 'Only an instant meeting can be launched.', {
        from: type,
        to: 'LIVE',
      });
    }
  }

  private mustBeScheduled(type: string) {
    if (type !== 'SCHEDULED') {
      throw new AppError(
        'INVALID_TRANSITION',
        'An instant meeting has no agenda to confirm — launch it instead.',
        { from: type, to: 'CONFIRMED' },
      );
    }
  }

  /**
   * A person may be named in a meeting whether or not they can sign in — an
   * external invitee is INVITE_ONLY by design. What they may not be is
   * suspended, which is an explicit decision that they are out.
   */
  private async mustBeInvitable(userId: string) {
    const person = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, accountState: true },
    });
    if (!person) throw AppError.notFound('That officer');
    if (person.accountState === 'SUSPENDED') {
      throw new AppError('VALIDATION_FAILED', `${person.name}'s account is suspended.`);
    }
    return person;
  }

  /** Project ids in scope for this caller, for the carry-forward query. */
  scopeIds(user: AuthUser): string[] | null {
    return scopedProjectIds(user);
  }
}
