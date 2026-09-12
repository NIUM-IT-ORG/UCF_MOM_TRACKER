import { Injectable } from '@nestjs/common';
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

  async listForMeeting(user: AuthUser, meetingId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: { id: true },
    });
    if (!meeting) throw AppError.notFound('That meeting');

    const rows = await this.prisma.document.findMany({
      where: { meetingId },
      select: DOC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return this.withUploaders(rows);
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
