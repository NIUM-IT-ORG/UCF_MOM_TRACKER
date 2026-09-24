import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { passwordDto } from '@mom/shared';
import { MastersService } from './masters.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';

/**
 * Who may be saved without contact details.
 *
 * Email is the login identifier, so a person without one can never sign in.
 * That is correct for an external invitee — `docs/01-PRD.md` says so in as
 * many words, "No login" — and a trap for anybody else: an officer created
 * with no address would be accepted here and locked out at the door, with
 * nothing on screen to explain it. So the rule is by designation, and the
 * message says which field and why.
 */
const NO_LOGIN_DESIGNATION = 'EXT';

const createUser = z
  .object({
    name: z.string().trim().min(2),
    initials: z.string().trim().min(1).max(3),
    email: z.string().trim().toLowerCase().email().optional(),
    mobile: z.string().trim().min(8).optional(),
    designationCode: z.string().trim().min(2),
    departmentId: z.string().min(1),
    /** The designation as typed; external invitees only. */
    title: z.string().trim().min(2).max(120).optional(),
    seesAllProjects: z.boolean().optional(),
    // The same rule as a reset: twelve characters and not a breach-list
    // favourite. One definition, so the two cannot drift.
    password: passwordDto.optional(),
  })
  .strict()
  .refine((u) => u.designationCode === NO_LOGIN_DESIGNATION || !!u.email, {
    message: 'An officer signs in with their email address, so this one is required.',
    path: ['email'],
  })
  .refine((u) => u.designationCode === NO_LOGIN_DESIGNATION || !!u.mobile, {
    message: 'A mobile number is required for anyone who signs in.',
    path: ['mobile'],
  });

const updateUser = z
  .object({
    name: z.string().trim().min(2).optional(),
    initials: z.string().trim().min(1).max(3).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    mobile: z.string().trim().min(8).optional(),
    designationCode: z.string().trim().min(2).optional(),
    departmentId: z.string().min(1).optional(),
    seesAllProjects: z.boolean().optional(),
  })
  .strict();

const designationBody = z
  .object({
    code: z.string().trim().toUpperCase().min(2).max(12).optional(),
    name: z.string().trim().min(2),
    band: z.string().trim().min(2),
    caps: z.array(z.string().trim().min(2)),
  })
  .strict();

/**
 * An administrator setting a password for somebody else.
 *
 * No `currentPassword`: the administrator does not have it, and the point of
 * the route is that the officer cannot sign in. `passwordDto` carries the
 * rules from docs/04-RBAC.md — at least twelve characters, and not one of
 * the handful that are on every breach list.
 */
const adminSetPassword = z.object({ newPassword: passwordDto }).strict();

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

  @Patch('users/:id')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'USER', event: 'USER_UPDATED' })
  updateUser(@Param('id') id: string, @Body() body: unknown) {
    return this.masters.updateUser(id, updateUser.parse(body));
  }

  @Put('users/:id/projects')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'USER', event: 'USER_PROJECTS_CHANGED' })
  setProjects(@Param('id') id: string, @Body() body: unknown) {
    return this.masters.setUserProjects(id, setProjects.parse(body).projects);
  }

  /**
   * Set somebody's password.
   *
   * `manage_masters`, the same capability that creates the account in the
   * first place — this cannot give anybody access they could not already
   * grant by making a new officer. It is audited, and it revokes the target's
   * sessions, because the usual reason for a reset is that the old password
   * is no longer private.
   *
   * There is no self-service equivalent and cannot be one yet: a "forgotten
   * password" link needs a mail provider, and Phase 5 has not been built.
   */
  @Post('users/:id/password')
  @RequireCapability('manage_masters')
  setPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { newPassword } = adminSetPassword.parse(body);
    return this.masters.setUserPassword(actor, id, newPassword);
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

  @Post('designations')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'DESIGNATION', event: 'DESIGNATION_CREATED' })
  createDesignation(@Body() body: unknown) {
    return this.masters.createDesignation(designationBody.parse(body));
  }

  @Patch('designations/:id')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'DESIGNATION', event: 'DESIGNATION_UPDATED' })
  updateDesignation(@Param('id') id: string, @Body() body: unknown) {
    return this.masters.updateDesignation(id, designationBody.parse(body));
  }

  @Post('designations/:id/retire')
  @RequireCapability('manage_masters')
  @Audited({ objectType: 'DESIGNATION', event: 'DESIGNATION_RETIRED' })
  retireDesignation(@Param('id') id: string) {
    return this.masters.retireDesignation(id);
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
