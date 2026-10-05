import { Injectable, Logger } from '@nestjs/common';
import type { DocumentInput } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope, projectIdScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { FilesService } from '../files/files.service.js';

const DOC_SELECT = {
  id: true,
  scope: true,
  name: true,
  type: true,
  remarks: true,
  createdAt: true,
  file: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
  },
  uploadedById: true,
};

@Injectable()
export class DocumentsService {
  private readonly log = new Logger('Documents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async listForProject(user: AuthUser, projectId: string, type?: string) {
    await this.mustSeeProject(user, projectId);
    const rows = await this.prisma.document.findMany({
      where: { projectId, ...(type ? { type: type as never } : {}) },
      select: DOC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return this.withUploaders(rows);
  }

  /**
   * Papers tabled at a meeting, newest first.
   *
   * Each row carries `afterCirculation`. Documents may be filed at any point
   * in a meeting's life — before it is held, while the MoM is with the
   * approver, and long after it has been circulated, because that is when the
   * revised estimate or the countersigned letter actually arrives. What must
   * not happen is the system implying all of them are in the signed PDF.
   *
   * The merge runs at circulation, so anything filed after that moment is on
   * record here but is not in the copy people are holding. The flag says so,
   * and the screens say what to do about it: a corrigendum re-merges the full
   * set, which is how a late annexure becomes part of the minutes rather than
   * an attachment somebody has to be told about separately.
   */
  async listForMeeting(user: AuthUser, meetingId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: { id: true },
    });
    if (!meeting) throw AppError.notFound('That meeting');

    const [rows, circulated] = await Promise.all([
      this.prisma.document.findMany({
        where: { meetingId },
        select: DOC_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      // The most recent circulation, not the first: a corrigendum re-merges
      // everything on file, so its circulation is the line that matters.
      this.prisma.mom.findFirst({
        where: { meetingId, circulatedAt: { not: null } },
        orderBy: { circulatedAt: 'desc' },
        select: { circulatedAt: true, version: true },
      }),
    ]);

    const since = circulated?.circulatedAt ?? null;
    const withNames = await this.withUploaders(rows);
    return withNames.map((d) => ({
      ...d,
      afterCirculation: since !== null && d.createdAt > since,
      circulatedVersion: since !== null ? circulated!.version : null,
    }));
  }

  /**
   * Adds a document to a project.
   *
   * Name, type and file are all required, and that is enforced here as well as
   * by the DTO and by NOT NULL in the database. It is the rule the client
   * asked for by name: a repository full of `scan_0043.pdf` with no titles is
   * unusable within a year, and the only moment anyone knows what a file is,
   * is the moment they upload it.
   */
  async addToProject(user: AuthUser, projectId: string, input: DocumentInput) {
    await this.mustSeeProject(user, projectId);
    await this.files.requireUploaded(input.fileId);
    await this.mustOwnFile(user, input.fileId);

    const doc = await this.prisma.document.create({
      data: {
        scope: 'PROJECT',
        projectId,
        name: input.name,
        type: input.type,
        fileId: input.fileId,
        remarks: input.remarks ?? null,
        uploadedById: user.id,
      },
      select: DOC_SELECT,
    });
    return (await this.withUploaders([doc]))[0];
  }

  async addToMeeting(user: AuthUser, meetingId: string, input: DocumentInput) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: { id: true },
    });
    if (!meeting) throw AppError.notFound('That meeting');
    await this.files.requireUploaded(input.fileId);
    await this.mustOwnFile(user, input.fileId);

