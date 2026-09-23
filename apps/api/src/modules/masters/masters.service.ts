import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { visibleUsersScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { hashPassword } from '../auth/auth.service.js';
import {
  lockoutMessage,
  unknownCapabilities,
  wouldLockEverybodyOut,
  type DesignationRow,
} from './lockout.js';

export interface UpdateUserInput {
  name?: string;
  initials?: string;
  email?: string;
  mobile?: string;
  designationCode?: string;
  departmentId?: string;
  seesAllProjects?: boolean;
}

export interface DesignationInput {
  code?: string;
  name: string;
  band: string;
  caps: string[];
}

export interface CreateUserInput {
  name: string;
  initials: string;
  /** Optional only for a designation that cannot sign in; the DTO enforces it. */
  email?: string;
  mobile?: string;
  /** The designation as typed, printed in place of the designation row. */
  title?: string;
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

    // Only when one was given. Many people may have no address — Postgres
    // allows that under the unique index — but two may not share one.
    const email = input.email?.toLowerCase() ?? null;
    if (email) {
      const existing = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        throw new AppError('VALIDATION_FAILED', 'That email address is already in use.', {
          field: 'email',
        });
      }
    }

    return this.prisma.user.create({
      data: {
        name: input.name,
        initials: input.initials.toUpperCase().slice(0, 3),
        email,
        mobile: input.mobile ?? null,
        title: input.title ?? null,
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

  /**
   * Editing an officer. Their designation can change — a transfer or a
   * promotion is the ordinary case — and with it everything they may do,
   * because capability is computed from the designation and never stored on
   * the person.
   *
   * The email is the sign-in identity, so a clash is refused rather than
   * merged.
   */
  async updateUser(id: string, input: UpdateUserInput) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!user) throw AppError.notFound('That officer');

    let designationId: string | undefined;
    if (input.designationCode) {
      const designation = await this.prisma.designation.findUnique({
        where: { code: input.designationCode },
        select: { id: true, retiredAt: true },
      });
      if (!designation || designation.retiredAt) {
        throw AppError.notFound(`Designation ${input.designationCode}`);
      }
      designationId = designation.id;
    }

    const email = input.email?.toLowerCase();
    if (email && email !== user.email) {
      const clash = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (clash) {
        throw new AppError('VALIDATION_FAILED', 'That email address is already in use.', {
          field: 'email',
        });
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        initials: input.initials?.toUpperCase().slice(0, 3),
        email,
        mobile: input.mobile,
        designationId,
        departmentId: input.departmentId,
        seesAllProjects: input.seesAllProjects,
      },
      select: {
        id: true,
        name: true,
        email: true,
        accountState: true,
        designation: { select: { code: true, name: true } },
      },
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

  /**
   * Creating and editing a designation, capabilities included.
   *
   * Two guards, both of which matter more than they look:
   *
   * - a capability that the code does not define would sit in the database
   *   looking authoritative and granting nothing, which is worse than a typo
   *   that fails;
   * - and the last active holder of `manage_masters` or `manage_access` may
   *   not be removed, or nobody can ever edit this screen again.
   */
  async createDesignation(input: DesignationInput) {
    const code = (input.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9-]{1,11}$/.test(code)) {
      throw new AppError('VALIDATION_FAILED', 'Give it a short code like PDMC or ULB-EO.', {
        field: 'code',
      });
    }
    await this.assertCapabilitiesExist(input.caps);

    const existing = await this.prisma.designation.findUnique({
      where: { code },
      select: { id: true, retiredAt: true },
    });
    if (existing) {
      throw new AppError(
        'VALIDATION_FAILED',
        existing.retiredAt
          ? 'A retired designation already uses that code. Choose another.'
          : 'A designation with that code already exists.',
        { field: 'code' },
      );
    }

    return this.prisma.designation.create({
      data: {
        code,
        name: input.name,
        band: input.band,
        caps: input.caps,
        isSystem: false,
      },
      select: { id: true, code: true, name: true, band: true, caps: true, isSystem: true },
    });
  }

  async updateDesignation(id: string, input: DesignationInput) {
    const designation = await this.prisma.designation.findUnique({
      where: { id },
      select: { id: true, code: true, retiredAt: true },
    });
    if (!designation || designation.retiredAt) throw AppError.notFound('That designation');

    await this.assertCapabilitiesExist(input.caps);
    await this.assertNobodyIsLockedOut({ id, caps: input.caps });

    return this.prisma.designation.update({
      where: { id },
      data: { name: input.name, band: input.band, caps: input.caps },
      select: { id: true, code: true, name: true, band: true, caps: true, isSystem: true },
    });
  }

  /**
   * Retire, never delete — the same reason as departments. Minutes name the
   * designation somebody held at the time, and those records have to stay
   * readable.
   */
  async retireDesignation(id: string) {
    const designation = await this.prisma.designation.findUnique({
      where: { id },
      select: { id: true, retiredAt: true, _count: { select: { users: true } } },
    });
    if (!designation || designation.retiredAt) throw AppError.notFound('That designation');
    if (designation._count.users > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${designation._count.users} officer(s) still hold that designation. Move them to another one first.`,
      );
    }
    await this.assertNobodyIsLockedOut({ id, caps: [], retired: true });

    return this.prisma.designation.update({
      where: { id },
      data: { retiredAt: new Date() },
      select: { id: true, code: true, retiredAt: true },
    });
  }

  private async assertCapabilitiesExist(caps: string[]): Promise<void> {
    const unknown = unknownCapabilities(caps);
    if (unknown.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `No such capability: ${unknown.join(', ')}. The list comes from the code, so this is a typo or an old name.`,
        { field: 'caps', unknown },
      );
    }
  }

  private async assertNobodyIsLockedOut(change: {
    id: string;
    caps: string[];
    retired?: boolean;
  }): Promise<void> {
    const rows = await this.prisma.designation.findMany({
      where: { retiredAt: null },
      select: {
        id: true,
        code: true,
        caps: true,
        _count: { select: { users: { where: { accountState: 'ACTIVE' } } } },
      },
    });
    const current: DesignationRow[] = rows.map((d) => ({
      id: d.id,
      code: d.code,
      caps: d.caps,
      activeUsers: d._count.users,
    }));

    const lost = wouldLockEverybodyOut(current, change);
    if (lost.length > 0) {
      throw new AppError('VALIDATION_FAILED', lockoutMessage(lost), { field: 'caps', lost });
    }
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
