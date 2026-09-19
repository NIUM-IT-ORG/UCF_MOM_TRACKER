import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService, REPORTS } from './reports.service.js';
import { toCsv, toHtml } from './render.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RawResponse } from '../../common/interceptors/envelope.interceptor.js';

/**
 * The six reports, in three formats.
 *
 * No capability gate: the figures are already scoped to what the caller may
 * see, so a project director gets their projects and a ULB officer gets
 * theirs. Gating the page would only hide an officer's own work from them.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** What reports exist, for the screen that lists them. */
  @Get()
  list() {
    return REPORTS;
  }

  @Get(':key')
  @RawResponse()
  async one(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query('format') format: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const table = await this.reports.build(user, key, { from, to, projectId });

    if (format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader(
        'content-disposition',
        `attachment; filename="ucf-${key}-${table.generatedAt.slice(0, 10)}.csv"`,
      );
      // The BOM is what stops Excel on Windows reading a UTF-8 file as the
      // ANSI codepage and turning the rupee sign into mojibake.
      return '\uFEFF' + toCsv(table);
    }

    if (format === 'html' || format === 'pdf') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return toHtml(table, `${user.name} · ${user.designationCode}`);
    }

    return table;
  }
}
