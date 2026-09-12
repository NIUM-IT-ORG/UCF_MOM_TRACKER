import { Injectable } from '@nestjs/common';
import type { MomState } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { renderMomDocument, type MomDocumentData } from './mom.template.js';

/**
 * Gathers everything the document needs, in one query, and hands it to the one
 * template.
 *
 * Separate from MomService on purpose: that class runs the state machine, this
 * one only reads. Mixing them is how a renderer ends up quietly mutating
 * something because it was convenient.
 */
@Injectable()
export class MomDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async html(user: AuthUser, meetingId: string): Promise<{ html: string; code: string; state: MomState }> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: {
        code: true,
        title: true,
        type: true,
        category: true,
        meetingDate: true,
        startTime: true,
        endTime: true,
        venue: true,
        vcLink: true,
        createdById: true,
        chair: {
          select: {
            id: true,
            name: true,
            designation: { select: { name: true } },
          },
        },
        projects: {
          select: { project: { select: { code: true, name: true, fullName: true } } },
        },
        invitees: {
          select: {
            attendance: true,
            isWalkIn: true,
            user: {
              select: {
                id: true,
                name: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
          orderBy: [{ isWalkIn: 'asc' }, { user: { designation: { band: 'asc' } } }],
        },
        agenda: {
          select: {
            ordinal: true,
            text: true,
            projectId: true,
            addedById: true,
            isCarryBlock: true,
            isDeferred: true,
            _count: { select: { carriedItems: true } },
          },
          orderBy: { ordinal: 'asc' },
        },
        minutes: { select: { bodyHtml: true } },
        moms: {
          select: { state: true, version: true, circulatedAt: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
        items: {
          select: {
            ref: true,
            type: true,
            description: true,
            dueDate: true,
            priority: true,
            actionStatus: true,
            clarificationStatus: true,
            remarks: true,
            raisedBy: { select: { name: true } },
            respondedBy: { select: { name: true } },
            owners: { select: { user: { select: { name: true } } } },
          },
          orderBy: { ref: 'asc' },
        },
      },
    });
    if (!meeting) throw AppError.notFound('That meeting');

    const mom = meeting.moms[0] ?? { state: 'NOT_GENERATED' as MomState, version: 0, circulatedAt: null };

    // Agenda points name who raised them, and the project they belong to —
    // both need a lookup, so do it once rather than per row.
    const projectIds = [...new Set(meeting.agenda.map((a) => a.projectId).filter(Boolean))] as string[];
    const addedByIds = [...new Set(meeting.agenda.map((a) => a.addedById))];
    const [projects, people] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: addedByIds } },
        select: { id: true, name: true },
      }),
    ]);
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const personName = new Map(people.map((p) => [p.id, p.name]));

    const data: MomDocumentData = {
      meeting: {
        code: meeting.code,
        title: meeting.title,
        type: meeting.type,
        category: meeting.category,
        meetingDate: meeting.meetingDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        venue: meeting.venue,
        vcLink: meeting.vcLink,
        projects: meeting.projects.map((p) => p.project),
        chair: meeting.chair
          ? { name: meeting.chair.name, designationName: meeting.chair.designation.name }
          : null,
      },
      mom,
      attendance: meeting.invitees.map((i) => ({
        name: i.user.name,
        designationName: i.user.designation.name,
        departmentName: i.user.department.name,
        mark: i.attendance,
        isChair: i.user.id === meeting.chair?.id,
        isWalkIn: i.isWalkIn,
      })),
      agenda: meeting.agenda.map((a) => ({
        ordinal: a.ordinal,
        text: a.text,
        projectName: a.projectId ? (projectName.get(a.projectId) ?? null) : null,
        addedByName: personName.get(a.addedById) ?? null,
        isCarryBlock: a.isCarryBlock,
        isDeferred: a.isDeferred,
        carriedCount: a._count.carriedItems,
      })),
      bodyHtml:
        meeting.minutes?.bodyHtml ??
        '<p><i>The minutes for this meeting have not been recorded yet.</i></p>',
      actions: meeting.items
        .filter((i) => i.type === 'ACTION')
        .map((i) => ({
          ref: i.ref,
          description: i.description,
          raisedByName: i.raisedBy.name,
          owners: i.owners.map((o) => o.user.name),
          dueDate: i.dueDate,
          priority: i.priority,
          status: i.actionStatus,
          remarks: i.remarks,
        })),
      clarifications: meeting.items
        .filter((i) => i.type === 'CLARIFICATION')
        .map((i) => ({
          ref: i.ref,
          description: i.description,
          raisedByName: i.raisedBy.name,
          respondedByName: i.respondedBy?.name ?? null,
          status: i.clarificationStatus,
          remarks: i.remarks,
        })),
      signatories: await this.signatories(meeting.chair?.id, meeting.createdById),
      generatedAt: new Date(),
    };

    return { html: renderMomDocument(data), code: meeting.code, state: mom.state };
  }

  /**
   * Who signs: the chairperson, and the coordinator who produced the document.
   * Both, because the chair attests to what was decided and the coordinator to
   * what was recorded — and the reference document shows two blocks.
   */
  private async signatories(chairId: string | undefined, createdById: string) {
    const ids = [...new Set([chairId, createdById].filter((v): v is string => Boolean(v)))];
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, designation: { select: { name: true } } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const out: { name: string; designationName: string; role: string }[] = [];
    if (chairId && byId.has(chairId)) {
      const p = byId.get(chairId) as (typeof people)[number];
      out.push({ name: p.name, designationName: p.designation.name, role: 'Chairperson' });
    }
    if (createdById !== chairId && byId.has(createdById)) {
      const p = byId.get(createdById) as (typeof people)[number];
      out.push({ name: p.name, designationName: p.designation.name, role: 'Meeting Coordinator' });
    }
    return out;
  }
}
