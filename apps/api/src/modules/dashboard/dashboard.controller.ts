import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';

/**
 * No capability is required to read the dashboard: every figure on it is
 * already scoped to what the caller may see, so an officer with one project
 * gets one project's numbers. A capability check here would only hide the
 * page from people whose own work it summarises.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }
}
