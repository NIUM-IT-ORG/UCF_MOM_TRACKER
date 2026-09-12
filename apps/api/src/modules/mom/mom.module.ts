import { Module } from '@nestjs/common';
import { MomController } from './mom.controller.js';
import { MomService } from './mom.service.js';
import { MomDocumentService } from './mom.document.js';
import { MinutesService } from '../minutes/minutes.service.js';
import { MeetingsModule } from '../meetings/meetings.module.js';

/**
 * Minutes live here rather than in their own module: they have no life apart
 * from the MoM that locks them, and the two are always changed together.
 */
@Module({
  imports: [MeetingsModule],
  controllers: [MomController],
  providers: [MomService, MomDocumentService, MinutesService],
  exports: [MomService, MomDocumentService, MinutesService],
})
export class MomModule {}
