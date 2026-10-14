import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DashboardService } from './dashboard.service.js';
import { MonthVisibilityService } from './month-visibility.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';

/**
 * Declared here rather than in `@mom/shared` for the same reason the MoM
 * signing DTO is: shared is ESM and this app compiles to CommonJS, so a DTO
 * that lives there cannot be changed without rebuilding both.
 */
const monthVisibilityDto = z
  .object({
    months: z
      .array(
        z
          .object({
            month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Expected a month like 2026-09'),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(600),
  })
  .strict();

/**
 * No capability is required to read the dashboard: every figure on it is
 * already scoped to what the caller may see, so an officer with one project
 * gets one project's numbers. A capability check here would only hide the
 * page from people whose own work it summarises.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly visibility: MonthVisibilityService,
  ) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  /**
   * The month configuration.
   *
   * Reading it needs the same capability as changing it. Unlike the figures,
   * this is not somebody's own work summarised - it is a list of what the
   * dashboard is withholding from everybody, and that belongs with the people
   * who can act on it. What a reader of the dashboard needs to know, the
   * dashboard itself says.
   */
  @Get('months')
  @RequireCapability('manage_masters')
  months(@CurrentUser() user: AuthUser) {
    return this.visibility.list(user);
  }

  @Put('months')
  @RequireCapability('manage_masters')
  setMonths(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    // The service writes an audit row per actual change, inside the same
    // transaction as the change.
    return this.visibility.set(user, monthVisibilityDto.parse(body).months);
  }
}
