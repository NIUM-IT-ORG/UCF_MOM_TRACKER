import { Injectable } from '@nestjs/common';
import type { MeetingStage } from '@prisma/client';
import type { Capability } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { meetingScope, projectScope, projectIdScope } from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { buildAttention } from './attention.js';

/**
 * The dashboard figures.
 *
 * One rule governs every count on this page: **an item counts only once it is
 * live.** An action raised while minuting exists, but nobody has been told
 * about it and no clock is running, so counting it would overstate the work in
 * hand and understate how much is still stuck in approval. The seed proves the
 * difference — seven actions are "In Progress" in the table, and this page
 * says four, because three are still inside an uncirculated MoM.
 *
 * Meetings are counted as *conducted* from the moment they are held, not when
 * the MoM is signed: the meeting happened either way, and a figure that waits
 * for paperwork is not a measure of activity.
 */
const LIVE = { activatedAt: { not: null } } as const;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser) {
    const itemWhere = { ...projectScope(user), ...LIVE };
    const now = new Date();

    const [
      meetingsByStage,
      instantHeld,
      actionsByStatus,
      clarificationsByStatus,
      overdue,
      projects,
      upcoming,
      attentionItems,
      attentionMeetings,
    ] = await Promise.all([
      this.prisma.meeting.groupBy({
        by: ['stage'],
        where: meetingScope(user),
        _count: { _all: true },
      }),
      this.prisma.meeting.count({
        where: { ...meetingScope(user), type: 'INSTANT', stage: { in: HELD_STAGES } },
      }),
      this.prisma.item.groupBy({
        by: ['actionStatus'],
        where: { ...itemWhere, type: 'ACTION' },
        _count: { _all: true },
      }),
      this.prisma.item.groupBy({
        by: ['clarificationStatus'],
        where: { ...itemWhere, type: 'CLARIFICATION' },
        _count: { _all: true },
      }),
      this.prisma.item.count({
        where: {
          ...itemWhere,
          type: 'ACTION',
          dueDate: { lt: now },
          actionStatus: { in: ['IN_PROGRESS', 'DELAYED'] },
        },
      }),
      this.prisma.project.findMany({
        where: projectIdScope(user),
        select: { id: true, code: true, name: true, status: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.meeting.findMany({
        where: {
          ...meetingScope(user),
          meetingDate: { gte: startOfDay(now) },
          stage: { notIn: ['CANCELLED', 'CLOSED'] },
        },
        select: {
          id: true,
          code: true,
          title: true,
          meetingDate: true,
          startTime: true,
          type: true,
          stage: true,
        },
        orderBy: [{ meetingDate: 'asc' }, { startTime: 'asc' }],
        take: 5,
      }),
      this.prisma.item.findMany({
        where: itemWhere,
        select: {
          id: true,
          ref: true,
          type: true,
          description: true,
          actionStatus: true,
          clarificationStatus: true,
          dueDate: true,
          respondedById: true,
          raisedById: true,
          owners: { select: { userId: true } },
        },
      }),
      this.prisma.meeting.findMany({
        where: meetingScope(user),
        select: {
          id: true,
          code: true,
          title: true,
          type: true,
          stage: true,
          agendaFreezeAt: true,
          moms: { select: { state: true }, orderBy: { version: 'desc' }, take: 1 },
        },
      }),
    ]);

    const stage = (s: string) =>
      meetingsByStage.find((row) => row.stage === s)?._count._all ?? 0;
    const conducted = HELD_STAGES.reduce((sum, s) => sum + stage(s), 0);

    const action = (s: string) =>
      actionsByStatus.find((row) => row.actionStatus === s)?._count._all ?? 0;
    const clarification = (s: string) =>
      clarificationsByStatus.find((row) => row.clarificationStatus === s)?._count._all ?? 0;

    const actionsTotal = actionsByStatus.reduce((sum, r) => sum + r._count._all, 0);
    const clarificationsTotal = clarificationsByStatus.reduce((sum, r) => sum + r._count._all, 0);

    // Per project, the two numbers a project director is asked for in a review.
    const byProject = await Promise.all(
      projects.map(async (p) => {
        const [open, late, unclosed] = await Promise.all([
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
        return { ...p, actionsOpen: open, actionsOverdue: late, clarificationsOpen: unclosed };
      }),
    );

    return {
      meetings: {
        conducted,
        instant: instantHeld,
        scheduled: conducted - instantHeld,
        ahead: stage('CONFIRMED') + stage('COMPOSED') + stage('LIVE'),
        inPipeline:
          stage('PLANNED') + stage('AGENDA') + stage('INVITEES') + stage('INVITEE_INPUTS'),
        cancelled: stage('CANCELLED'),
      },
      actions: {
        total: actionsTotal,
        completed: action('COMPLETED'),
        pending: actionsTotal - action('COMPLETED'),
        inProgress: action('IN_PROGRESS'),
        delayed: action('DELAYED'),
        underReview: action('UNDER_REVIEW'),
        overdue,
        byStatus: {
          IN_PROGRESS: action('IN_PROGRESS'),
          DELAYED: action('DELAYED'),
          UNDER_REVIEW: action('UNDER_REVIEW'),
          COMPLETED: action('COMPLETED'),
        },
      },
      clarifications: {
        total: clarificationsTotal,
        closed: clarification('CLOSED'),
        pending: clarificationsTotal - clarification('CLOSED'),
        open: clarification('OPEN'),
        responded: clarification('RESPONDED'),
        byStatus: {
          OPEN: clarification('OPEN'),
          RESPONDED: clarification('RESPONDED'),
          CLOSED: clarification('CLOSED'),
        },
      },
      projects: byProject,
      upcoming: upcoming.map((m) => ({ ...m, meetingDate: m.meetingDate.toISOString() })),
      attention: buildAttention({
        userId: user.id,
        caps: user.caps as Capability[],
        items: attentionItems.map((i) => ({
          id: i.id,
          ref: i.ref,
          type: i.type,
          description: i.description,
          actionStatus: i.actionStatus,
          clarificationStatus: i.clarificationStatus,
          daysOverdue: daysBetween(i.dueDate, now),
          ownerIds: i.owners.map((o) => o.userId),
          respondedById: i.respondedById,
          raisedById: i.raisedById,
        })),
        meetings: attentionMeetings.map((m) => ({
          id: m.id,
          code: m.code,
          title: m.title,
          type: m.type,
          stage: m.stage,
          momState: m.moms[0]?.state ?? null,
          agendaFreezeAt: m.agendaFreezeAt?.toISOString() ?? null,
        })),
      }),
    };
  }
}

/** A meeting has been conducted once it is held — paperwork comes after. */
const HELD_STAGES: MeetingStage[] = ['HELD', 'MINUTED', 'CLOSED'];

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(due: Date | null, now: Date): number {
  if (!due) return 0;
  return Math.floor((startOfDay(now).getTime() - startOfDay(due).getTime()) / 86_400_000);
}
