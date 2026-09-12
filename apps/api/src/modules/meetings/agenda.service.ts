import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AgendaItemDto, CarryDto } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../auth/auth-user.js';
import { MeetingsService } from './meetings.service.js';
import { advanceMonotonic } from './meeting.machine.js';

/** Ordinal 0 is reserved for the carry-forward block, and nothing else may take it. */
const CARRY_ORDINAL = 0;

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
  ) {}

  async list(user: AuthUser, meetingId: string) {
    await this.meetings.mustSee(user, meetingId);
    return this.prisma.agendaItem.findMany({
      where: { meetingId },
      select: {
        id: true,
        ordinal: true,
        text: true,
        projectId: true,
        isCarryBlock: true,
        isDeferred: true,
        createdAt: true,
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
                priority: true,
                actionStatus: true,
                clarificationStatus: true,
                carryCount: true,
                owners: { select: { user: { select: { id: true, name: true, initials: true } } } },
              },
            },
          },
        },
      },
      orderBy: { ordinal: 'asc' },
    });
  }

  async add(user: AuthUser, meetingId: string, dto: AgendaItemDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    this.mustBeOpen(user, meeting);

    if (dto.projectId) {
      const covered = meeting.projects.some((p) => p.projectId === dto.projectId);
      if (!covered) {
        throw new AppError(
          'VALIDATION_FAILED',
          'That project is not one this meeting covers.',
          { field: 'projectId' },
        );
      }
    }

    const last = await this.prisma.agendaItem.findFirst({
      where: { meetingId },
      select: { ordinal: true },
      orderBy: { ordinal: 'desc' },
    });

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.agendaItem.create({
        data: {
          meetingId,
          ordinal: (last?.ordinal ?? CARRY_ORDINAL) + 1,
          text: dto.text,
          projectId: dto.projectId ?? null,
          addedById: user.id,
        },
        select: { id: true, ordinal: true, text: true, projectId: true, isCarryBlock: true },
      });
      // Drafting the agenda is what moves a scheduled meeting off AGENDA. It
      // only ever moves forward — see advanceMonotonic.
      if (meeting.type === 'SCHEDULED') {
        await tx.meeting.update({
          where: { id: meetingId },
          data: { stage: advanceMonotonic('SCHEDULED', meeting.stage, 'draftAgenda') },
        });
      }
      return created;
    });
  }

  async update(user: AuthUser, meetingId: string, agendaItemId: string, dto: AgendaItemDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    this.mustBeOpen(user, meeting);
    const item = await this.mustBelong(meetingId, agendaItemId);

    if (item.isCarryBlock) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The review of previous items is generated from the items themselves and cannot be re-worded.',
      );
    }

    return this.prisma.agendaItem.update({
      where: { id: agendaItemId },
      data: { text: dto.text, projectId: dto.projectId ?? null },
      select: { id: true, ordinal: true, text: true, projectId: true },
    });
  }

  /**
   * The carry block is undeletable. Removing it would take the previous
   * meeting's unfinished commitments off the agenda, which is precisely the
   * thing this product exists to stop happening.
   */
  async remove(user: AuthUser, meetingId: string, agendaItemId: string) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    this.mustBeOpen(user, meeting);
    const item = await this.mustBelong(meetingId, agendaItemId);

    if (item.isCarryBlock) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The review of previous items cannot be removed. Defer individual items instead.',
      );
    }

    await this.prisma.agendaItem.delete({ where: { id: agendaItemId } });
    return { id: agendaItemId, deleted: true };
  }

  /**
   * Deferring keeps the point on the record and marks it as not taken.
   * Deleting it after the meeting would leave the minutes silently shorter
   * than the agenda that was circulated.
   */
  async defer(user: AuthUser, meetingId: string, agendaItemId: string) {
    await this.meetings.mustSee(user, meetingId);
    const item = await this.mustBelong(meetingId, agendaItemId);
    return this.prisma.agendaItem.update({
      where: { id: agendaItemId },
      data: { isDeferred: !item.isDeferred },
      select: { id: true, isDeferred: true },
    });
  }

  // ── carry-forward ────────────────────────────────────────────────────

  /**
   * Every open item on the projects this meeting covers.
   *
   * `activatedAt != null` is the whole point: an item whose MoM has not been
   * circulated is not a commitment anybody has been told about, so carrying it
   * forward would be reviewing work nobody has been asked to do.
   */
  async carryCandidates(user: AuthUser, meetingId: string) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    const projectIds = meeting.projects.map((p) => p.projectId);

    const already = await this.prisma.agendaCarry.findMany({
      where: { agendaItem: { meetingId } },
      select: { itemId: true },
    });
    const carried = new Set(already.map((c) => c.itemId));

    const items = await this.prisma.item.findMany({
      where: {
        projectId: { in: projectIds },
        meetingId: { not: meetingId },
        activatedAt: { not: null },
        OR: [
          { type: 'ACTION', actionStatus: { not: 'COMPLETED' } },
          { type: 'CLARIFICATION', clarificationStatus: { not: 'CLOSED' } },
        ],
      },
      select: {
        id: true,
        ref: true,
        type: true,
        description: true,
        dueDate: true,
        priority: true,
        actionStatus: true,
        clarificationStatus: true,
        carryCount: true,
        project: { select: { id: true, code: true, name: true } },
        meeting: { select: { id: true, code: true, meetingDate: true } },
        owners: { select: { user: { select: { id: true, name: true, initials: true } } } },
      },
      orderBy: [{ dueDate: 'asc' }, { ref: 'asc' }],
    });

    return items.map((i) => ({
      ...i,
      alreadyCarried: carried.has(i.id),
      // Surfaced so the form can demand the date before the request is sent,
      // rather than letting the officer discover it on submit.
      revisedDueRequired: i.type === 'ACTION' && i.carryCount >= 1,
    }));
  }

  /**
   * Pulls the selected items into agenda item 0.
   *
   * A revised due date is mandatory on the *second* carry: `carryCount` is
   * still the count before this one, so `>= 1` here means this carry makes it
   * two. Without that rule the same overdue action rides from meeting to
   * meeting behind a date nobody believes.
   */
  async carry(user: AuthUser, meetingId: string, dto: CarryDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);
    const projectIds = meeting.projects.map((p) => p.projectId);
    const ids = dto.items.map((i) => i.itemId);

    const items = await this.prisma.item.findMany({
      where: { id: { in: ids }, projectId: { in: projectIds }, activatedAt: { not: null } },
      select: { id: true, ref: true, type: true, carryCount: true, dueDate: true },
    });
    if (items.length !== ids.length) {
      throw AppError.notFound('One of those items');
    }

    const byId = new Map(items.map((i) => [i.id, i]));
    const needDate = dto.items.filter((sel) => {
      const item = byId.get(sel.itemId);
      return item?.type === 'ACTION' && item.carryCount >= 1 && !sel.revisedDue;
    });
    if (needDate.length > 0) {
      const refs = needDate.map((s) => byId.get(s.itemId)?.ref ?? s.itemId);
      throw new AppError(
        'REVISED_DUE_REQUIRED',
        `${refs.join(', ')} ${refs.length === 1 ? 'has' : 'have'} been carried forward before. Give a revised due date before carrying ${refs.length === 1 ? 'it' : 'them'} again.`,
        { items: refs },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const block = await tx.agendaItem.upsert({
        where: { id: (await this.carryBlockId(tx, meetingId)) ?? '__none__' },
        create: {
          meetingId,
          ordinal: CARRY_ORDINAL,
          text: 'Review of items from previous meetings',
          addedById: user.id,
          isCarryBlock: true,
        },
        update: {},
        select: { id: true },
      });

      for (const sel of dto.items) {
        const item = byId.get(sel.itemId);
        if (!item) continue;
        await tx.agendaCarry.upsert({
          where: { agendaItemId_itemId: { agendaItemId: block.id, itemId: sel.itemId } },
          create: {
            agendaItemId: block.id,
            itemId: sel.itemId,
            revisedDue: sel.revisedDue ? new Date(sel.revisedDue) : null,
          },
          update: { revisedDue: sel.revisedDue ? new Date(sel.revisedDue) : null },
        });
        await tx.item.update({
          where: { id: sel.itemId },
          data: {
            carryCount: { increment: 1 },
            // The revised date replaces the due date; `originalDue` keeps the
            // first one, so "slipped by 40 days" stays answerable.
            ...(sel.revisedDue
              ? {
                  dueDate: new Date(sel.revisedDue),
                  originalDue: item.dueDate ?? undefined,
                }
              : {}),
          },
        });
        await tx.auditEntry.create({
          data: {
            actorId: user.id,
            objectType: 'ITEM',
            objectId: sel.itemId,
            objectRef: item.ref,
            event: 'ITEM_CARRIED_FORWARD',
            detail: `Carried into ${meeting.code}`,
            after: { meetingId, revisedDue: sel.revisedDue ?? null },
          },
        });
      }

      if (meeting.type === 'SCHEDULED') {
        await tx.meeting.update({
          where: { id: meetingId },
          data: { stage: advanceMonotonic('SCHEDULED', meeting.stage, 'draftAgenda') },
        });
      }

      return tx.agendaItem.findUniqueOrThrow({
        where: { id: block.id },
        select: {
          id: true,
          ordinal: true,
          text: true,
          isCarryBlock: true,
          carriedItems: {
            select: {
              revisedDue: true,
              item: { select: { id: true, ref: true, description: true, carryCount: true } },
            },
          },
        },
      });
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async carryBlockId(tx: Prisma.TransactionClient, meetingId: string) {
    const found = await tx.agendaItem.findFirst({
      where: { meetingId, isCarryBlock: true },
      select: { id: true },
    });
    return found?.id;
  }

  private async mustBelong(meetingId: string, agendaItemId: string) {
    const item = await this.prisma.agendaItem.findFirst({
      where: { id: agendaItemId, meetingId },
      select: { id: true, isCarryBlock: true, isDeferred: true },
    });
    if (!item) throw AppError.notFound('That agenda point');
    return item;
  }

  /**
   * The freeze rule, in one place.
   *
   * Before `agendaFreezeAt` an invitee may add points. After it the agenda is
   * read-only for invitees but still editable by the coordinator — the freeze
   * exists so the circulated agenda is final for the people reading it, not so
   * the person assembling it is locked out. After confirmation it is closed to
   * everyone.
   */
  private mustBeOpen(
    user: AuthUser,
    meeting: {
      stage: string;
      agendaFreezeAt: Date | null;
      invitees: { userId: string }[];
    },
  ) {
    if (meeting.stage === 'CANCELLED') {
      throw new AppError('AGENDA_FROZEN', 'This meeting was cancelled.');
    }
    if (meeting.stage === 'CONFIRMED' || meeting.stage === 'HELD' || meeting.stage === 'MINUTED' || meeting.stage === 'CLOSED') {
      throw new AppError(
        'AGENDA_FROZEN',
        'The agenda was circulated when this meeting was confirmed and can no longer be changed.',
      );
    }

    const coordinator = user.caps.includes('plan_scheduled') || user.caps.includes('plan_instant');
    if (coordinator) return;

    if (meeting.agendaFreezeAt && meeting.agendaFreezeAt.getTime() <= Date.now()) {
      throw new AppError(
        'AGENDA_FROZEN',
        'Contributions to this agenda closed 24 hours before the meeting.',
        { frozenAt: meeting.agendaFreezeAt.toISOString() },
      );
    }
  }
}
