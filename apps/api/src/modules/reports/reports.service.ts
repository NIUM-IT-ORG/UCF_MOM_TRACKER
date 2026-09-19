import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { meetingScope, projectScope, projectIdScope, seesAll } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';

/**
 * The six reports.
 *
 * Every one produces the same shape — a title, some columns, some rows — and
 * the controller renders that shape as JSON, CSV or a print-ready page. One
 * renderer, three formats: a report whose CSV and PDF disagree about a figure
 * is worse than a report that only exists in one format.
 *
 * All of them are project-scoped by the same helpers the rest of the API uses,
 * so a project director's copy of a report is their projects' figures, not a
 * filtered view of everybody's.
 *
 * Only **live** items appear — the same rule as the dashboard. A report that
 * counted items inside an uncirculated MoM would be reporting on decisions
 * nobody has been told about yet.
 */
export type Cell = string | number | null;

export interface ReportTable {
  key: string;
  title: string;
  /** One sentence on what the report is for, printed at the head of it. */
  lede: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, Cell>[];
  /** Figures that belong above the table rather than in it. */
  summary: { label: string; value: string | number }[];
  generatedAt: string;
}

export interface ReportQuery {
  from?: string;
  to?: string;
  projectId?: string;
}

export const REPORTS = [
  {
    key: 'action-taken',
    title: 'Action taken report',
    lede: 'Every live action, who is accountable, when it was due and where it stands.',
  },
  {
    key: 'meeting-register',
    title: 'Meeting register',
    lede: 'Meetings held, with attendance, what was raised and where the MoM has reached.',
  },
  {
    key: 'pending-approvals',
    title: 'Pending approvals',
    lede: 'Minutes waiting on somebody — and how long they have been waiting.',
  },
  {
    key: 'officer-performance',
    title: 'Officer performance',
    lede: 'Actions per officer: carried, completed, completed on time, still overdue.',
  },
  {
    key: 'clarification-log',
    title: 'Clarification log',
    lede: 'Every clarification, who answered it, and how long it took.',
  },
  {
    key: 'project-status',
    title: 'Project status',
    lede: 'One line per project: money, meetings and what is still open.',
  },
] as const;

export type ReportKey = (typeof REPORTS)[number]['key'];

