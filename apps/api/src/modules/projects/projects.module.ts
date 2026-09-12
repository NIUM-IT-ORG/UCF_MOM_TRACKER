import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { DocumentsService } from '../documents/documents.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, DocumentsService],
  exports: [ProjectsService, DocumentsService],
})
export class ProjectsModule {}
