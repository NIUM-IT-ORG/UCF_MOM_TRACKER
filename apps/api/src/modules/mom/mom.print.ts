import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer-core';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { StorageService } from '../files/storage.js';
import { MomDocumentService } from './mom.document.js';
import { findBrowser, noBrowserMessage } from './browser.js';
import { mergeAnnexures, type Annexure } from './mom.pdf.js';
import { DOCUMENT_TYPE_LABEL } from '@mom/shared';

/**
 * The MoM as a single PDF, with the tabled papers behind it.
 *
 * Printing is done by a browser the machine already has — see browser.ts for
 * why nothing is bundled. The browser is launched per request and closed in a
 * `finally`: a leaked headless Chrome is 150 MB of resident memory that
 * nobody notices until the fourth one.
 */
@Injectable()
export class MomPrintService {
  private readonly log = new Logger('MoM PDF');

  constructor(
    private readonly prisma: PrismaService,
    private readonly document: MomDocumentService,
    private readonly storage: StorageService,
  ) {}

  async pdf(user: AuthUser, meetingId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const { html, code } = await this.document.html(user, meetingId);

    const minutes = await this.render(html);
    const annexures = await this.collect(user, meetingId);

    const { pdf, appended } = await mergeAnnexures(minutes, annexures);

    const missed = appended.filter((a) => !a.embedded);
    this.log.log(
      `${code}: ${annexures.length} annexure(s), ${appended.reduce((n, a) => n + a.pages, 0)} added page(s)` +
        (missed.length ? ` — not embedded: ${missed.map((m) => m.ref).join(', ')}` : ''),
    );

    return { bytes: pdf, fileName: `${code.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf` };
  }

  /** The minutes themselves, printed from the one template. */
  private async render(html: string): Promise<Uint8Array> {
    const executablePath = findBrowser();
    if (!executablePath) throw new AppError('INTERNAL', noBrowserMessage());

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        // --no-sandbox is required to run as a service account on Linux and is
        // harmless here: the only page ever loaded is HTML this server just
        // generated, never anything fetched from outside.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      const page = await browser.newPage();
      // `setContent` rather than a URL: the document is already in hand, and a
      // round trip through the server would need the request's own cookie.
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
      // The template carries @page { size:A4 } and its own margins, so the
      // margins here are zero and printBackground keeps the crest, the rules
      // and the green signature panel.
      return await page.pdf({
        format: 'a4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        'INTERNAL',
        `The document could not be printed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    } finally {
      await browser?.close().catch(() => {
        // Closing failed; the process will be reaped. Nothing useful to do.
      });
    }
  }

  /** The papers tabled at this meeting, with their bytes, in the order they were added. */
  private async collect(user: AuthUser, meetingId: string): Promise<Annexure[]> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { AND: [{ id: meetingId }, meetingScope(user)] },
      select: {
        documents: {
          select: {
            name: true,
            type: true,
            file: { select: { objectKey: true, fileName: true, mimeType: true, uploadedAt: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!meeting) throw AppError.notFound('That meeting');

    const out: Annexure[] = [];
    for (const [n, d] of meeting.documents.entries()) {
      const ref = `A-${String(n + 1).padStart(2, '0')}`;
      // A reserved-but-never-uploaded row has no bytes. It still gets a page,
      // because section 7 of the minutes lists it.
      if (!d.file.uploadedAt) {
        out.push({
          ref,
          name: d.name,
          fileName: d.file.fileName,
          typeLabel: DOCUMENT_TYPE_LABEL[d.type] ?? String(d.type),
          mimeType: 'application/octet-stream',
          bytes: new Uint8Array(),
        });
        continue;
      }
      try {
        const bytes = await this.storage.get(d.file.objectKey);
        out.push({
          ref,
          name: d.name,
          fileName: d.file.fileName,
          typeLabel: DOCUMENT_TYPE_LABEL[d.type] ?? String(d.type),
          mimeType: d.file.mimeType,
          bytes: new Uint8Array(bytes),
        });
      } catch {
        // The row is there and the bytes are not. Say so on the page rather
        // than producing a bundle that is quietly one annexure short.
        out.push({
          ref,
          name: d.name,
          fileName: d.file.fileName,
          typeLabel: DOCUMENT_TYPE_LABEL[d.type] ?? String(d.type),
          mimeType: 'application/octet-stream',
          bytes: new Uint8Array(),
        });
      }
    }
    return out;
  }
}
