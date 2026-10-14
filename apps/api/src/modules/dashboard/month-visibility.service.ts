import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';

/**
 * Which months' commitments the dashboard counts.
 *
 * A year of conducted meetings leaves the dashboard describing mostly
 * history: the client's complaint was exact, that the page was reporting on
 * actions from meetings held months ago rather than on the work in hand. A
 * System Administrator can switch a month off and everything raised in that
 * month's meetings stops counting there.
 *
 * Three things this is not, and the code has to keep it that way:
 *
 *   It is not deletion. The meeting, the MoM, the items and the audit trail
 *   are untouched, and the register and every report still show them.
 *
 *   It is not per-user. One setting, set by an administrator, applying to
 *   everybody - which is why the dashboard states what is being withheld
 *   rather than quietly rendering a smaller number.
 *
 *   It is not a status. An action in a disabled month is still live, still
 *   assigned to somebody and still overdue if its date has passed. Nothing
 *   here writes to an item.
 *
 * A month is the **meeting's** month. That is the month the commitment was
 * made in, and unlike a due date or a circulation date it never moves once
 * the meeting is minuted.
 */
export interface MonthRow {
  /** "2026-09" */
  month: string;
  enabled: boolean;
  meetings: number;
  actions: number;
  clarifications: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class MonthVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The months that are switched off.
   *
   * Only disabled rows are read. Absent means enabled, so a month nobody has
   * configured - including next month - needs no row and no administrator
   * remembering to create one.
   */
  async disabledMonths(): Promise<string[]> {
    const rows = await this.prisma.dashboardMonth.findMany({
      where: { enabled: false },
      select: { month: true },
      orderBy: { month: 'asc' },
    });
    return rows.map((r) => r.month.trim());
  }

  /**
   * The disabled months as a Prisma `NOT`, for any query over items.
   *
   * Returned as a clause rather than applied here so that every dashboard
   * query takes it the same way, beside its own scope filter, where it can be
   * seen. A filter this consequential should not be hidden inside a helper
   * that silently rewrites a `where`.
   */
  static excludeClause(months: string[]): Prisma.ItemWhereInput[] {
    return months.map((m) => ({ meeting: { meetingDate: monthRange(m) } }));
  }

  /** Every month that has a meeting in the caller's scope, newest first. */
  async list(user: AuthUser): Promise<MonthRow[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: meetingScope(user),
      select: {
        meetingDate: true,
        _count: { select: { items: true } },
        items: { select: { type: true } },
      },
      orderBy: { meetingDate: 'desc' },
    });

    const months = new Map<string, { meetings: number; actions: number; clarifications: number }>();
    for (const m of meetings) {
      const key = monthKey(m.meetingDate);
      const row = months.get(key) ?? { meetings: 0, actions: 0, clarifications: 0 };
      row.meetings += 1;
      for (const i of m.items) {
        if (i.type === 'ACTION') row.actions += 1;
        else row.clarifications += 1;
      }
      months.set(key, row);
    }

    const configured = await this.prisma.dashboardMonth.findMany({
      select: {
        month: true,
        enabled: true,
        updatedAt: true,
        updatedBy: { select: { name: true } },
      },
    });
    const byMonth = new Map(configured.map((c) => [c.month.trim(), c]));

    return [...months.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, counts]) => {
        const set = byMonth.get(month);
        return {
          month,
          // Absent is enabled. Stated here as well as in the query, because
          // this is the line a reader checks when a new month appears on.
          enabled: set?.enabled ?? true,
          ...counts,
          updatedAt: set?.updatedAt?.toISOString() ?? null,
          updatedBy: set?.updatedBy?.name ?? null,
        };
      });
  }

  /**
   * Switch months on or off.
   *
   * Written as an upsert per month inside one transaction, with an audit row
   * for each actual change - a request that re-states what is already set
   * writes nothing, so the trail records decisions rather than clicks.
   */
  async set(user: AuthUser, changes: { month: string; enabled: boolean }[]): Promise<MonthRow[]> {
    for (const c of changes) {
      if (!MONTH.test(c.month)) {
        throw new AppError('VALIDATION_FAILED', `"${c.month}" is not a month.`, {
          field: 'month',
        });
      }
    }

    const existing = await this.prisma.dashboardMonth.findMany({
      where: { month: { in: changes.map((c) => c.month) } },
      select: { month: true, enabled: true },
    });
    const before = new Map(existing.map((e) => [e.month.trim(), e.enabled]));

    await this.prisma.$transaction(async (tx) => {
      for (const c of changes) {
        const was = before.get(c.month) ?? true;
        if (was === c.enabled) continue;

        await tx.dashboardMonth.upsert({
          where: { month: c.month },
          create: { month: c.month, enabled: c.enabled, updatedById: user.id },
          update: { enabled: c.enabled, updatedById: user.id },
        });
        await tx.auditEntry.create({
          data: {
            actorId: user.id,
            objectType: 'DASHBOARD_MONTH',
            objectId: c.month,
            objectRef: c.month,
            event: c.enabled ? 'DASHBOARD_MONTH_ENABLED' : 'DASHBOARD_MONTH_DISABLED',
            detail: c.enabled
              ? `${c.month} counts on the dashboard again.`
              : `${c.month} no longer counts on the dashboard. Nothing was deleted.`,
            before: { enabled: was },
            after: { enabled: c.enabled },
          },
        });
      }
    });

    return this.list(user);
  }
}

/** "2026-09", from a date, in the server's own zone as every other date here. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The half-open range a month covers: `gte` the first, `lt` the next first. */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const [year, m] = month.split('-').map(Number);
  return { gte: new Date(year, m - 1, 1), lt: new Date(year, m, 1) };
}
