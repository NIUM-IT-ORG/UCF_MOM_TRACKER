import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { MastersService } from './masters.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';

const createUser = z
  .object({
    name: z.string().trim().min(2),
    initials: z.string().trim().min(1).max(3),
    email: z.string().trim().toLowerCase().email(),
    mobile: z.string().trim().min(8),
    designationCode: z.string().trim().min(2),
    departmentId: z.string().min(1),
    seesAllProjects: z.boolean().optional(),
    password: z.string().min(12).optional(),
  })
  .strict();

const setProjects = z
  .object({
    projects: z.array(
      z.object({ projectId: z.string().min(1), roleOnProject: z.string().trim().min(2) }),
    ),
  })
  .strict();

const accountState = z.object({ state: z.enum(['ACTIVE', 'SUSPENDED']) }).strict();
const departmentBody = z.object({ name: z.string().trim().min(2) }).strict();

@Controller()
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  // Reading people is open to anyone signed in, but scoped: the list only
  // contains officers on projects the caller can see.
  @Get('users')
  listUsers(@CurrentUser() user: AuthUser) {
    return this.masters.listUsers(user);
  }

  @Get('users/:id')
  getUser(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.masters.getUser(user, id);
  }

  @Post('users')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'USER', event: 'USER_CREATED' })
  createUser(@Body() body: unknown) {
    return this.masters.createUser(createUser.parse(body));
  }

  @Put('users/:id/projects')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'USER', event: 'USER_PROJECTS_CHANGED' })
  setProjects(@Param('id') id: string, @Body() body: unknown) {
    return this.masters.setUserProjects(id, setProjects.parse(body).projects);
  }

  @Post('users/:id/state')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'USER', event: 'ACCOUNT_STATE_CHANGED' })
  setState(@Param('id') id: string, @Body() body: unknown) {
    return this.masters.setAccountState(id, accountState.parse(body).state);
  }

  @Get('designations')
  listDesignations() {
    return this.masters.listDesignations();
  }

  @Get('departments')
  listDepartments() {
    return this.masters.listDepartments();
  }

  @Post('departments')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'DEPARTMENT', event: 'DEPARTMENT_CREATED' })
  createDepartment(@Body() body: unknown) {
    return this.masters.createDepartment(departmentBody.parse(body).name);
  }

  @Post('departments/:id/retire')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'DEPARTMENT', event: 'DEPARTMENT_RETIRED' })
  retireDepartment(@Param('id') id: string) {
    return this.masters.retireDepartment(id);
  }
}