    const doc = await this.prisma.document.create({
      data: {
        scope: 'MEETING',
        meetingId,
        name: input.name,
        type: input.type,
        fileId: input.fileId,
        remarks: input.remarks ?? null,
        uploadedById: user.id,
      },
      select: DOC_SELECT,
    });
    return (await this.withUploaders([doc]))[0];
  }

  private async mustSeeProject(user: AuthUser, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { AND: [{ id: projectId }, projectIdScope(user)] },
      select: { id: true },
    });
    if (!project) throw AppError.notFound('That project');
  }

  /**
   * Removing a project document.
   *
   * A project's file room is a working set - a superseded estimate, a letter
   * filed twice, a scan of the wrong page - and nothing has been published
   * from it, so it carries no immutability claim. The capability and the
   * project scope are the whole guard.
   */
  async removeFromProject(user: AuthUser, projectId: string, documentId: string) {
    await this.mustSeeProject(user, projectId);
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, projectId },
      select: { id: true, name: true, type: true, fileId: true, createdAt: true },
    });
    if (!doc) throw AppError.notFound('That document');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { code: true },
    });
    await this.erase(user, doc, project?.code ?? projectId, 'project');
    return { id: doc.id };
  }

  /**
   * Removing a meeting document.
   *
   * Different from a project document in one way that matters: at circulation
   * the meeting's documents are merged into the signed MoM as numbered
   * annexures. One that is inside a circulated document cannot be removed -
   * deleting A-02 from the system would not take it out of the PDF in two
   * hundred inboxes, it would only make this system disagree with the paper
   * everybody is holding. That is rule 6, reaching one step past the MoM
   * itself.
   *
   * One filed *after* that circulation is not in the signed PDF - the list
   * already marks it as such - so it is an ordinary attachment and goes.
   */
  async removeFromMeeting(user: AuthUser, meetingId: string, documentId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: { id: true, code: true },
    });
    if (!meeting) throw AppError.notFound('That meeting');

    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, meetingId },
      select: { id: true, name: true, type: true, fileId: true, createdAt: true },
    });
    if (!doc) throw AppError.notFound('That document');

    const circulated = await this.prisma.mom.findFirst({
      where: { meetingId, circulatedAt: { not: null } },
      orderBy: { circulatedAt: 'desc' },
      select: { circulatedAt: true, version: true },
    });
    if (circulated?.circulatedAt && doc.createdAt <= circulated.circulatedAt) {
      throw new AppError(
        'VALIDATION_FAILED',
        `"${doc.name}" was circulated as an annexure to version ${circulated.version} of the MoM, so it cannot be removed - deleting it here would not take it out of the copies people were sent. Issue a corrigendum if the minutes need to change.`,
        { field: 'documentId' },
      );
    }

    await this.erase(user, doc, meeting.code, 'meeting');
    return { id: doc.id };
  }

  /**
   * The deletion itself: the row and its audit trail in one transaction, then
   * the bytes.
   *
   * That order is deliberate. If the bytes went first and the transaction
   * then failed, the row would survive pointing at a file that no longer
   * exists - a document that lists but cannot open. The other way round the
   * worst case is an object nobody references, which costs disk and nothing
   * else, and is logged.
   *
   * The stored file is only removed when no other document shares it.
   */
  private async erase(
    user: AuthUser,
    doc: { id: string; name: string; type: string; fileId: string; createdAt: Date },
    ref: string,
    kind: 'project' | 'meeting',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id: doc.id } });
      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: 'DOCUMENT',
          objectId: doc.id,
          objectRef: ref,
          event: 'DOCUMENT_DELETED',
          detail: `Removed from the ${kind}: "${doc.name}"`,
          before: {
            name: doc.name,
            type: doc.type,
            fileId: doc.fileId,
            filedAt: doc.createdAt.toISOString(),
          },
        },
      });
    });

    const shared = await this.prisma.document.count({ where: { fileId: doc.fileId } });
    if (shared > 0) return;

    try {
      const file = await this.prisma.storedFile.findUnique({
        where: { id: doc.fileId },
        select: { objectKey: true },
      });
      if (file) await this.files.discard(doc.fileId, file.objectKey);
    } catch (err) {
      this.log.warn(
        `Document ${doc.id} is gone but its file ${doc.fileId} was not: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** You may only attach a file you uploaded — not one whose id you guessed. */
  private async mustOwnFile(user: AuthUser, fileId: string): Promise<void> {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { uploadedById: true },
    });
    if (!file || file.uploadedById !== user.id) {
      throw new AppError('VALIDATION_FAILED', 'That file does not exist.', { field: 'fileId' });
    }
  }

  /** One extra query rather than a join per row, and readable names in the list. */
  private async withUploaders<T extends { uploadedById: string }>(rows: T[]) {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => r.uploadedById))];
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, initials: true },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map(({ uploadedById, ...rest }) => ({
      ...rest,
      uploadedBy: byId.get(uploadedById) ?? { id: uploadedById, name: 'Unknown', initials: '?' },
    }));
  }
}
