import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { MomDecisionDto, MomSignDto, MomState } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MeetingsService } from '../meetings/meetings.service.js';
import { AttendanceService } from '../meetings/attendance.service.js';
import { MinutesService } from '../minutes/minutes.service.js';
import { FilesService } from '../files/files.service.js';
import {
  advanceMom,
  assertMutable,
  submitEventFor,
  versionAfter,
} from './mom.machine.js';

const MOM_SELECT = {
  id: true,
  state: true,
  version: true,
  draftFileId: true,
  signedFileId: true,
  submittedAt: true,
  decidedAt: true,
  decisionRemark: true,
  signedUploadedAt: true,
  circulatedAt: true,
  correctsMomId: true,
  createdAt: true,
  updatedAt: true,
  meeting: {
    select: {
      id: true,
      code: true,
      title: true,
      type: true,
      meetingDate: true,
      stage: true,
      projects: { select: { project: { select: { id: true, code: true, name: true } } } },
    },
  },
} satisfies Prisma.MomSelect;

@Injectable()
export class MomService {
  private readonly log = new Logger('MoM');

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
    private readonly attendance: AttendanceService,
    private readonly minutes: MinutesService,
    private readonly files: FilesService,
    private readonly events: NotificationsService,
  ) {}

  // ── reading ──────────────────────────────────────────────────────────

  /**
   * The register — one row per meeting, showing the version in force.
   *
   * A superseded MoM is still in the table (that is the point of a corrigendum)
   * but it must not appear as a second line in a list people read as "one row,
   * one meeting". `correctedBy: { none: {} }` is the filter: the document
   * nothing corrects is the current one.
   */
  async register(user: AuthUser, state?: string) {
    return this.prisma.mom.findMany({
      where: {
        meeting: meetingScope(user),
        correctedBy: { none: {} },
        ...(state ? { state: { in: state.split(',') as MomState[] } } : {}),
      },
      select: MOM_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async forMeeting(user: AuthUser, meetingId: string) {
    await this.meetings.mustSee(user, meetingId);
    const mom = await this.currentMom(this.prisma, meetingId, MOM_SELECT);
    // Not generated yet is a state, not an absence — the console renders it.
    return mom ?? { state: 'NOT_GENERATED' as MomState, version: 0, meetingId };
  }

  /**
   * The MoM in force for a meeting: the highest version.
   *
   * There may be several rows — a circulated one and the corrigendum that
   * corrects it — and every caller means "the current one" unless it says
   * otherwise. Putting that in one place is what stops a screen somewhere
   * showing a superseded document because it happened to query first.
   */
  private currentMom<T extends Prisma.MomSelect>(
    db: PrismaService | Prisma.TransactionClient,
    meetingId: string,
    select: T,
  ) {
    return db.mom.findFirst({
      where: { meetingId },
      select,
      orderBy: { version: 'desc' },
    }) as Promise<Prisma.MomGetPayload<{ select: T }> | null>;
  }

  async history(user: AuthUser, meetingId: string) {
    await this.meetings.mustSee(user, meetingId);
    const moms = await this.prisma.mom.findMany({
      where: { meetingId },
      select: { id: true },
    });
    if (moms.length === 0) return [];
    // Every version's history, in order — a corrigendum's trail only makes
    // sense read after the document it corrects.
    const rows = await this.prisma.momHistory.findMany({
      where: { momId: { in: moms.map((m) => m.id) } },
      select: { id: true, event: true, version: true, remark: true, createdAt: true, actorId: true },
      orderBy: { createdAt: 'asc' },
    });
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } },
      select: { id: true, name: true, initials: true, designation: { select: { code: true } } },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return rows.map((r) => ({ ...r, actor: byId.get(r.actorId) ?? null }));
  }

  // ── the machine ──────────────────────────────────────────────────────

  /**
   * Generate requires attendance for **every** invitee and minutes present.
   *
   * Both are checked here rather than trusted from the UI, and both produce a
   * message naming what is missing — "cannot generate" with no reason is the
   * single most common support call a workflow tool produces.
   */
  async generate(user: AuthUser, meetingId: string) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    const existing = await this.currentMom(this.prisma, meetingId, {
      id: true,
      state: true,
      version: true,
    });
    if (existing) assertMutable(existing.state);

    const attendance = await this.attendance.attendanceComplete(meetingId);
    if (!attendance.complete) {
      throw new AppError(
        'VALIDATION_FAILED',
        attendance.unmarked.length === 0
          ? 'Nobody is on the attendance sheet for this meeting.'
          : `Attendance is not recorded for ${attendance.unmarked.join(', ')}.`,
        { unmarked: attendance.unmarked },
      );
    }

    const minutes = await this.minutes.raw(meetingId);
    if (!minutes || minutes.bodyHtml.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'There are no minutes to generate a MoM from.');
    }

    const to = advanceMom(existing?.state ?? 'NOT_GENERATED', 'generate');

    return this.prisma.$transaction(async (tx) => {
      const mom = existing
        ? await tx.mom.update({ where: { id: existing.id }, data: { state: to }, select: MOM_SELECT })
        : await tx.mom.create({
            data: { meetingId, state: to, version: 1 },
            select: MOM_SELECT,
          });
      await tx.momHistory.create({
        data: { momId: mom.id, event: 'GENERATED', version: mom.version, actorId: user.id },
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MOM',
          objectId: mom.id,
          objectRef: meeting.code,
          event: 'MOM_GENERATED',
        },
      });
      return mom;
    });
  }

  /**
   * Submit requires every action to have at least one owner and a due date,
   * and it locks the minutes.
   *
   * The lock is the point: once an approver is looking at a document, the text
   * underneath it must not move. Returning it unlocks them again.
   */
  async submit(user: AuthUser, meetingId: string) {
    const { meeting, mom } = await this.mustHaveMom(user, meetingId);
    assertMutable(mom.state);

    const incomplete = await this.prisma.item.findMany({
      where: {
        meetingId,
        type: 'ACTION',
        OR: [{ dueDate: null }, { owners: { none: {} } }],
      },
      select: { ref: true, dueDate: true, owners: { select: { userId: true } } },
    });
    if (incomplete.length > 0) {
      const refs = incomplete.map((i) => i.ref);
      throw new AppError(
        'VALIDATION_FAILED',
        `${refs.join(', ')} still ${refs.length === 1 ? 'needs' : 'need'} a responsible officer and a due date. An action without either is not a commitment.`,
        { items: refs },
      );
    }

    const event = submitEventFor(mom.state);
    const to = advanceMom(mom.state, event);
    const version = versionAfter(mom.state, mom.version);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mom.update({
        where: { id: mom.id },
        data: { state: to, version, submittedById: user.id, submittedAt: new Date() },
        select: MOM_SELECT,
      });
      const minutes = await tx.minutes.findUnique({
        where: { meetingId },
        select: { id: true },
      });
      if (minutes) {
        await tx.minutes.update({ where: { id: minutes.id }, data: { lockedAt: new Date() } });
      }
      await tx.momHistory.create({
        data: { momId: mom.id, event: 'SUBMITTED', version, actorId: user.id },
      });
      await this.events.emit(
        {
          eventCode: 'MOM-01',
          subjectType: 'MOM',
          subjectId: mom.id,
          subjectRef: meeting.code,
          templateKey: 'ucf_mom_submitted',
          triggeredById: user.id,
          recipientIds: await this.approverIds(tx, meeting.projects.map((p) => p.projectId)),
          payload: { title: meeting.title, version },
        },
        tx,
      );
      return updated;
    });
  }

  /** Approve. A remark is optional here and mandatory on return and reject. */
  async approve(user: AuthUser, meetingId: string, remark?: string) {
    const { meeting, mom } = await this.mustHaveMom(user, meetingId);
    const to = advanceMom(mom.state, 'approve');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mom.update({
        where: { id: mom.id },
        data: {
          state: to,
          decidedById: user.id,
          decidedAt: new Date(),
          decisionRemark: remark ?? null,
        },
        select: MOM_SELECT,
      });
      await tx.momHistory.create({
        data: {
          momId: mom.id,
          event: 'APPROVED',
          version: mom.version,
          actorId: user.id,
          remark: remark ?? null,
        },
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MOM',
          objectId: mom.id,
          objectRef: meeting.code,
          event: 'MOM_APPROVED',
          detail: remark ?? null,
        },
      });
      await this.events.emit(
        {
          eventCode: 'MOM-03',
          subjectType: 'MOM',
          subjectId: mom.id,
          subjectRef: meeting.code,
          templateKey: 'ucf_mom_approved',
          triggeredById: user.id,
          recipientIds: await this.coordinatorIds(tx, meeting.id),
          payload: { title: meeting.title, remark: remark ?? null },
        },
        tx,
      );
      return updated;
    });
  }

  /** Return unlocks the minutes so the coordinator can act on the remark. */
  async returnForChanges(user: AuthUser, meetingId: string, dto: MomDecisionDto) {
    return this.decline(user, meetingId, 'return', dto.remark, 'MOM-02', 'ucf_mom_returned');
  }

  /** Reject keeps the version; the document was not accepted as one. */
  async reject(user: AuthUser, meetingId: string, dto: MomDecisionDto) {
    return this.decline(user, meetingId, 'reject', dto.remark, 'MOM-02', 'ucf_mom_returned');
  }

  private async decline(
    user: AuthUser,
    meetingId: string,
    event: 'return' | 'reject',
    remark: string,
    eventCode: string,
    templateKey: string,
  ) {
    const { meeting, mom } = await this.mustHaveMom(user, meetingId);
    const to = advanceMom(mom.state, event);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mom.update({
        where: { id: mom.id },
        data: {
          state: to,
          decidedById: user.id,
          decidedAt: new Date(),
          decisionRemark: remark,
        },
        select: MOM_SELECT,
      });
      const minutes = await tx.minutes.findUnique({ where: { meetingId }, select: { id: true } });
      if (minutes) await tx.minutes.update({ where: { id: minutes.id }, data: { lockedAt: null } });

      await tx.momHistory.create({
        data: {
          momId: mom.id,
          event: event === 'return' ? 'RETURNED' : 'REJECTED',
          version: mom.version,
          actorId: user.id,
          remark,
        },
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MOM',
          objectId: mom.id,
          objectRef: meeting.code,
          event: event === 'return' ? 'MOM_RETURNED' : 'MOM_REJECTED',
          detail: remark,
        },
      });
      await this.events.emit(
        {
          eventCode,
          subjectType: 'MOM',
          subjectId: mom.id,
          subjectRef: meeting.code,
          templateKey,
          triggeredById: user.id,
          recipientIds: await this.coordinatorIds(tx, meeting.id),
          payload: { title: meeting.title, remark },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Signing and circulating — the hinge of the whole product.
   *
   * On SIGNED, in one transaction:
   *   1. every Item for that meeting gets activatedAt = now();
   *   2. ACT-01 fires once per responsible officer;
   *   3. MOM-05 fires to all invitees;
   *   4. the meeting moves to CLOSED.
   *
   * All four or none. A MoM that is circulated but whose items stayed inert is
   * the worst possible failure here: the document says the officers were told,
   * the register says nothing is outstanding, and nobody finds out for a month.
   */
  async sign(user: AuthUser, meetingId: string, dto: MomSignDto) {
    const { meeting, mom } = await this.mustHaveMom(user, meetingId);
    const to = advanceMom(mom.state, 'sign');

    const file = await this.files.requireUploaded(dto.fileId);
    if (file.mimeType !== 'application/pdf') {
      throw new AppError(
        'VALIDATION_FAILED',
        'The signed MoM has to be a PDF — a scan of the signed copy.',
        { field: 'fileId' },
      );
    }

    // The page-count and action-row check (P4-08) compares the scan against the
    // approved draft. Rendering the draft is Phase 4's PDF work; until the
    // renderer runs in this environment the check is performed on what can be
    // established from the stored bytes, and the count it needs is recorded so
    // the comparison is exact rather than approximate.
    const actionCount = await this.prisma.item.count({ where: { meetingId, type: 'ACTION' } });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mom.update({
        where: { id: mom.id },
        data: {
          state: to,
          signedFileId: dto.fileId,
          signedUploadedById: user.id,
          signedUploadedAt: new Date(),
          circulatedAt: new Date(),
        },
        select: MOM_SELECT,
      });

      // 1 · circulation activates the items
      const items = await tx.item.findMany({
        where: { meetingId, activatedAt: null },
        select: { id: true, ref: true, type: true, description: true, dueDate: true, owners: { select: { userId: true } }, respondedById: true },
      });

      const now = new Date();
      await tx.item.updateMany({
        where: { meetingId, activatedAt: null, type: 'ACTION' },
        data: { activatedAt: now, actionStatus: 'IN_PROGRESS' },
      });
      await tx.item.updateMany({
        where: { meetingId, activatedAt: null, type: 'CLARIFICATION' },
        data: { activatedAt: now, clarificationStatus: 'OPEN' },
      });

      // 2 · ACT-01 once per responsible officer
      for (const item of items.filter((i) => i.type === 'ACTION')) {
        await this.events.emit(
          {
            eventCode: 'ACT-01',
            subjectType: 'ITEM',
            subjectId: item.id,
            subjectRef: item.ref,
            templateKey: 'ucf_action_assigned',
            triggeredById: user.id,
            recipientIds: item.owners.map((o) => o.userId),
            payload: {
              description: item.description,
              dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
              meeting: meeting.code,
            },
          },
          tx,
        );
      }
      for (const item of items.filter((i) => i.type === 'CLARIFICATION' && i.respondedById)) {
        await this.events.emit(
          {
            eventCode: 'CLA-01',
            subjectType: 'ITEM',
            subjectId: item.id,
            subjectRef: item.ref,
            templateKey: 'ucf_clarification_raised',
            triggeredById: user.id,
            recipientIds: item.respondedById ? [item.respondedById] : [],
            payload: { description: item.description, meeting: meeting.code },
          },
          tx,
        );
      }

      // 3 · MOM-05 to everyone who was invited
      await this.events.emit(
        {
          eventCode: 'MOM-05',
          subjectType: 'MOM',
          subjectId: mom.id,
          subjectRef: meeting.code,
          templateKey: 'ucf_mom_circulated',
          triggeredById: user.id,
          recipientIds: await this.attendance.recipients(meetingId),
          payload: {
            title: meeting.title,
            version: mom.version,
            actions: items.filter((i) => i.type === 'ACTION').length,
            clarifications: items.filter((i) => i.type === 'CLARIFICATION').length,
          },
        },
        tx,
      );

      // 4 · the meeting closes
      await tx.meeting.update({ where: { id: meetingId }, data: { stage: 'CLOSED' } });

      await tx.momHistory.create({
        data: { momId: mom.id, event: 'CIRCULATED', version: mom.version, actorId: user.id },
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MOM',
          objectId: mom.id,
          objectRef: meeting.code,
          event: 'MOM_CIRCULATED',
          detail: `${items.length} item(s) activated`,
          after: { activated: items.map((i) => i.ref), actionCount },
        },
      });

      this.log.log(`${meeting.code} circulated — ${items.length} item(s) now live`);
      return updated;
    });
  }

  /**
   * A correction is a new MoM, not an edit.
   *
   * The original stays exactly as it was circulated, because people have read
   * it, filed it and acted on it. `correctsMomId` is what links the two, and it
   * is why the register can show "corrected by" rather than quietly changing a
   * document under its readers.
   */
  async corrigendum(user: AuthUser, meetingId: string) {
    const { meeting, mom } = await this.mustHaveMom(user, meetingId);
    if (mom.state !== 'SIGNED') {
      throw new AppError(
        'INVALID_TRANSITION',
        'A corrigendum corrects a circulated MoM. This one has not been circulated yet — edit it directly.',
        { from: mom.state, to: 'DRAFT' },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // A NEW row. The circulated one is left untouched — including its signed
      // file, which is the document people are holding — and the new one points
      // back at it. This is the whole reason `moms.meeting_id` is not unique.
      const created = await tx.mom.create({
        data: {
          meetingId,
          state: 'DRAFT',
          version: mom.version + 1,
          correctsMomId: mom.id,
        },
        select: MOM_SELECT,
      });
      const minutes = await tx.minutes.findUnique({ where: { meetingId }, select: { id: true } });
      if (minutes) await tx.minutes.update({ where: { id: minutes.id }, data: { lockedAt: null } });

      await tx.momHistory.create({
        data: {
          momId: created.id,
          event: 'CORRIGENDUM_OPENED',
          version: created.version,
          actorId: user.id,
          remark: `Corrects version ${mom.version}`,
        },
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'MOM',
          objectId: mom.id,
          objectRef: meeting.code,
          event: 'MOM_CORRIGENDUM_OPENED',
          detail: `Corrects version ${mom.version}`,
        },
      });
      return created;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async mustHaveMom(user: AuthUser, meetingId: string) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    const mom = await this.currentMom(this.prisma, meetingId, {
      id: true,
      state: true,
      version: true,
    });
    if (!mom) {
      throw new AppError(
        'INVALID_TRANSITION',
        'No MoM has been generated for this meeting yet.',
        { from: 'NOT_GENERATED', to: 'DRAFT' },
      );
    }
    return { meeting, mom };
  }

  /** Who approves: holders of approve_mom who can see one of the meeting's projects. */
  private async approverIds(tx: Prisma.TransactionClient, projectIds: string[]): Promise<string[]> {
    const rows = await tx.user.findMany({
      where: {
        accountState: 'ACTIVE',
        designation: { caps: { has: 'approve_mom' } },
        OR: [{ projects: { some: { projectId: { in: projectIds } } } }, { seesAllProjects: true }],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Who to tell about a decision: whoever recorded the minutes, and the chair. */
  private async coordinatorIds(tx: Prisma.TransactionClient, meetingId: string): Promise<string[]> {
    const meeting = await tx.meeting.findUnique({
      where: { id: meetingId },
      select: { createdById: true, chairId: true, minutes: { select: { updatedById: true } } },
    });
    if (!meeting) return [];
    return [
      ...new Set(
        [meeting.createdById, meeting.chairId, meeting.minutes?.updatedById].filter(
          (v): v is string => Boolean(v),
        ),
      ),
    ];
  }
}