const LIVE = { activatedAt: { not: null } } as const;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async build(user: AuthUser, key: string, query: ReportQuery): Promise<ReportTable> {
    const definition = REPORTS.find((r) => r.key === key);
    if (!definition) throw AppError.notFound('That report');

    // A project filter the caller cannot see is a scope failure, and a scope
    // failure is a 404 — never a 403, or ids could be probed by reading the
    // difference between the two.
    if (query.projectId && !seesAll(user) && !user.projectIds.includes(query.projectId)) {
      throw AppError.notFound('That project');
    }

    const table = await this[`${camel(key)}` as 'actionTaken'](user, query);
    return { ...definition, ...table, generatedAt: new Date().toISOString() };
  }

  // ── 1 · what was committed, and what happened to it ──────────────────
  private async actionTaken(user: AuthUser, q: ReportQuery) {
    const rows = await this.prisma.item.findMany({
      where: {
        ...projectScope(user),
        ...LIVE,
        type: 'ACTION',
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...dateWindow(q, 'dueDate'),
      },
      select: {
        ref: true,
        description: true,
        dueDate: true,
        originalDue: true,
        priority: true,
        actionStatus: true,
        carryCount: true,
        closedAt: true,
        project: { select: { code: true } },
        meeting: { select: { code: true, meetingDate: true } },
        owners: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ actionStatus: 'asc' }, { dueDate: 'asc' }],
    });

    const now = new Date();
    return {
      columns: [
        { key: 'ref', label: 'Reference' },
        { key: 'project', label: 'Project' },
        { key: 'meeting', label: 'Raised in' },
        { key: 'description', label: 'Action' },
        { key: 'owners', label: 'Responsible officer(s)' },
        { key: 'due', label: 'Due' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'carried', label: 'Carried', numeric: true },
        { key: 'lateBy', label: 'Days late', numeric: true },
      ],
      rows: rows.map((r) => ({
        ref: r.ref,
        project: r.project.code,
        meeting: r.meeting.code,
        description: r.description,
        owners: r.owners.map((o) => o.user.name).join(', ') || '—',
        due: day(r.dueDate),
        priority: r.priority,
        status: r.actionStatus,
        carried: r.carryCount,
        lateBy: lateDays(r.dueDate, r.closedAt ?? now),
      })),
      summary: [
        { label: 'Actions', value: rows.length },
        { label: 'Completed', value: rows.filter((r) => r.actionStatus === 'COMPLETED').length },
        { label: 'Delayed', value: rows.filter((r) => r.actionStatus === 'DELAYED').length },
        {
          label: 'Carried forward at least once',
          value: rows.filter((r) => r.carryCount > 0).length,
        },
      ],
    };
  }

  // ── 2 · what was held ────────────────────────────────────────────────
  private async meetingRegister(user: AuthUser, q: ReportQuery) {
    const rows = await this.prisma.meeting.findMany({
      where: {
        ...meetingScope(user),
        ...(q.projectId ? { projects: { some: { projectId: q.projectId } } } : {}),
        ...dateWindow(q, 'meetingDate'),
      },
      select: {
        code: true,
        title: true,
        type: true,
        category: true,
        meetingDate: true,
        venue: true,
        stage: true,
        chair: { select: { name: true } },
        projects: { select: { project: { select: { code: true } } } },
        invitees: { select: { attendance: true } },
        moms: { select: { state: true, version: true }, orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { items: true } },
      },
      orderBy: { meetingDate: 'desc' },
    });

    return {
      columns: [
        { key: 'code', label: 'Reference' },
        { key: 'date', label: 'Date' },
        { key: 'title', label: 'Meeting' },
        { key: 'type', label: 'Type' },
        { key: 'projects', label: 'Projects' },
        { key: 'chair', label: 'Chaired by' },
        { key: 'invited', label: 'Invited', numeric: true },
        { key: 'present', label: 'Present', numeric: true },
        { key: 'items', label: 'Items raised', numeric: true },
        { key: 'mom', label: 'MoM' },
      ],
      rows: rows.map((m) => ({
        code: m.code,
        date: day(m.meetingDate),
        title: m.title,
        type: m.type,
        projects: m.projects.map((p) => p.project.code).join(' '),
        chair: m.chair?.name ?? '—',
        invited: m.invitees.length,
        present: m.invitees.filter((i) => i.attendance === 'PRESENT' || i.attendance === 'VIRTUAL')
          .length,
        items: m._count.items,
        mom: m.moms[0] ? `${m.moms[0].state} v${m.moms[0].version}` : 'NOT_GENERATED',
      })),
      summary: [
        { label: 'Meetings', value: rows.length },
        {
          label: 'Held',
          value: rows.filter((m) => ['HELD', 'MINUTED', 'CLOSED'].includes(m.stage)).length,
        },
        { label: 'Instant', value: rows.filter((m) => m.type === 'INSTANT').length },
        {
          label: 'Circulated',
          value: rows.filter((m) => m.moms[0]?.state === 'SIGNED').length,
        },
      ],
    };
  }

  // ── 3 · what is stuck, and with whom ─────────────────────────────────
  private async pendingApprovals(user: AuthUser, q: ReportQuery) {
    const rows = await this.prisma.mom.findMany({
      where: {
        state: { in: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] },
        meeting: {
          ...meetingScope(user),
          ...(q.projectId ? { projects: { some: { projectId: q.projectId } } } : {}),
        },
      },
      select: {
        state: true,
        version: true,
        submittedAt: true,
        decidedAt: true,
        updatedAt: true,
        decisionRemark: true,
        meeting: {
          select: {
            code: true,
            title: true,
            meetingDate: true,
            projects: { select: { project: { select: { code: true } } } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });

    const now = new Date();
    return {
      columns: [
        { key: 'code', label: 'Reference' },
        { key: 'title', label: 'Meeting' },
        { key: 'projects', label: 'Projects' },
        { key: 'held', label: 'Held on' },
        { key: 'state', label: 'State' },
        { key: 'version', label: 'Version', numeric: true },
        { key: 'waiting', label: 'Days waiting', numeric: true },
        { key: 'remark', label: 'Last remark' },
      ],
      rows: rows.map((m) => ({
        code: m.meeting.code,
        title: m.meeting.title,
        projects: m.meeting.projects.map((p) => p.project.code).join(' '),
        held: day(m.meeting.meetingDate),
        state: m.state,
        version: m.version,
        waiting: lateDays(m.submittedAt ?? m.updatedAt, now),
        remark: m.decisionRemark ?? '—',
      })),
      summary: [
        { label: 'Not yet circulated', value: rows.length },
        { label: 'With the approver', value: rows.filter((m) => m.state === 'SUBMITTED').length },
        { label: 'Returned for changes', value: rows.filter((m) => m.state === 'RETURNED').length },
        {
          label: 'Awaiting signature',
          value: rows.filter((m) => m.state === 'APPROVED').length,
        },
      ],
    };
  }

  // ── 4 · who is carrying what ─────────────────────────────────────────
  private async officerPerformance(user: AuthUser, q: ReportQuery) {
    const items = await this.prisma.item.findMany({
      where: {
        ...projectScope(user),
        ...LIVE,
        type: 'ACTION',
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...dateWindow(q, 'dueDate'),
      },
      select: {
        dueDate: true,
        actionStatus: true,
        closedAt: true,
        owners: {
          select: {
            user: {
              select: { id: true, name: true, designation: { select: { code: true } } },
            },
          },
        },
      },
    });

    const now = new Date();
    const byOfficer = new Map<
      string,
      { name: string; designation: string; assigned: number; completed: number; onTime: number; overdue: number }
    >();

    for (const item of items) {
      for (const owner of item.owners) {
        const row = byOfficer.get(owner.user.id) ?? {
          name: owner.user.name,
          designation: owner.user.designation.code,
          assigned: 0,
          completed: 0,
          onTime: 0,
          overdue: 0,
        };
        row.assigned += 1;
        if (item.actionStatus === 'COMPLETED') {
          row.completed += 1;
          // Joint ownership means this counts for each named officer. They are
          // equally accountable; splitting the credit would imply otherwise.
          if (lateDays(item.dueDate, item.closedAt ?? now) <= 0) row.onTime += 1;
        } else if (lateDays(item.dueDate, now) > 0) {
          row.overdue += 1;
        }
        byOfficer.set(owner.user.id, row);
      }
    }

    const rows = [...byOfficer.values()]
      .map((r) => ({
        ...r,
        completionRate: r.assigned === 0 ? 0 : Math.round((r.completed / r.assigned) * 100),
      }))
      .sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);

    return {
      columns: [
        { key: 'name', label: 'Officer' },
        { key: 'designation', label: 'Designation' },
        { key: 'assigned', label: 'Actions held', numeric: true },
        { key: 'completed', label: 'Completed', numeric: true },
        { key: 'onTime', label: 'Completed on time', numeric: true },
        { key: 'overdue', label: 'Overdue now', numeric: true },
        { key: 'completionRate', label: 'Completed %', numeric: true },
      ],
      rows: rows as unknown as Record<string, Cell>[],
      summary: [
        { label: 'Officers carrying work', value: rows.length },
        { label: 'Actions counted', value: items.length },
        {
          label: 'Officers with something overdue',
          value: rows.filter((r) => r.overdue > 0).length,
        },
      ],
    };
  }

  // ── 5 · questions asked, and answered ────────────────────────────────
  private async clarificationLog(user: AuthUser, q: ReportQuery) {
    const rows = await this.prisma.item.findMany({
      where: {
        ...projectScope(user),
        ...LIVE,
        type: 'CLARIFICATION',
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...dateWindow(q, 'createdAt'),
      },
      select: {
        ref: true,
        description: true,
        remarks: true,
        clarificationStatus: true,
        createdAt: true,
        closedAt: true,
        project: { select: { code: true } },
        meeting: { select: { code: true } },
        raisedBy: { select: { name: true } },
        respondedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    return {
      columns: [
        { key: 'ref', label: 'Reference' },
        { key: 'project', label: 'Project' },
        { key: 'meeting', label: 'Raised in' },
        { key: 'description', label: 'Clarification' },
        { key: 'raisedBy', label: 'Raised by' },
        { key: 'respondedBy', label: 'Responded by' },
        { key: 'status', label: 'Status' },
        { key: 'openFor', label: 'Days open', numeric: true },
        { key: 'response', label: 'Response' },
      ],
      rows: rows.map((r) => ({
        ref: r.ref,
        project: r.project.code,
        meeting: r.meeting.code,
        description: r.description,
        raisedBy: r.raisedBy.name,
        respondedBy: r.respondedBy?.name ?? '—',
        status: r.clarificationStatus,
        openFor: Math.max(0, lateDays(r.createdAt, r.closedAt ?? now)),
        response: r.remarks ?? '—',
      })),
      summary: [
        { label: 'Clarifications', value: rows.length },
        { label: 'Still unanswered', value: rows.filter((r) => r.clarificationStatus === 'OPEN').length },
        { label: 'Closed', value: rows.filter((r) => r.clarificationStatus === 'CLOSED').length },
      ],
    };
  }

  // ── 6 · the one-line-per-project view ────────────────────────────────
  private async projectStatus(user: AuthUser, q: ReportQuery) {
    const projects = await this.prisma.project.findMany({
      where: {
        ...projectIdScope(user),
        ...(q.projectId ? { id: q.projectId } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        costCr: true,
        debtSanctionedCr: true,
        debtDrawnCr: true,
        targetEndDate: true,
        _count: { select: { ulbs: true, members: true } },
      },
      orderBy: { code: 'asc' },
    });

    const now = new Date();
    const rows = await Promise.all(
      projects.map(async (p) => {
        const [meetings, actionsOpen, actionsOverdue, clarificationsOpen] = await Promise.all([
          this.prisma.meeting.count({
            where: {
              projects: { some: { projectId: p.id } },
              stage: { in: ['HELD', 'MINUTED', 'CLOSED'] },
            },
          }),
          this.prisma.item.count({
            where: {
              ...LIVE,
              projectId: p.id,
              type: 'ACTION',
              actionStatus: { in: ['IN_PROGRESS', 'DELAYED', 'UNDER_REVIEW'] },
            },
          }),
          this.prisma.item.count({
            where: {
              ...LIVE,
              projectId: p.id,
              type: 'ACTION',
              dueDate: { lt: now },
              actionStatus: { in: ['IN_PROGRESS', 'DELAYED'] },
            },
          }),
          this.prisma.item.count({
            where: {
              ...LIVE,
              projectId: p.id,
              type: 'CLARIFICATION',
              clarificationStatus: { not: 'CLOSED' },
            },
          }),
        ]);
        return {
          code: p.code,
          name: p.name,
          status: p.status,
          costCr: p.costCr.toString(),
          sanctionedCr: p.debtSanctionedCr.toString(),
          drawnCr: p.debtDrawnCr.toString(),
          drawnPct:
            Number(p.debtSanctionedCr) === 0
              ? 0
              : Math.round((Number(p.debtDrawnCr) / Number(p.debtSanctionedCr)) * 100),
          ulbs: p._count.ulbs,
          officers: p._count.members,
          meetings,
          actionsOpen,
          actionsOverdue,
          clarificationsOpen,
          targetEnd: day(p.targetEndDate),
        };
      }),
    );

    return {
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Project' },
        { key: 'status', label: 'Status' },
        { key: 'costCr', label: 'Cost (₹ cr)', numeric: true },
        { key: 'sanctionedCr', label: 'Sanctioned (₹ cr)', numeric: true },
        { key: 'drawnCr', label: 'Drawn (₹ cr)', numeric: true },
        { key: 'drawnPct', label: 'Drawn %', numeric: true },
        { key: 'ulbs', label: 'ULBs', numeric: true },
        { key: 'meetings', label: 'Meetings held', numeric: true },
        { key: 'actionsOpen', label: 'Actions open', numeric: true },
        { key: 'actionsOverdue', label: 'Overdue', numeric: true },
        { key: 'clarificationsOpen', label: 'Clarifications open', numeric: true },
        { key: 'targetEnd', label: 'Target end' },
      ],
      rows: rows as unknown as Record<string, Cell>[],
      summary: [
        { label: 'Projects', value: rows.length },
        {
          label: 'Total sanctioned (₹ cr)',
          value: rows.reduce((sum, r) => sum + Number(r.sanctionedCr), 0).toFixed(2),
        },
        { label: 'Actions open', value: rows.reduce((s, r) => s + r.actionsOpen, 0) },
        { label: 'Of those, overdue', value: rows.reduce((s, r) => s + r.actionsOverdue, 0) },
      ],
    };
  }
}

function camel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Whole days from `from` to `to`, negative when `from` is still ahead. */
function lateDays(from: Date | null, to: Date): number {
  if (!from) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function dateWindow(q: ReportQuery, field: string): Record<string, unknown> {
  if (!q.from && !q.to) return {};
  return {
    [field]: {
      ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
      ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
    },
  };
}
