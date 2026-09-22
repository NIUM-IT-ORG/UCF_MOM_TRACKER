import { Injectable } from '@nestjs/common';
import { DOCUMENT_TYPE_LABEL, type MomState } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { renderMomDocument, type MomDocumentData } from './mom.template.js';
import { cdmaLogo, emblem } from '../../common/print/emblem.js';

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
          select: {
            state: true,
            version: true,
            circulatedAt: true,
            signatoryId: true,
            signedById: true,
            signedAt: true,
          },
          orderBy: { version: 'desc' },
          take: 1,
        },
        // Attached while the minutes were being recorded; listed as annexures.
        documents: {
          select: {
            name: true,
            type: true,
            uploadedById: true,
            file: { select: { fileName: true } },
          },
          orderBy: { createdAt: 'asc' },
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

    const current = meeting.moms[0];
    const mom = {
      state: current?.state ?? ('NOT_GENERATED' as MomState),
      version: current?.version ?? 0,
      circulatedAt: current?.circulatedAt ?? null,
    };

    // Agenda points name who raised them, and the project they belong to —
    // both need a lookup, so do it once rather than per row.
    const projectIds = [...new Set(meeting.agenda.map((a) => a.projectId).filter(Boolean))] as string[];
    const addedByIds = [
      ...new Set([
        ...meeting.agenda.map((a) => a.addedById),
        ...meeting.documents.map((d) => d.uploadedById),
      ]),
    ];
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
      annexures: meeting.documents.map((d) => ({
        name: d.name,
        fileName: d.file.fileName,
        typeLabel: DOCUMENT_TYPE_LABEL[d.type] ?? String(d.type),
        addedByName: personName.get(d.uploadedById) ?? null,
      })),
      signatory: await this.signatory(current?.signedById ?? current?.signatoryId ?? null, current?.signedAt ?? null),
      emblemDataUri: emblem(),
      cdmaDataUri: cdmaLogo(),
      generatedAt: new Date(),
    };

    return { html: renderMomDocument(data), code: meeting.code, state: mom.state };
  }

  /**
   * Who signs, and whether they have.
   *
   * Not the chairperson. Under the chain the client asked for, the Project
   * Coordinator validates the minutes and nominates one executive — the
   * Additional Mission Director or the Mission Director — and that officer
   * signs. The chair presided; they did not put their name to the document.
   *
   * Before signature this still returns the nominee, so the draft says whom it
   * is waiting for rather than showing an anonymous rule.
   */
  private async signatory(userId: string | null, signedAt: Date | null) {
    if (!userId) return null;
    const person = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, designation: { select: { name: true } } },
    });
    if (!person) return null;
    return { name: person.name, designationName: person.designation.name, signedAt };
  }
}

/**
 * The state emblem, read once and inlined.
 *
 * It lives outside the code because it is the client's asset, not ours: drop
 * the official file at `var/branding/emblem.png` (or point MOM_EMBLEM_PATH
 * somewhere else) and every document picks it up. Nothing is invented — if
 * the file is not there the masthead prints without a crest, which is honest,
 * where a placeholder emblem on a signed minute would not be.
 *
 * Cached after the first read: this is a file on disk that changes when
 * somebody replaces it, not per request, and a restart is the natural moment
 * to notice.
 */
