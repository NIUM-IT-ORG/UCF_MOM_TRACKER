import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

/** Global: meetings, MoM and items all emit. Phase 5 adds the worker and the log routes. */
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
