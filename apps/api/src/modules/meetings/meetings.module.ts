import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';
import { AgendaService } from './agenda.service.js';
import { AttendanceService } from './attendance.service.js';
import { DocumentsService } from '../documents/documents.service.js';

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService, AgendaService, AttendanceService, DocumentsService],
  exports: [MeetingsService, AgendaService, AttendanceService],
})
export class MeetingsModule {}
