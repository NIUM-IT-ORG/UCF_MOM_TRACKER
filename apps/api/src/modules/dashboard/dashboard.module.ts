import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { MonthVisibilityService } from './month-visibility.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, MonthVisibilityService],
})
export class DashboardModule {}
