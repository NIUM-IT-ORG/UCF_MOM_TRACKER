import { Injectable } from '@nestjs/common';
import { DOCUMENT_TYPE_LABEL, designationLabel } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope } from '../../common/scope.js';
import { cdmaLogo, emblem } from '../../common/print/emblem.js';
import type { AuthUser } from '../auth/auth-user.js';
import {
  carriedStatusLabel,
  renderAgendaDocument,
  type AgendaDocumentData,
} from './agenda.template.js';

/**
 * Gathers everything the agenda needs, in one query, and hands it to the one
 * template.
 *
 * Separate from AgendaService for the same reason MomDocumentService is
 * separate from MomService: that class edits the agenda and runs the freeze
 * rule, this one only reads. Mixing them is how a renderer ends up quietly
 * mutating something because it was convenient.
 *
 * Note there is no capability check here beyond scope. `docs/03` gives
 * `GET /meetings/:id/agenda.pdf` to "any · scoped": the agenda is the thing
 * that gets circulated to everybody invited, so anyone who can see the meeting
 * can read its agenda. `meetingScope` is what stops it leaking across projects,
 * and a scope miss returns 404 rather than 403 so ids cannot be probed.
 */
@Injectable()
export class AgendaDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async html(user: AuthUser, meetingId: string): Promise<{ html: string; code: string }> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: {
        code: true,
        title: true,
        type: true,
        category: true,
        stage: true,
        meetingDate: true,
        startTime: true,
        endTime: true,
        venue: true,
        vcLink: true,
        agendaFreezeAt: true,
        confirmedAt: true,
        cancelledReason: true,
        chair: {
          select: { id: true, name: true, title: true, designation: { select: { name: true } } },
        },
        projects: {
          select: { project: { select: { code: true, name: true, fullName: true } } },
        },
        invitees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                title: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
          // Seniority, then walk-ins last — the order the room is listed in.
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
            carriedItems: {
              select: {
                revisedDue: true,
                item: {
                  select: {
                    ref: true,
                    description: true,
                    dueDate: true,
                    priority: true,
                    actionStatus: true,
                    clarificationStatus: true,
                    carryCount: true,
                    owners: { select: { user: { select: { name: true } } } },
                  },
                },
              },
            },
          },
          orderBy: { ordinal: 'asc' },
        },
        documents: {
          select: { name: true, type: true, file: { select: { fileName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!meeting) throw AppError.notFound('That meeting');

    // Agenda points name who raised them and the project they belong to —
    // both need a lookup, so do it once rather than per row.
    const projectIds = [
      ...new Set(meeting.agenda.map((a) => a.projectId).filter(Boolean)),
    ] as string[];
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

    const data: AgendaDocumentData = {
      meeting: {
        code: meeting.code,
        title: meeting.title,
        type: meeting.type,
        category: meeting.category,
        stage: meeting.stage,
        meetingDate: meeting.meetingDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        venue: meeting.venue,
        vcLink: meeting.vcLink,
        projects: meeting.projects.map((p) => p.project),
        chair: meeting.chair
          ? {
              name: meeting.chair.name,
              designationName: designationLabel(
                meeting.chair.title,
                meeting.chair.designation.name,
              ),
            }
          : null,
        agendaFreezeAt: meeting.agendaFreezeAt,
        confirmedAt: meeting.confirmedAt,
        cancelledReason: meeting.cancelledReason,
      },
      items: meeting.agenda.map((a) => ({
        ordinal: a.ordinal,
        text: a.text,
        projectName: a.projectId ? (projectName.get(a.projectId) ?? null) : null,
        addedByName: personName.get(a.addedById) ?? null,
        isCarryBlock: a.isCarryBlock,
        isDeferred: a.isDeferred,
        carried: a.carriedItems.map((c) => ({
          ref: c.item.ref,
          description: c.item.description,
          owners: c.item.owners.map((o) => o.user.name),
          dueDate: c.item.dueDate,
          revisedDue: c.revisedDue,
          priority: c.item.priority,
          statusLabel: carriedStatusLabel(c.item.actionStatus, c.item.clarificationStatus),
          carryCount: c.item.carryCount,
        })),
      })),
      invitees: meeting.invitees.map((i) => ({
        name: i.user.name,
        designationName: designationLabel(i.user.title, i.user.designation.name),
        departmentName: i.user.department.name,
        isChair: i.user.id === meeting.chair?.id,
      })),
      papers: meeting.documents.map((d) => ({
        name: d.name,
        fileName: d.file.fileName,
        typeLabel: DOCUMENT_TYPE_LABEL[d.type] ?? String(d.type),
      })),
      emblemDataUri: emblem(),
      cdmaDataUri: cdmaLogo(),
      generatedAt: new Date(),
    };

    return { html: renderAgendaDocument(data), code: meeting.code };
  }

  /**
   * The same document as a PDF.
   *
   * The file name carries the meeting code and the word "Agenda", because
   * this lands in an officer's Downloads folder next to the minutes for the
   * same meeting, and `UCF-P1-RM-04.pdf` twice is how the wrong one gets
   * forwarded.
   */
  async pdf(user: AuthUser, meetingId: string): Promise<{ html: string; fileName: string }> {
    const { html, code } = await this.html(user, meetingId);
    return {
      html,
      fileName: `${code.replace(/[^A-Za-z0-9._-]+/g, '-')}-Agenda.pdf`,
    };
  }
}
