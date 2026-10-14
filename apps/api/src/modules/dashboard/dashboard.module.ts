import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { MonthVisibilityService } from './month-visibility.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, MonthVisibilityService],
  // The register asks the same question, and there must be one answer to it.
  exports: [MonthVisibilityService],
})
export class DashboardModule {}
