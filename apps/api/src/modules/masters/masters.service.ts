import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { visibleUsersScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { hashPassword } from '../auth/auth.service.js';

export interface CreateUserInput {
  name: string;
  initials: string;
  email: string;
  mobile: string;
  designationCode: string;
  departmentId: string;
  seesAllProjects?: boolean;
  password?: string;
}

@Injectable()
export class MastersService {
  constructor(private readonly prisma: PrismaService) {}

  // ── users ────────────────────────────────────────────────────────────

  /**
   * Scoped: an officer sees the people on their own projects, plus the ones who
   * see every project anyway. This is the list the Share picker will draw from,
   * and it is why you cannot share with someone you cannot see.
   */
  async listUsers(user: AuthUser) {
    return this.prisma.user.findMany({
      where: visibleUsersScope(user),
      select: {
        id: true,
        name: true,
        initials: true,
        email: true,
        mobile: true,
        accountState: true,
        seesAllProjects: true,
        lastLoginAt: true,
        designation: { select: { code: true, name: true, band: true } },
        department: { select: { id: true, name: true } },
        projects: { select: { project: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getUser(user: AuthUser, id: string) {
    const found = await this.prisma.user.findFirst({
      where: { AND: [{ id }, visibleUsersScope(user)] },
      select: {
        id: true,
        name: true,
        initials: true,
        email: true,
        mobile: true,
        accountState: true,
        seesAllProjects: true,
        lastLoginAt: true,
        designation: { select: { code: true, name: true, band: true, caps: true } },
        department: { select: { id: true, name: true } },
        projects: {
          select: {
            roleOnProject: true,
            project: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    // Out of scope reads as absent, deliberately - see docs/04-RBAC.md 5.
    if (!found) throw AppError.notFound('That user');
    return found;
  }

  async createUser(input: CreateUserInput) {
    const designation = await this.prisma.designation.findUnique({
      where: { code: input.designationCode },
      select: { id: true },
    });
    if (!designation) throw AppError.notFound(`Designation ${input.designationCode}`);

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('VALIDATION_FAILED', 'That email address is already in use.', {
        field: 'email',
      });
    }

    return this.prisma.user.create({
      data: {
        name: input.name,
        initials: input.initials.toUpperCase().slice(0, 3),
        email: input.email.toLowerCase(),
        mobile: input.mobile,
        designationId: designation.id,
        departmentId: input.departmentId,
        seesAllProjects: input.seesAllProjects ?? false,
        // No password means no sign-in: the account exists to receive
        // notifications and be named in attendance. That is the EXT case.
        passwordHash: input.password ? await hashPassword(input.password) : null,
        accountState: input.password ? 'ACTIVE' : 'INVITE_ONLY',
      },
      select: { id: true, name: true, email: true, accountState: true },
    });
  }

  /** Replaces the whole mapping, so removals are as easy as additions. */
  async setUserProjects(
    userId: string,
    mappings: { projectId: string; roleOnProject: string }[],
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw AppError.notFound('That user');

    await this.prisma.$transaction([
      this.prisma.projectMember.deleteMany({ where: { userId } }),
      this.prisma.projectMember.createMany({
        data: mappings.map((m) => ({
          userId,
          projectId: m.projectId,
          roleOnProject: m.roleOnProject,
        })),
      }),
    ]);

    return this.prisma.projectMember.findMany({
      where: { userId },
      select: {
        roleOnProject: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async setAccountState(userId: string, state: 'ACTIVE' | 'SUSPENDED') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw AppError.notFound('That user');
    if (state === 'ACTIVE' && !user.passwordHash) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This account has no password, so it cannot be activated. Set one first.',
      );
    }

    // Suspending must end the sessions too, or the officer keeps working for
    // up to fifteen minutes on an access token that is still valid.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { accountState: state, lockedUntil: null },
        select: { id: true, name: true, accountState: true },
      });
      if (state === 'SUSPENDED') {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_SUSPENDED' },
        });
      }
      return updated;
    });
  }

  // ── designations and departments ─────────────────────────────────────

  listDesignations() {
    return this.prisma.designation.findMany({
      where: { retiredAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        band: true,
        caps: true,
        isSystem: true,
        _count: { select: { users: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  listDepartments() {
    return this.prisma.department.findMany({
      where: { retiredAt: null },
      select: { id: true, name: true, _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createDepartment(name: string) {
    const existing = await this.prisma.department.findUnique({ where: { name } });
    if (existing) {
      throw new AppError('VALIDATION_FAILED', 'A department with that name already exists.');
    }
    return this.prisma.department.create({ select: { id: true, name: true }, data: { name } });
  }

  /**
   * Retire, never delete. People are named in minutes that must stay readable
   * for seven years; deleting the department they belonged to would leave those
   * records referring to nothing.
   */
  async retireDepartment(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, _count: { select: { users: true } } },
    });
    if (!department) throw AppError.notFound('That department');
    return this.prisma.department.update({
      where: { id },
      data: { retiredAt: new Date() },
      select: { id: true, name: true, retiredAt: true },
    });
  }
}
