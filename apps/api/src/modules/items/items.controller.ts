import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
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
