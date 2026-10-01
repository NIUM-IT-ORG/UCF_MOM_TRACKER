import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createItemDto,
  itemQueryDto,
  reportCompleteDto,
  respondDto,
  sendBackDto,
  setOwnersDto,
  updateItemDto,
} from '@mom/shared';
import { ItemsService } from './items.service.js';
import { toCsv, toHtml } from '../reports/render.js';
import { htmlToPdf } from '../../common/print/print.js';
import { RawResponse } from '../../common/interceptors/envelope.interceptor.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';

@Controller('items')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.items.list(user, itemQueryDto.parse(query));
  }

  /**
   * The register as a file.
   *
   * Before `:id` deliberately — Express matches in order, and
   * `/items/export` would otherwise be read as an item whose id is "export".
   *
   * `@Res()` without `passthrough`, writing every branch: Nest replies to a
   * returned object with `res.json()`, and a Buffer is an object. That is
   * what once sent a PDF as `{"type":"Buffer","data":[...]}`.
   */
  @Get('export')
  @RawResponse()
  async export(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const { format, ...filters } = query;
    const table = await this.items.exportTable(user, itemQueryDto.parse(filters));
    const stamp = table.generatedAt.slice(0, 10);

    if (format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="ucf-register-${stamp}.csv"`);
      // The BOM stops Excel on Windows reading UTF-8 as the ANSI codepage.
      res.send('\uFEFF' + toCsv(table));
      return;
    }

    const html = toHtml(table, `${user.name} · ${user.designationCode}`);

    if (format === 'pdf') {
      const bytes = await htmlToPdf(html);
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', `inline; filename="ucf-register-${stamp}.pdf"`);
      res.send(Buffer.from(bytes));
      return;
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.get(user, id);
  }

  @Post()
  @RequireCapability('create_items')
  @Audited({ objectType: 'ITEM', event: 'ITEM_CREATED' })
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.items.create(user, createItemDto.parse(body));
  }

  @Patch(':id')
  @RequireCapability('create_items')
  @Audited({ objectType: 'ITEM', event: 'ITEM_UPDATED' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.update(user, id, updateItemDto.parse(body));
  }

  /**
   * Remove an item raised in error. Only while it is inert — the service
   * refuses once the MoM has been circulated, because by then somebody has
   * been made accountable for it.
   */
  @Delete(':id')
  @RequireCapability('create_items')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.remove(user, id);
  }

  @Put(':id/owners')
  @RequireCapability('create_items')
  @Audited({ objectType: 'ITEM', event: 'ITEM_OWNERS_CHANGED' })
  setOwners(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.setOwners(user, id, setOwnersDto.parse(body));
  }

  /** An owner reporting their own work done — hence `update_own_item`. */
  @Post(':id/report-complete')
  @RequireCapability('update_own_item')
  @Audited({ objectType: 'ITEM', event: 'ITEM_REPORTED_COMPLETE' })
  reportComplete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.reportComplete(user, id, reportCompleteDto.parse(body));
  }

  @Post(':id/confirm')
  @RequireCapability('confirm_completion')
  @Audited({ objectType: 'ITEM', event: 'ITEM_CONFIRMED' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.confirm(user, id);
  }

  @Post(':id/send-back')
  @RequireCapability('confirm_completion')
  @Audited({ objectType: 'ITEM', event: 'ITEM_SENT_BACK' })
  sendBack(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.sendBack(user, id, sendBackDto.parse(body));
  }

  @Post(':id/reopen')
  @RequireCapability('confirm_completion')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.reopen(user, id, sendBackDto.parse(body));
  }

  @Post(':id/respond')
  @RequireCapability('respond_clarification')
  @Audited({ objectType: 'ITEM', event: 'CLARIFICATION_RESPONDED' })
  respond(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.respond(user, id, respondDto.parse(body));
  }

  /** No capability: the officer who raised it decides whether the answer will do. */
  @Post(':id/close')
  @Audited({ objectType: 'ITEM', event: 'CLARIFICATION_CLOSED' })
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.items.close(user, id);
  }

  @Post(':id/updates')
  @RequireCapability('update_own_item')
  addUpdate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.items.addUpdate(user, id, reportCompleteDto.parse(body));
  }
}
