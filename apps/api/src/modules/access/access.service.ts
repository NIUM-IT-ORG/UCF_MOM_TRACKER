import { Injectable } from '@nestjs/common';
import { ALL_CAPABILITIES, CAPABILITIES, type Capability } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';

export interface MatrixRow {
  code: string;
  name: string;
  band: string;
  caps: string[];
}

export interface EffectiveAccess {
  user: { id: string; name: string; email: string; accountState: string };
  designation: { code: string; name: string; band: string };
  /** Every capability, held or not, with its label — so the UI shows both. */
  capabilities: { key: Capability; label: string; held: boolean }[];
  seesAllProjects: boolean;
  projects: { id: string; code: string; name: string; roleOnProject: string | null }[];
  /** The plain-English answer support actually needs. */
  summary: string;
}

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async matrix(): Promise<{ capabilities: { key: string; label: string }[]; designations: MatrixRow[] }> {
    const designations = await this.prisma.designation.findMany({
      where: { retiredAt: null },
      select: { code: true, name: true, band: true, caps: true },
      orderBy: { code: 'asc' },
    });
    return {
      capabilities: ALL_CAPABILITIES.map((key) => ({ key, label: CAPABILITIES[key] })),
      designations,
    };
  }

  async setCapabilities(code: string, caps: Capability[]): Promise<MatrixRow> {
    const unknown = caps.filter((c) => !ALL_CAPABILITIES.includes(c));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_FAILED', `Unknown capabilities: ${unknown.join(', ')}`, {
        unknown,
      });
    }
    const designation = await this.prisma.designation.findUnique({ where: { code } });
    if (!designation) throw AppError.notFound(`Designation ${code}`);

    return this.prisma.designation.update({
      where: { code },
      data: { caps },
      select: { code: true, name: true, band: true, caps: true },
    });
  }

  /**
   * The effective-access checker from docs/04-RBAC.md §7.
   *
   * It answers "why can't this officer see X" in one call, which is the
   * question support will be asked most often. Returning the capabilities the
   * officer does *not* hold matters as much as the ones they do — the absent
   * one is usually the answer.
   */
  async effective(userId: string): Promise<EffectiveAccess> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        accountState: true,
        seesAllProjects: true,
        designation: { select: { code: true, name: true, band: true, caps: true } },
        projects: {
          select: {
            roleOnProject: true,
            project: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!user) throw AppError.notFound('That user');

    const held = new Set(user.designation.caps);
    const seesAll = user.seesAllProjects || held.has('view_all_projects');

    const projects = seesAll
      ? (
          await this.prisma.project.findMany({
            select: { id: true, code: true, name: true },
            orderBy: { code: 'asc' },
          })
        ).map((p) => ({ ...p, roleOnProject: null }))
      : user.projects
          .map((m) => ({ ...m.project, roleOnProject: m.roleOnProject }))
          .sort((a, b) => a.code.localeCompare(b.code));

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountState: user.accountState,
      },
      designation: {
        code: user.designation.code,
        name: user.designation.name,
        band: user.designation.band,
      },
      capabilities: ALL_CAPABILITIES.map((key) => ({
        key,
        label: CAPABILITIES[key],
        held: held.has(key),
      })),
      seesAllProjects: seesAll,
      projects,
      summary: summarise(user.name, user.designation.name, held.size, seesAll, projects.length),
    };
  }
}

function summarise(
  name: string,
  designation: string,
  capCount: number,
  seesAll: boolean,
  projectCount: number,
): string {
  const scope = seesAll
    ? 'every project'
    : projectCount === 0
      ? 'no projects at all, so every list will be empty'
      : `${projectCount} project${projectCount === 1 ? '' : 's'}`;
  return `${name} is a ${designation} with ${capCount} capabilit${capCount === 1 ? 'y' : 'ies'}, on ${scope}.`;
}
