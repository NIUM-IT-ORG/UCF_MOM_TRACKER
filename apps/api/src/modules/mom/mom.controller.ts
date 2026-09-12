import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { minutesDto, momDecisionDto, momSignDto } from '@mom/shared';
import { MomService } from './mom.service.js';
import { MomDocumentService } from './mom.document.js';
import { MinutesService } from '../minutes/minutes.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';
import { RawResponse } from '../../common/interceptors/envelope.interceptor.js';

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

  @Post('meetings/:id/mom/approve')
  @RequireCapability('approve_mom')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    // A remark is optional on approve, and mandatory on the two refusals.
    const remark =
      body && typeof body === 'object' && 'remark' in body
        ? String((body as { remark: unknown }).remark ?? '').trim()
        : '';
    return this.mom.approve(user, id, remark || undefined);
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
  @RequireCapability('upload_signed')
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

  @Post('meetings/:id/mom/corrigendum')
  @RequireCapability('record_minutes')
  corrigendum(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mom.corrigendum(user, id);
  }
}
