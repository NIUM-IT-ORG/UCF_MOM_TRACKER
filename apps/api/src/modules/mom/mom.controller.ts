import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { minutesDto, momDecisionDto } from '@mom/shared';
import { MomService } from './mom.service.js';
import { MomDocumentService } from './mom.document.js';
import { MomPrintService } from './mom.print.js';
import { MinutesService } from '../minutes/minutes.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';
import { RawResponse } from '../../common/interceptors/envelope.interceptor.js';

const cuid = z.string().trim().min(1);

/**
 * Approving is now two decisions in one action: this document is correct, and
 * this officer should sign it. The second is required — an approved MoM with
 * nobody named is the "approved, awaiting signature, nothing happens" state
 * the client reported.
 */
const momApproveDto = z
  .object({ signatoryId: cuid, remark: z.string().trim().max(2000).optional() })
  .strict();

/**
 * Signing is an act in the system, so nothing is required. `fileId` is for a
 * wet-signed scan filed afterwards for the physical record; it is not what
 * makes the MoM signed.
 *
 * Declared here rather than in `@mom/shared` deliberately: shared is ESM and
 * the API compiles to CommonJS, so a DTO that lives there cannot be changed
 * without rebuilding both. Keeping this one local means a fix to the signing
 * route is a single-file patch.
 */
const momSignDto = z.object({ fileId: cuid.optional() }).strict();

/**
 * The register lives at `/mom`; everything else hangs off the meeting, because
 * a MoM has no existence apart from the meeting it minutes.
 */
@Controller()
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class MomController {
  constructor(
    private readonly mom: MomService,
    private readonly minutes: MinutesService,
    private readonly document: MomDocumentService,
    private readonly print: MomPrintService,
  ) {}

  @Get('mom')
  register(@CurrentUser() user: AuthUser, @Query('state') state?: string) {
    return this.mom.register(user, state);
  }

  // ── minutes ──────────────────────────────────────────────────────────

  @Get('meetings/:id/minutes')
  getMinutes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.minutes.get(user, id);
  }

  @Post('meetings/:id/minutes')
  @RequireCapability('record_minutes')
  @Audited({ objectType: 'MINUTES', event: 'MINUTES_SAVED' })
  saveMinutes(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.minutes.save(user, id, minutesDto.parse(body));
  }

  @Get('meetings/:id/minutes/versions')
  minutesVersions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.minutes.versions(user, id);
  }

  // ── the MoM machine ──────────────────────────────────────────────────

  @Get('meetings/:id/mom')
  forMeeting(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.forMeeting(user, id);
  }

  @Get('meetings/:id/mom/history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.history(user, id);
  }

  @Post('meetings/:id/mom/generate')
  @RequireCapability('record_minutes')
  @Audited({ objectType: 'MOM', event: 'MOM_GENERATED' })
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.generate(user, id);
  }

  @Post('meetings/:id/mom/submit')
  @RequireCapability('record_minutes')
  @Audited({ objectType: 'MOM', event: 'MOM_SUBMITTED' })
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.submit(user, id);
  }

  /** Who this MoM can be routed to for signature — for the approval dialog. */
  @Get('meetings/:id/mom/signatories')
  @RequireCapability('approve_mom')
  signatories(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.eligibleSignatories(user, id);
  }

  @Post('meetings/:id/mom/approve')
  @RequireCapability('approve_mom')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    // A remark is optional on approve, and mandatory on the two refusals.
    const dto = momApproveDto.parse(body);
    return this.mom.approve(user, id, dto.signatoryId, dto.remark || undefined);
  }

  @Post('meetings/:id/mom/return')
  @RequireCapability('approve_mom')
  returnForChanges(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.mom.returnForChanges(user, id, momDecisionDto.parse(body));
  }

  @Post('meetings/:id/mom/reject')
  @RequireCapability('approve_mom')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.mom.reject(user, id, momDecisionDto.parse(body));
  }

  @Post('meetings/:id/mom/sign')
  // `sign_mom` gets the request this far. Which officer may sign THIS MoM is a
  // different question, answered by assertMaySign in the service — a capability
  // cannot express "the one person it was routed to".
  @RequireCapability('sign_mom')
  @Audited({ objectType: 'MOM', event: 'MOM_CIRCULATED' })
  sign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.mom.sign(user, id, momSignDto.parse(body));
  }

  /**
   * The document itself, as HTML.
   *
   * docs/03 asks for a PDF rendered by Puppeteer. That is deferred to Phase 7
   * for a reason worth stating: this build has to run on the client's own
   * Windows machine with no Docker, and bundling a headless Chromium is a
   * ~300 MB download plus a per-platform install for something a browser
   * already does. So the API serves print-ready HTML carrying `@page { size:A4 }`
   * and the DRAFT watermark, and the screen offers "Save as PDF". The output is
   * byte-identical to what a server-side renderer would produce from the same
   * template, because there is only one template - so adding Puppeteer later
   * for e-mail attachments changes nothing about the document.
   */
  @Get('meetings/:id/mom.html')
  @RawResponse()
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('x-content-type-options', 'nosniff')
  async document_(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { html } = await this.document.html(user, id);
    return html;
  }

  /**
   * The same document as a PDF, with the tabled papers behind it.
   *
   * The minutes are printed from the one template by a browser already on the
   * machine, and then each annexure is appended: a separator page carrying its
   * reference, then the document itself. A file that cannot be placed inside a
   * PDF — a .docx, say — gets a page saying so rather than being left out, so
   * a bundle never quietly carries fewer annexures than the minutes list.
   */
  @Get('meetings/:id/mom.pdf')
  @RawResponse()
  @Header('x-content-type-options', 'nosniff')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    // `@Res()` without `passthrough`, writing the response here rather than
    // returning the Buffer: Nest replies to a returned object with
    // `res.json()`, and a Buffer is an object, so the minutes went out as
    // `{"type":"Buffer","data":[…]}` under a PDF content type. See the note
    // on the agenda route and binary-response.spec.ts.
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, fileName } = await this.print.pdf(user, id);

    /*
     * Set here, not with `@Header`: Nest applies that metadata before the
     * handler runs, so a failure would answer `content-type: application/pdf`
     * carrying a JSON error body — the same unreadable failure, hiding the
     * message that says what to fix.
     */
    res.setHeader('content-type', 'application/pdf');
    // `inline`, not `attachment`: the officer nearly always wants to look at
    // it first, and every browser offers Save from its own viewer.
    res.setHeader('content-disposition', `inline; filename="${fileName}"`);
    res.send(Buffer.from(bytes));
  }

  @Post('meetings/:id/mom/corrigendum')
  @RequireCapability('record_minutes')
  corrigendum(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.corrigendum(user, id);
  }
}
