import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  createProjectDto,
  documentInput,
  ulbDto,
  updateProjectDto,
} from '@mom/shared';
import { z } from 'zod';
import { ProjectsService } from './projects.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';

/**
 * Who is on a project, set from the project's own screen.
 *
 * The whole list every time: a removal is then the same operation as an
 * addition, and sending it twice changes nothing the second time. Declared
 * here rather than in `packages/shared` because only this route parses it —
 * the same reason the masters routes declare theirs locally.
 */
const projectMembersDto = z
  .object({
    members: z.array(
      z.object({
        userId: z.string().min(1),
        roleOnProject: z.string().trim().min(2, 'say what they do on this project'),
      }),
    ),
  })
  .strict();

@Controller('projects')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly documents: DocumentsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.get(user, id);
  }

  @Post()
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'PROJECT', event: 'PROJECT_CREATED' })
  create(@Body() body: unknown) {
    return this.projects.create(createProjectDto.parse(body));
  }

  @Patch(':id')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'PROJECT', event: 'PROJECT_UPDATED' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.update(user, id, updateProjectDto.parse(body));
  }

  @Put(':id/members')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'PROJECT', event: 'PROJECT_MEMBERS_CHANGED' })
  setMembers(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.setMembers(user, id, projectMembersDto.parse(body).members);
  }

  @Post(':id/ulbs')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'ULB', event: 'ULB_ADDED' })
  addUlb(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.addUlb(user, id, ulbDto.parse(body));
  }

  @Patch(':id/ulbs/:ulbId')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'ULB', event: 'ULB_UPDATED' })
  updateUlb(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('ulbId') ulbId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateUlb(user, id, ulbId, ulbDto.partial().parse(body));
  }

  @Get(':id/documents')
  listDocuments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('type') type?: string,
  ) {
    return this.documents.listForProject(user, id, type);
  }

  @Post(':id/documents')
  @RequireCapability('manage_project_docs')
  @Audited({ objectType: 'DOCUMENT', event: 'DOCUMENT_ADDED' })
  addDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    // Name, type and file all required - see documentInput in packages/shared.
    return this.documents.addToProject(user, id, documentInput.parse(body));
  }
}
