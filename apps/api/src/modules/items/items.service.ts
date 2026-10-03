import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTION_STATUS_LABEL,
  ACTION_STATUS_ORDER,
  CLARIFICATION_STATUS_LABEL,
  CLARIFICATION_STATUS_ORDER,
  PRIORITY_LABEL,
  type ActionStatus,
  type ClarificationStatus,
} from '@mom/shared';
import type {
  CreateItemDto,
  ItemQueryDto,
  ReportCompleteDto,
  RespondDto,
  SendBackDto,
  SetOwnersDto,
  UpdateItemDto,
} from '@mom/shared';
import type { ReportTable } from '../reports/reports.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { canSeeProject, projectScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { nextItemRef } from '../meetings/meeting-code.js';
import { advanceAction, advanceClarification, daysOverdue } from './item.machine.js';
import { mayConfirm } from './confirmation.policy.js';

const ITEM_SELECT = {
  id: true,
  ref: true,
  type: true,
  description: true,
  remarks: true,
  dueDate: true,
  originalDue: true,
  priority: true,
  actionStatus: true,
  clarificationStatus: true,
  activatedAt: true,
  closedAt: true,
  carryCount: true,
  createdAt: true,
  project: { select: { id: true, code: true, name: true } },
  meeting: { select: { id: true, code: true, title: true, meetingDate: true, type: true } },
  raisedBy: { select: { id: true, name: true, initials: true } },
  respondedBy: { select: { id: true, name: true, initials: true } },
  owners: {
    select: {
      user: {
        select: {
          id: true,
          name: true,
          initials: true,
          email: true,
          designation: { select: { code: true, name: true } },
        },
      },
    },
  },
  _count: { select: { updates: true, documents: true } },
} satisfies Prisma.ItemSelect;

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NotificationsService,
  ) {}

  // ── reading ──────────────────────────────────────────────────────────

  async list(user: AuthUser, query: ItemQueryDto = {}) {
    const where: Prisma.ItemWhereInput = { ...projectScope(user) };

    if (query.type) where.type = query.type;
    if (query.meetingId) where.meetingId = query.meetingId;
    if (query.ownerId) where.owners = { some: { userId: query.ownerId } };
    // A column on the item, not a relation: an item has one raiser and many
    // owners, which is why this is an equality and the one above is a `some`.
    if (query.raisedById) where.raisedById = query.raisedById;
    if (query.projectId) {
      if (!canSeeProject(user, query.projectId)) return [];
      where.projectId = query.projectId;
    }
    if (query.status) {
      // The register's status filter is one control over two vocabularies, so
      // the value has to be sorted into the column it belongs to. Sending an
      // action status to `clarificationStatus` is not a type error — Prisma
      // would accept it and return nothing, which reads as "no results" rather
      // than as the bug it is.
      const wanted = query.status.split(',').map((s) => s.trim()).filter(Boolean);
      const actionStatuses = wanted.filter((s): s is ActionStatus =>
        ACTION_STATUS_ORDER.includes(s as ActionStatus),
      );
      const clarificationStatuses = wanted.filter((s): s is ClarificationStatus =>
        CLARIFICATION_STATUS_ORDER.includes(s as ClarificationStatus),
      );
      if (actionStatuses.length + clarificationStatuses.length !== wanted.length) {
        throw new AppError('VALIDATION_FAILED', 'That is not a status this register uses.', {
          field: 'status',
        });
      }
      const clauses: Prisma.ItemWhereInput[] = [];
      if (actionStatuses.length > 0) clauses.push({ actionStatus: { in: actionStatuses } });
      if (clarificationStatuses.length > 0) {
        clauses.push({ clarificationStatus: { in: clarificationStatuses } });
      }
      if (clauses.length > 0) where.OR = clauses;
    }
    // Rule 4, as a filter: before circulation an item exists but nobody has
    // been told about it. This is what the dashboard counts, and the only way
    // the register can be asked to show the same set.
    if (query.live) where.activatedAt = { not: null };
    if (query.overdue) {
      where.dueDate = { lt: new Date() };
      where.actionStatus = { in: ['IN_PROGRESS', 'DELAYED'] };
      // Same rule as the ageing column: nothing is late until it is live.
      where.activatedAt = { not: null };
    }
    if (query.q) {
      where.AND = [
        {
          OR: [
            { description: { contains: query.q, mode: 'insensitive' } },
            { ref: { contains: query.q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    /*
     * Newest first, like every other listing in the product.
     *
     * This used to be `dueDate asc` — the soonest-due at the top, which reads
     * well for somebody working a queue. It is out of step with the meetings
     * list and the MoM register, which both open newest-first, and an officer
     * who has just raised three actions expects to see them without paging
     * past work from six months ago.
     *
     * Overdue work is not lost by this: the register carries an ageing column
     * and a status filter, and the dashboard's attention list is ordered by
     * urgency precisely so that "what is late" has a home of its own.
     *
     * `createdAt`, not `ref`: refs are issued per type, so ACT-12 and CLA-03
     * do not sort against each other in any meaningful order. The tiebreak
     * exists only so two items written in the same transaction come back in a
     * stable order rather than shuffling between requests.
     */
    const rows = await this.prisma.item.findMany({
      where,
      select: ITEM_SELECT,
      orderBy: [{ createdAt: 'desc' }, { ref: 'desc' }],
    });
    return rows.map((r) => decorate(r));
  }

  /**
   * The same filtered register, shaped for export.
   *
   * It reuses `list`, so a spreadsheet cannot disagree with the screen it was
   * taken from — the filters, the project scope and the ordering are one code
   * path. `ReportTable` is the shape the reports module already renders as
   * CSV, as a printable page and as a PDF: one set of rows, three renderers.
   *
   * This replaces a second CSV builder that lived in the register page, with
   * its own quoting and its own column list. Two implementations of the same
   * export is how a column gets added to one and not the other.
   */
  async exportTable(user: AuthUser, query: ItemQueryDto = {}): Promise<ReportTable> {
    const rows = await this.list(user, query);

    const statusOf = (i: (typeof rows)[number]) =>
      i.type === 'ACTION'
        ? i.actionStatus
          ? ACTION_STATUS_LABEL[i.actionStatus]
          : ''
        : i.clarificationStatus
          ? CLARIFICATION_STATUS_LABEL[i.clarificationStatus]
          : '';

    return {
      key: 'register',
      title: 'Action and clarification register',
      lede:
        'Everything raised in any meeting, matching the filters in force when this was taken.' +
        ' Scope is that of whoever took it: a project they cannot see is not in it.',
      columns: [
        { key: 'ref', label: 'Item' },
        { key: 'kind', label: 'Type' },
        { key: 'description', label: 'Description' },
        { key: 'project', label: 'Project' },
        { key: 'meeting', label: 'Raised in' },
        { key: 'raisedBy', label: 'Raised by' },
        { key: 'responsible', label: 'Responsible / responded' },
        { key: 'due', label: 'Due' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'ageing', label: 'Days late', numeric: true },
        { key: 'live', label: 'Circulated' },
        { key: 'remarks', label: 'Remarks' },
      ],
      rows: rows.map((i) => ({
        ref: i.ref,
        kind: i.type === 'ACTION' ? 'Action' : 'Clarification',
        description: i.description,
        project: `${i.project.code} - ${i.project.name}`,
        meeting: i.meeting.code,
        raisedBy: i.raisedBy?.name ?? '',
        responsible:
          i.type === 'ACTION'
            ? i.owners.map((o) => o.user.name).join('; ')
            : (i.respondedBy?.name ?? ''),
        // ISO, so a spreadsheet sorts it and a person still reads it.
        due: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : '',
        priority: i.priority ? PRIORITY_LABEL[i.priority] : '',
        status: statusOf(i),
        // Already zero for anything not circulated - see `decorate`.
        ageing: i.daysOverdue,
        live: i.isActive ? 'yes' : 'not yet circulated',
        remarks: i.remarks ?? '',
      })),
      summary: [
        { label: 'Items', value: rows.length },
        { label: 'Actions', value: rows.filter((i) => i.type === 'ACTION').length },
        { label: 'Clarifications', value: rows.filter((i) => i.type === 'CLARIFICATION').length },
        {
          label: 'Not yet circulated',
          value: rows.filter((i) => !i.isActive).length,
        },
        { label: 'Overdue', value: rows.filter((i) => i.daysOverdue > 0).length },
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  async get(user: AuthUser, id: string) {
    const item = await this.prisma.item.findFirst({
      where: { AND: [{ id }, projectScope(user)] },
      select: {
        ...ITEM_SELECT,
        updates: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            evidenceFileId: true,
            createdAt: true,
            actorId: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw AppError.notFound('That item');

    // The update trail names people, and a raw actor id in a timeline is
    // unreadable — resolve them in one query rather than one per row.
    const actorIds = [...new Set(item.updates.map((u) => u.actorId))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, initials: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));

    return {
      ...decorate(item),
      updates: item.updates.map((u) => ({ ...u, actor: byId.get(u.actorId) ?? null })),
    };
  }

  // ── creating ─────────────────────────────────────────────────────────

  /**
   * An item is created inert — but inert means `activatedAt IS NULL`, not a
   * null status.
   *
   * This distinction matters and it is enforced by the database: the
   * `items_shape` CHECK constraint requires an ACTION to carry an
   * `action_status` and a CLARIFICATION a `clarification_status`, always. So
   * the item gets its opening status when it is created, and **`activatedAt` is
   * the only thing that decides whether it is live**: no transitions, no
   * notifications and no place in any register count until the signed MoM is
   * circulated. Every check in this service asks `activatedAt`, never the
   * status, for exactly that reason.
   */
  async create(user: AuthUser, dto: CreateItemDto) {
    if (!canSeeProject(user, dto.projectId)) throw AppError.notFound('That project');

    const meeting = await this.prisma.meeting.findFirst({
      where: { id: dto.meetingId, projects: { some: { projectId: dto.projectId } } },
      select: { id: true, code: true, stage: true },
    });
    if (!meeting) {
      throw new AppError(
        'VALIDATION_FAILED',
        'That meeting does not cover the project this item is against.',
        { field: 'projectId' },
      );
    }

    if (dto.type === 'ACTION') {
      await this.mustBeOwnable(dto.ownerIds);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.prisma.item.findMany({
        where: { ref: { startsWith: dto.type === 'ACTION' ? 'ACT-' : 'CLA-' } },
        select: { ref: true },
      });
      const ref = nextItemRef(existing.map((e) => e.ref), dto.type);

      try {
        const created = await this.prisma.item.create({
          data: {
            ref,
            type: dto.type,
            meetingId: dto.meetingId,
            projectId: dto.projectId,
            agendaItemId: dto.agendaItemId ?? null,
            description: dto.description,
            raisedById: dto.raisedById,
            remarks: dto.remarks ?? null,
            ...(dto.type === 'ACTION'
              ? {
                  dueDate: new Date(dto.dueDate),
                  originalDue: new Date(dto.dueDate),
                  priority: dto.priority ?? 'MEDIUM',
                  // The opening status. `activatedAt` stays null, which is what
                  // makes the item inert — see the note above.
                  actionStatus: 'IN_PROGRESS',
                  owners: { create: dto.ownerIds.map((userId) => ({ userId })) },
                }
              : {
                  respondedById: dto.respondedById ?? null,
                  /*
                   * Answered in the room, or still to be answered.
                   *
                   * The opening status, exactly as with an action — and
                   * `activatedAt` still stays null, so a clarification
                   * settled in the meeting is no less inert than any other
                   * item until the signed MoM is circulated. Status says what
                   * happened; `activatedAt` says whether anybody has been
                   * told. Those are different questions and this service
                   * never confuses them.
                   */
                  clarificationStatus: dto.response ? 'RESPONDED' : 'OPEN',
                }),
          },
          select: ITEM_SELECT,
        });

        /*
         * The answer itself goes in the item's history, not just its status.
         *
         * A clarification that reads RESPONDED without the response recorded
         * is worse than one that reads OPEN: the minute asserts a question
         * was settled and cannot say with what. `fromStatus: null` because
         * there was no earlier state — it opened here.
         */
        if (dto.type === 'CLARIFICATION' && dto.response) {
          await this.prisma.itemUpdate.create({
            data: {
              itemId: created.id,
              actorId: dto.respondedById ?? user.id,
              fromStatus: null,
              toStatus: 'RESPONDED',
              note: dto.response,
            },
          });
        }

        return decorate(created);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new AppError('INTERNAL', 'Could not allocate an item reference. Try again.');
  }

  async update(user: AuthUser, id: string, dto: UpdateItemDto) {
    const item = await this.mustSee(user, id);

    /*
     * Re-nominating is a drafting correction, not a transition. After
     * circulation the nominee has been told they owe an answer, and changing
     * that silently in a document people have read is not an edit anybody
     * should be able to make.
     */
    if (dto.respondedById) {
      if (item.type !== 'CLARIFICATION') {
        throw new AppError(
          'VALIDATION_FAILED',
          'An action has responsible officers, not a responder. Use the owners list.',
        );
      }
      if (item.activatedAt) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${item.ref} has been circulated, so ${'the nominated officer'} has already been asked. Respond to it instead of re-nominating.`,
        );
      }
    }

    /*
     * Both tables in section 5 and 6 of the MoM print "Raised by", so once
     * the document has been circulated this is no longer a drafting fix —
     * it is an edit to a page somebody has already read.
     */
    if (dto.raisedById && item.activatedAt) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${item.ref} has been circulated, and the minutes name who raised it. That cannot be changed now.`,
      );
    }

    if (item.type === 'CLARIFICATION' && (dto.dueDate || dto.priority)) {
      // Rejected rather than silently stripped: dropping a date somebody typed
      // is how people stop trusting a form.
      throw new AppError(
        'VALIDATION_FAILED',
        'A clarification has no due date and no priority. Raise an action if work is needed.',
      );
    }

    const revising = dto.dueDate && item.actionStatus === 'DELAYED';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: {
          ...(dto.description ? { description: dto.description } : {}),
          ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
          ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.respondedById ? { respondedById: dto.respondedById } : {}),
          ...(dto.raisedById ? { raisedById: dto.raisedById } : {}),
          // Revising the date forward is what brings a delayed item back — the
          // work is on track again, and the register should say so.
          ...(revising ? { actionStatus: advanceAction('DELAYED', 'reviseDue') } : {}),
        },
        select: ITEM_SELECT,
      });
      if (revising) {
        await tx.itemUpdate.create({
          data: {
            itemId: id,
            actorId: user.id,
            fromStatus: 'DELAYED',
            toStatus: 'IN_PROGRESS',
            note: `Due date revised to ${dto.dueDate as string}`,
          },
        });
      }
      return decorate(updated);
    });
  }

  /** Joint ownership: this replaces the set, and every one of them is accountable. */
  /**
   * Removing an item raised in error, while the minutes are still being
   * drafted.
   *
   * Only while it is inert. `activatedAt` is what makes an item real: until
   * the signed MoM is circulated nobody has been told about it, no clock is
   * running and no officer is accountable, so a line typed by mistake is
   * exactly that — a typo in a draft. The moment it is circulated it is a
   * commitment somebody has been given, and rule 4 says deleting it is not
   * available: it is reported complete, confirmed, or closed, each of which
   * leaves a trail.
   *
   * `create_items` rather than a capability of its own. Whoever may raise an
   * item during drafting may unraise it; this grants nobody reach they did
   * not already have, because the item they are deleting is one that has
   * never left the room.
   */
  async remove(user: AuthUser, id: string) {
    const item = await this.mustSee(user, id);

    if (item.activatedAt) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${item.ref} has been circulated, so somebody is accountable for it and it cannot be deleted. ` +
          (item.type === 'ACTION'
            ? 'Report it complete and have it confirmed, or send it back.'
            : 'Respond to it and close it.'),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      /*
       * The audit row goes first and survives: `audit_entries` holds the
       * object as a plain type and id with no foreign key, so the trail
       * outlives what it describes. A reference that was issued and then
       * withdrawn is worth being able to explain — ACT-07 existing in a
       * draft and not in the minutes is otherwise unaccountable.
       */
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'ITEM',
          objectId: id,
          objectRef: item.ref,
          event: 'ITEM_DELETED',
          detail: `Deleted while drafting, before circulation: "${item.description}"`,
          before: {
            ref: item.ref,
            type: item.type,
            description: item.description,
            dueDate: item.dueDate,
          },
        },
      });

      await tx.item.delete({ where: { id } });
      return { id, ref: item.ref, deleted: true };
    });
  }

  async setOwners(user: AuthUser, id: string, dto: SetOwnersDto) {
    const item = await this.mustSee(user, id);
    if (item.type !== 'ACTION') {
      throw new AppError('VALIDATION_FAILED', 'A clarification has one responder, not owners.');
    }
    await this.mustBeOwnable(dto.ownerIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.itemOwner.deleteMany({ where: { itemId: id } });
      await tx.itemOwner.createMany({
        data: dto.ownerIds.map((userId) => ({ itemId: id, userId })),
      });
      if (item.activatedAt) {
        // Only tell people about an item that is actually live. Re-assigning an
        // inert item notifies nobody, because nobody has heard of it yet.
        await this.events.emit(
          {
            eventCode: 'ACT-09',
            subjectType: 'ITEM',
            subjectId: id,
            subjectRef: item.ref,
            templateKey: 'ucf_action_reassigned',
            triggeredById: user.id,
            recipientIds: dto.ownerIds,
            payload: { description: item.description },
          },
          tx,
        );
      }
    });

    return this.get(user, id);
  }

  // ── the action machine ───────────────────────────────────────────────

  /** Any one owner may report it done; the confirmation applies to the whole item. */
  async reportComplete(user: AuthUser, id: string, dto: ReportCompleteDto) {
    const item = await this.mustSee(user, id);
    this.mustBeActive(item);
    this.mustBeAction(item);

    const owners = item.owners.map((o) => o.userId);
    if (!owners.includes(user.id)) {
      throw new AppError(
        'FORBIDDEN_CAPABILITY',
        'Only an officer responsible for this action can report it complete.',
        { capability: 'update_own_item' },
      );
    }

    const to = advanceAction(item.actionStatus, 'reportComplete');

    return this.prisma.$transaction(async (tx) => {
      await tx.item.update({ where: { id }, data: { actionStatus: to } });
      await tx.itemUpdate.create({
        data: {
          itemId: id,
          actorId: user.id,
          fromStatus: item.actionStatus,
          toStatus: to,
          note: dto.note,
          evidenceFileId: dto.evidenceFileId ?? null,
        },
      });
      await this.events.emit(
        {
          eventCode: 'ACT-05',
          subjectType: 'ITEM',
          subjectId: id,
          subjectRef: item.ref,
          templateKey: 'ucf_action_reported_complete',
          triggeredById: user.id,
          recipientIds: await this.confirmerIds(tx, item.projectId, owners),
          payload: { description: item.description, note: dto.note },
        },
        tx,
      );
      return this.get(user, id);
    });
  }

  /**
   * Nobody confirms their own work. The check lives in
   * `confirmation.policy.ts` so there is exactly one place that decides, and
   * the priority matrix — still an open client decision — drops into it.
   */
  async confirm(user: AuthUser, id: string) {
    const item = await this.mustSee(user, id);
    this.mustBeActive(item);
    this.mustBeAction(item);

    const verdict = mayConfirm({
      ownerIds: item.owners.map((o) => o.userId),
      actorId: user.id,
      actorDesignation: user.designationCode,
      priority: item.priority,
    });
    if (!verdict.allowed) {
      if (verdict.reason === 'SELF_CONFIRMATION') throw AppError.selfConfirmation();
      throw new AppError(
        'FORBIDDEN_CAPABILITY',
        `An item of this priority is confirmed by ${verdict.expected.join(' or ')}.`,
        { capability: 'confirm_completion', expected: verdict.expected },
      );
    }

    const to = advanceAction(item.actionStatus, 'confirm');

    return this.prisma.$transaction(async (tx) => {
      await tx.item.update({
        where: { id },
        data: { actionStatus: to, closedAt: new Date() },
      });
      await tx.itemUpdate.create({
        data: { itemId: id, actorId: user.id, fromStatus: item.actionStatus, toStatus: to },
      });
      await this.events.emit(
        {
          eventCode: 'ACT-06',
          subjectType: 'ITEM',
          subjectId: id,
          subjectRef: item.ref,
          templateKey: 'ucf_action_confirmed',
          triggeredById: user.id,
          recipientIds: item.owners.map((o) => o.userId),
          payload: { description: item.description },
        },
        tx,
      );
      return this.get(user, id);
    });
  }

  async sendBack(user: AuthUser, id: string, dto: SendBackDto) {
    const item = await this.mustSee(user, id);
    this.mustBeActive(item);
    this.mustBeAction(item);

    if (item.owners.some((o) => o.userId === user.id)) throw AppError.selfConfirmation();

    const to = advanceAction(item.actionStatus, 'sendBack');

    return this.prisma.$transaction(async (tx) => {
      await tx.item.update({ where: { id }, data: { actionStatus: to } });
      await tx.itemUpdate.create({
        data: {
          itemId: id,
          actorId: user.id,
          fromStatus: item.actionStatus,
          toStatus: to,
          note: dto.reason,
        },
      });
      await this.events.emit(
        {
          eventCode: 'ACT-07',
          subjectType: 'ITEM',
          subjectId: id,
          subjectRef: item.ref,
          templateKey: 'ucf_action_sent_back',
          triggeredById: user.id,
          recipientIds: item.owners.map((o) => o.userId),
          payload: { description: item.description, reason: dto.reason },
        },
        tx,
      );
      return this.get(user, id);
    });
  }

  /** Reopening a completed item needs a reason — it contradicts a confirmation. */
  async reopen(user: AuthUser, id: string, dto: SendBackDto) {
    const item = await this.mustSee(user, id);
    this.mustBeActive(item);

    const isAction = item.type === 'ACTION';
    const to = isAction
      ? advanceAction(item.actionStatus, 'reopen')
      : advanceClarification(item.clarificationStatus, 'reopen');

    return this.prisma.$transaction(async (tx) => {
      await tx.item.update({
        where: { id },
        data: isAction
          ? { actionStatus: to as never, closedAt: null }
          : { clarificationStatus: to as never, closedAt: null },
      });
      await tx.itemUpdate.create({
        data: {
          itemId: id,
          actorId: user.id,
          fromStatus: isAction ? item.actionStatus : item.clarificationStatus,
          toStatus: to,
          note: dto.reason,
        },
      });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'ITEM',
          objectId: id,
          objectRef: item.ref,
          event: 'ITEM_REOPENED',
          detail: dto.reason,
        },
      });
      return this.get(user, id);
    });
  }

  // ── the clarification machine ────────────────────────────────────────

  async respond(user: AuthUser, id: string, dto: RespondDto) {
    const item = await this.mustSee(user, id);
    this.mustBeActive(item);
    if (item.type !== 'CLARIFICATION') {
      throw new AppError('VALIDATION_FAILED', 'That is an action. Report it complete instead.');
    }

    const to = advanceClarification(item.clarificationStatus, 'respond');

    return this.prisma.$transaction(async (tx) => {
      await tx.item.update({
        where: { id },
        data: { clarificationStatus: to, respondedById: dto.respondedById ?? user.id },
      });
      await tx.itemUpdate.create({
        data: {
          itemId: id,
          actorId: user.id,
          fromStatus: item.clarificationStatus,
          toStatus: to,
          note: dto.response,
        },
      });
      await this.events.emit(
        {
          eventCode: 'CLA-02',
          subjectType: 'ITEM',
          subjectId: id,
          subjectRef: item.ref,
          templateKey: 'ucf_clarification_responded',
          triggeredById: user.id,
          recipientIds: [item.raisedById],
          payload: { description: item.description, response: dto.response },
        },
        tx,
      );
      return this.get(user, id);
    });
  }

  /** The officer who raised it decides whether the answer will do. */
  async close(user: AuthUser, id: string) {
    const item = await this.mustSee(user, id);
    this.mustBeActive(item);
    if (item.type !== 'CLARIFICATION') {
      throw new AppError('VALIDATION_FAILED', 'That is an action. Confirm it instead.');
    }
    if (item.raisedById !== user.id && !user.caps.includes('create_items')) {
      throw new AppError(
        'FORBIDDEN_CAPABILITY',
        'A clarification is closed by the officer who raised it.',
        { capability: 'create_items' },
      );
    }

    const to = advanceClarification(item.clarificationStatus, 'close');

    return this.prisma.$transaction(async (tx) => {
      await tx.item.update({
        where: { id },
        data: { clarificationStatus: to, closedAt: new Date() },
      });
      await tx.itemUpdate.create({
        data: { itemId: id, actorId: user.id, fromStatus: item.clarificationStatus, toStatus: to },
      });
      return this.get(user, id);
    });
  }

  // ── notes ────────────────────────────────────────────────────────────

  async addUpdate(user: AuthUser, id: string, dto: ReportCompleteDto) {
    const item = await this.mustSee(user, id);
    await this.prisma.itemUpdate.create({
      data: {
        itemId: id,
        actorId: user.id,
        note: dto.note,
        evidenceFileId: dto.evidenceFileId ?? null,
      },
    });
    return this.get(user, item.id);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async mustSee(user: AuthUser, id: string) {
    const item = await this.prisma.item.findFirst({
      where: { AND: [{ id }, projectScope(user)] },
      select: {
        id: true,
        ref: true,
        type: true,
        description: true,
        projectId: true,
        meetingId: true,
        raisedById: true,
        priority: true,
        dueDate: true,
        actionStatus: true,
        clarificationStatus: true,
        activatedAt: true,
        owners: { select: { userId: true } },
      },
    });
    if (!item) throw AppError.notFound('That item');
    return item;
  }

  /**
   * Before circulation an item has no status transitions and no notifications.
   * Saying so plainly matters: "nothing happened" with no explanation is how a
   * coordinator concludes the button is broken.
   */
  private mustBeActive(item: { activatedAt: Date | null; ref: string }) {
    if (!item.activatedAt) {
      throw new AppError(
        'INVALID_TRANSITION',
        `${item.ref} is not active yet. It becomes live when the signed MoM for its meeting is circulated.`,
        { from: 'NOT_ACTIVE', to: 'IN_PROGRESS' },
      );
    }
  }

  private mustBeAction(item: { type: string }) {
    if (item.type !== 'ACTION') {
      throw new AppError('VALIDATION_FAILED', 'That is a clarification, not an action.');
    }
  }

  private async mustBeOwnable(userIds: string[]) {
    const people = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, accountState: true },
    });
    if (people.length !== new Set(userIds).size) throw AppError.notFound('One of those officers');
    const suspended = people.find((p) => p.accountState === 'SUSPENDED');
    if (suspended) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${suspended.name}'s account is suspended and cannot be made responsible for an action.`,
      );
    }
  }

  /** Who to tell that work is awaiting confirmation: never one of the owners. */
  private async confirmerIds(
    tx: Prisma.TransactionClient,
    projectId: string,
    ownerIds: string[],
  ): Promise<string[]> {
    const candidates = await tx.user.findMany({
      where: {
        id: { notIn: ownerIds },
        accountState: 'ACTIVE',
        designation: { caps: { has: 'confirm_completion' } },
        OR: [{ projects: { some: { projectId } } }, { seesAllProjects: true }],
      },
      select: { id: true },
    });
    return candidates.map((c) => c.id);
  }
}

/** Fields the register shows that are derived rather than stored. */
function decorate<T extends { dueDate: Date | null; actionStatus: string | null; activatedAt: Date | null }>(
  item: T,
) {
  /*
   * An inert item cannot be late.
   *
   * `activatedAt` is what starts the clock: until the signed MoM is
   * circulated nobody has been told, no reminder has gone out and no officer
   * has been asked for anything — so a due date that has passed means the
   * minuting is behind, not the officer. The register was printing "8 days
   * late" against items marked NOT YET LIVE on the same row, which is the
   * product contradicting itself on one line.
   */
  const overdue = item.activatedAt ? daysOverdue(item.dueDate, new Date()) : 0;
  return {
    ...item,
    daysOverdue: overdue,
    // An item awaiting confirmation past its due date is overdue on the
    // confirmer, not on the work — the register says so rather than calling it
    // delayed. See docs/05 §4.
    awaitingConfirmation: item.actionStatus === 'UNDER_REVIEW' && overdue > 0,
    isActive: item.activatedAt !== null,
  };
}
