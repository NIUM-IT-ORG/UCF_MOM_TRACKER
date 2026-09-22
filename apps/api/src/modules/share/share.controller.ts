import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { shareDto } from '@mom/shared';
import { ShareService } from './share.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';

/** The same five subjects `shareDto` accepts, for the path parameter. */
const subjectTypeParam = z.enum(['MEETING', 'MOM', 'ITEM', 'PROJECT', 'REPORT']);

/**
 * `POST /share` — P5-10.
 *
 * One route for all eight share surfaces in `docs/06` §"Manual share". The
 * subject type is in the body rather than the path because the rules are
 * identical whatever is being shared, and eight near-identical routes is eight
 * places for the scope check to be forgotten from.
 *
 * The recipient picker draws from `GET /masters/users`, which is already
 * scoped — see `visibleUsersScope`. It is not re-exposed here.
 */
@Controller()
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post('share')
  @RequireCapability('share_object')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    // The audit row is written inside the service transaction rather than by
    // the interceptor: only the service knows the subject's human reference,
    // and an audit entry that says "MEETING <cuid>" is unreadable a year on.
    return this.share.share(user, shareDto.parse(body));
  }

  /**
   * What has been sent about this subject — automatic events and manual
   * shares together, which is what "has anyone told them?" actually means.
   *
   * No capability, but scoped: anyone who can see the subject may see its
   * communication history, and the service re-reads the subject through its
   * own filter before returning a single row.
   */
  @Get('share/:subjectType/:subjectId')
  history(
    @CurrentUser() user: AuthUser,
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
  ) {
    // Parsed rather than cast: an unrecognised subject type must be a 422,
    // not an unscoped read against a table name the caller chose.
    const type = subjectTypeParam.parse(subjectType);
    return this.share.history(user, type, subjectId);
  }
}
