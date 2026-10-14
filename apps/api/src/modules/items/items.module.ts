import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';

@Module({
  // For MonthVisibilityService. DashboardModule depends on nothing here, so
  // there is no cycle - and the alternative, a second copy of the query, is
  // how the two screens would come to disagree.
  imports: [DashboardModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
