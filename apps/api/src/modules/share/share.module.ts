import { Module } from '@nestjs/common';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

/**
 * Manual share, on top of the 27 automatic events.
 *
 * It emits through the same `NotificationsService` the state machines use, so
 * when the Phase 5 dispatcher drains that table it picks up manual shares and
 * automatic events alike — there is no second path to remember. That service
 * comes from a @Global module, so there is nothing to import here.
 */
@Module({
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
