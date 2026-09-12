import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Capability } from '@mom/shared';
import { AccessService } from './access.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { AppError } from '../../common/app-error.js';

const capsBody = z.object({ caps: z.array(z.string()) }).strict();

@Controller('access')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  /** Readable by anyone signed in: knowing the rules is not a privilege. */
  @Get('matrix')
  matrix() {
    return this.access.matrix();
  }

  @Put('matrix/:code')
  @RequireCapability('manage_access')
  setCaps(@Param('code') code: string, @Body() body: unknown) {
    const { caps } = capsBody.parse(body);
    return this.access.setCapabilities(code.toUpperCase(), caps as Capability[]);
  }

  /**
   * Your own effective access needs no capability - everyone may ask what they
   * themselves can do. Asking about somebody else needs `manage_access`.
   */
  @Get('effective/:userId')
  effective(@Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    if (userId !== user.id && !user.caps.includes('manage_access')) {
      throw AppError.forbidden('manage_access');
    }
    return this.access.effective(userId);
  }
}
