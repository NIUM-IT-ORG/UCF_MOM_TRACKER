import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateProjectDto, UlbDto, UpdateProjectDto } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { canSeeProject, projectIdScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';

/** What a list row needs, and nothing more. */
const LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  fullName: true,
  status: true,
  implementingAgency: true,
  costCr: true,
  debtSanctionedCr: true,
  debtDrawnCr: true,
  startDate: true,
  targetEndDate: true,
  _count: { select: { ulbs: true, members: true, documents: true } },
} satisfies Prisma.ProjectSelect;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Scoped at the repository, which is the only place it can be relied upon. */
  async list(user: AuthUser) {
    const rows = await this.prisma.project.findMany({
      where: projectIdScope(user),
      select: LIST_SELECT,
      orderBy: { code: 'asc' },
    });
    return rows.map(serialise);
  }

  async get(user: AuthUser, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { AND: [{ id }, projectIdScope(user)] },
      select: {
        ...LIST_SELECT,
        description: true,
        createdAt: true,
        updatedAt: true,
        ulbs: {
          select: {
            id: true,
            code: true,
            name: true,
            wards: true,
            nodalName: true,
            contact: true,
            isLead: true,
          },
          orderBy: [{ isLead: 'desc' }, { code: 'asc' }],
        },
        members: {
          select: {
            roleOnProject: true,
            user: {
              select: {
                id: true,
                name: true,
                initials: true,
                email: true,
                mobile: true,
                accountState: true,
                designation: { select: { code: true, name: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    // Out of scope is indistinguishable from absent, on purpose.
    if (!project) throw AppError.notFound('That project');
    return serialise(project);
  }

  async create(input: CreateProjectDto) {
    const clash = await this.prisma.project.findUnique({
      where: { code: input.code },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('VALIDATION_FAILED', `Project code ${input.code} is already in use.`, {
        field: 'code',
      });
    }

    const project = await this.prisma.project.create({
      data: {
        code: input.code,
        name: input.name,
        fullName: input.fullName,
        description: input.description ?? null,
        status: input.status,
        implementingAgency: input.implementingAgency ?? null,
        costCr: new Prisma.Decimal(input.costCr),
        debtSanctionedCr: new Prisma.Decimal(input.debtSanctionedCr),
        debtDrawnCr: new Prisma.Decimal(input.debtDrawnCr),
        startDate: input.startDate ? new Date(input.startDate) : null,
        targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : null,
      },
      select: LIST_SELECT,
    });
    return serialise(project);
  }

  async update(user: AuthUser, id: string, input: UpdateProjectDto) {
    const current = await this.prisma.project.findFirst({
      where: { AND: [{ id }, projectIdScope(user)] },
      select: { id: true, debtSanctionedCr: true, debtDrawnCr: true },
    });
    if (!current) throw AppError.notFound('That project');

    // Check the pair as it will be after the change, not as it was sent: a
    // request that raises only `drawn` still has to respect `sanctioned`.
    const sanctioned = input.debtSanctionedCr ?? current.debtSanctionedCr.toString();
    const drawn = input.debtDrawnCr ?? current.debtDrawnCr.toString();
    if (Number(drawn) > Number(sanctioned)) {
      throw new AppError('VALIDATION_FAILED', 'Drawn cannot exceed sanctioned.', {
        field: 'debtDrawnCr',
      });
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.implementingAgency !== undefined && {
          implementingAgency: input.implementingAgency,
        }),
        ...(input.costCr !== undefined && { costCr: new Prisma.Decimal(input.costCr) }),
        ...(input.debtSanctionedCr !== undefined && {
          debtSanctionedCr: new Prisma.Decimal(input.debtSanctionedCr),
        }),
        ...(input.debtDrawnCr !== undefined && {
          debtDrawnCr: new Prisma.Decimal(input.debtDrawnCr),
        }),
        ...(input.startDate !== undefined && { startDate: new Date(input.startDate) }),
        ...(input.targetEndDate !== undefined && {
          targetEndDate: new Date(input.targetEndDate),
        }),
      },
      select: LIST_SELECT,
    });
    return serialise(project);
  }

  // ── officers on the project ──────────────────────────────────────────

  /**
   * Who is on this project, and what they do here.
   *
   * Project-centric on purpose. The mapping can be set from either end — an
   * officer's projects, or a project's officers — and the screen somebody is
   * standing on decides which they mean. Replacing the whole list makes a
   * removal as easy as an addition, and makes the operation idempotent.
   *
   * This mapping is the *data scope*: adding an officer here is what lets
   * them see this project's meetings, minutes and items at all. It grants no
   * capability — that still comes only from the designation.
   */
  async setMembers(
    user: AuthUser,
    projectId: string,
    members: { userId: string; roleOnProject: string }[],
  ) {
    await this.mustSee(user, projectId);

    const ids = [...new Set(members.map((m) => m.userId))];
    if (ids.length !== members.length) {
      throw new AppError('VALIDATION_FAILED', 'An officer appears twice in that list.');
    }

    const found = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw AppError.notFound('One of those officers');
    }

    await this.prisma.$transaction([
      this.prisma.projectMember.deleteMany({ where: { projectId } }),
      this.prisma.projectMember.createMany({
        data: members.map((m) => ({
          projectId,
          userId: m.userId,
          roleOnProject: m.roleOnProject,
        })),
      }),
    ]);

    return this.prisma.projectMember.findMany({
      where: { projectId },
      select: {
        roleOnProject: true,
        user: {
          select: {
            id: true,
            name: true,
            initials: true,
            designation: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { user: { name: 'asc' } },
    });
  }

  // ── ULBs ─────────────────────────────────────────────────────────────

  async addUlb(user: AuthUser, projectId: string, input: UlbDto) {
    await this.mustSee(user, projectId);

    const clash = await this.prisma.ulb.findUnique({
      where: { code: input.code },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('VALIDATION_FAILED', `ULB code ${input.code} is already in use.`, {
        field: 'code',
      });
    }

    try {
      return await this.prisma.ulb.create({
        data: {
          projectId,
          code: input.code,
          name: input.name,
          wards: input.wards ?? null,
          nodalName: input.nodalName ?? null,
          contact: input.contact ?? null,
          isLead: input.isLead,
        },
        select: {
          id: true,
          code: true,
          name: true,
          wards: true,
          nodalName: true,
          contact: true,
          isLead: true,
        },
      });
    } catch (err) {
      throw this.translateLeadClash(err);
    }
  }

  async updateUlb(user: AuthUser, projectId: string, ulbId: string, input: Partial<UlbDto>) {
    await this.mustSee(user, projectId);
    const ulb = await this.prisma.ulb.findFirst({
      where: { id: ulbId, projectId },
      select: { id: true },
    });
    if (!ulb) throw AppError.notFound('That ULB');

    try {
      return await this.prisma.ulb.update({
        where: { id: ulbId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.wards !== undefined && { wards: input.wards }),
          ...(input.nodalName !== undefined && { nodalName: input.nodalName }),
          ...(input.contact !== undefined && { contact: input.contact }),
          ...(input.isLead !== undefined && { isLead: input.isLead }),
        },
        select: {
          id: true,
          code: true,
          name: true,
          wards: true,
          nodalName: true,
          contact: true,
          isLead: true,
        },
      });
    } catch (err) {
      throw this.translateLeadClash(err);
    }
  }

  private async mustSee(user: AuthUser, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { AND: [{ id: projectId }, projectIdScope(user)] },
      select: { id: true },
    });
    if (!project || !canSeeProject(user, projectId)) throw AppError.notFound('That project');
  }

  /**
   * One lead ULB per project is a partial unique index, so a second one comes
   * back as P2002 rather than as a service check somebody can forget to write.
   * The database says no; this turns that into a sentence.
   */
  private translateLeadClash(err: unknown): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      String(err.meta?.target ?? '').includes('one_lead')
    ) {
      return new AppError(
        'VALIDATION_FAILED',
        'This project already has a lead ULB. Clear that one first.',
        { field: 'isLead' },
      );
    }
    return err;
  }
}

/**
 * Decimal is not JSON. Prisma returns a Decimal object; sending it straight out
 * gives the client `{"s":1,"e":2,"d":[120]}`, which is nobody's idea of an
 * amount. Strings keep every digit that Decimal(14,2) can hold.
 */
type WithDecimals = {
  costCr: Prisma.Decimal;
  debtSanctionedCr: Prisma.Decimal;
  debtDrawnCr: Prisma.Decimal;
};

function serialise<T extends WithDecimals>(row: T): Omit<T, keyof WithDecimals> & {
  costCr: string;
  debtSanctionedCr: string;
  debtDrawnCr: string;
} {
  return {
    ...row,
    costCr: row.costCr.toFixed(2),
    debtSanctionedCr: row.debtSanctionedCr.toFixed(2),
    debtDrawnCr: row.debtDrawnCr.toFixed(2),
  };
}
