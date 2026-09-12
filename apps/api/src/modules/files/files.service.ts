import { Injectable } from '@nestjs/common';
import type { ReserveFileDto } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { StorageService, newObjectKey } from './storage.js';

/** 25 MB. A scanned sanction order is a few hundred KB; a DPR can be large. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * What a government office actually attaches. Anything executable is absent on
 * purpose, and the list is checked again against the bytes themselves in Phase
 * 7 — an extension proves nothing.
 */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Step one: record the intent and hand back somewhere to put the bytes.
   *
   * With S3 the URL would be presigned and the bytes would never touch the
   * API. Locally it is a route on this service. Either way the client's flow
   * is identical, which is why it is shaped this way rather than as one
   * multipart POST.
   */
  async reserve(input: ReserveFileDto, userId: string) {
    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw new AppError('VALIDATION_FAILED', `Files of type ${input.mimeType} are not accepted.`, {
        field: 'mimeType',
        allowed: [...ALLOWED_MIME],
      });
    }
    if (input.sizeBytes !== undefined && input.sizeBytes > MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', `Files must be under ${MAX_BYTES / 1024 / 1024} MB.`, {
        field: 'sizeBytes',
        maxBytes: MAX_BYTES,
      });
    }

    const file = await this.prisma.storedFile.create({
      data: {
        objectKey: newObjectKey(input.fileName),
        fileName: input.fileName,
        mimeType: input.mimeType,
        uploadedById: userId,
      },
      select: { id: true },
    });

    return { fileId: file.id, uploadUrl: `/api/v1/files/${file.id}/content` };
  }

  /** Step two: the bytes arrive, and only now is the file usable. */
  async storeContent(fileId: string, bytes: Buffer, userId: string) {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { id: true, objectKey: true, uploadedById: true, uploadedAt: true },
    });
    if (!file) throw AppError.notFound('That file');

    // Only the person who reserved it may fill it, and only once.
    if (file.uploadedById !== userId) throw AppError.notFound('That file');
    if (file.uploadedAt) {
      throw new AppError('VALIDATION_FAILED', 'That file has already been uploaded.');
    }
    if (bytes.byteLength === 0) {
      throw new AppError('VALIDATION_FAILED', 'That file is empty.');
    }
    if (bytes.byteLength > MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', `Files must be under ${MAX_BYTES / 1024 / 1024} MB.`);
    }

    const stored = await this.storage.put(file.objectKey, bytes);

    return this.prisma.storedFile.update({
      where: { id: fileId },
      data: {
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        uploadedAt: new Date(),
      },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true },
    });
  }

  async read(fileId: string) {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { objectKey: true, fileName: true, mimeType: true, uploadedAt: true },
    });
    if (!file?.uploadedAt) throw AppError.notFound('That file');
    return { ...file, bytes: await this.storage.get(file.objectKey) };
  }

  /** Used by the documents service: a document may not point at empty bytes. */
  async requireUploaded(fileId: string): Promise<void> {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { uploadedAt: true },
    });
    if (!file) throw new AppError('VALIDATION_FAILED', 'That file does not exist.', { field: 'fileId' });
    if (!file.uploadedAt) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The file has not finished uploading yet.',
        { field: 'fileId' },
      );
    }
  }
}

export const FILE_LIMITS = { MAX_BYTES, ALLOWED_MIME };
