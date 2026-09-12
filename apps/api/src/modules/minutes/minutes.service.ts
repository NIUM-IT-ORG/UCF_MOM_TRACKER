import { Injectable } from '@nestjs/common';
import type { MinutesDto } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../auth/auth-user.js';
import { MeetingsService } from '../meetings/meetings.service.js';
import { isHeldOrLater } from '../meetings/meeting.machine.js';
import { sanitiseHtml } from './sanitise.js';

@Injectable()
export class MinutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
  ) {}

  async get(user: AuthUser, meetingId: string) {
    await this.meetings.mustSee(user, meetingId);
    const minutes = await this.prisma.minutes.findUnique({
      where: { meetingId },
      select: {
        id: true,
        bodyHtml: true,
        lockedAt: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { versions: true } },
      },
    });
    // No minutes yet is a normal state, not an error — the editor opens blank.
    return minutes ?? { id: null, bodyHtml: '', lockedAt: null, _count: { versions: 0 } };
  }

  /**
   * Saving keeps the previous text as a version first.
   *
   * The order matters: the version is written from what is *currently* stored,
   * before the update, so the history is what was replaced rather than what
   * replaced it. Getting that backwards loses the first draft entirely.
   */
  async save(user: AuthUser, meetingId: string, dto: MinutesDto) {
    const meeting = await this.meetings.mustSee(user, meetingId);

    if (!isHeldOrLater(meeting.stage) && meeting.stage !== 'LIVE') {
      throw new AppError(
        'INVALID_TRANSITION',
        'Minutes are recorded once the meeting is under way.',
        { from: meeting.stage, to: 'MINUTED' },
      );
    }

    const existing = await this.prisma.minutes.findUnique({
      where: { meetingId },
      select: { id: true, bodyHtml: true, lockedAt: true, _count: { select: { versions: true } } },
    });

    if (existing?.lockedAt) {
      throw new AppError(
        'MINUTES_LOCKED',
        'These minutes were locked when the MoM was submitted for approval. Ask for it to be returned before editing.',
        { lockedAt: existing.lockedAt.toISOString() },
      );
    }

    // Sanitised on write, so everything downstream reads clean HTML.
    const bodyHtml = sanitiseHtml(dto.bodyHtml);
    if (bodyHtml.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'The minutes cannot be empty.', {
        field: 'bodyHtml',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      if (!existing) {
        return tx.minutes.create({
          data: { meetingId, bodyHtml, updatedById: user.id },
          select: { id: true, bodyHtml: true, lockedAt: true, updatedAt: true },
        });
      }

      if (existing.bodyHtml !== bodyHtml) {
        await tx.minutesVersion.create({
          data: {
            minutesId: existing.id,
            version: existing._count.versions + 1,
            bodyHtml: existing.bodyHtml,
            savedById: user.id,
          },
        });
      }

      return tx.minutes.update({
        where: { id: existing.id },
        data: { bodyHtml, updatedById: user.id },
        select: { id: true, bodyHtml: true, lockedAt: true, updatedAt: true },
      });
    });
  }

  async versions(user: AuthUser, meetingId: string) {
    await this.meetings.mustSee(user, meetingId);
    const minutes = await this.prisma.minutes.findUnique({
      where: { meetingId },
      select: { id: true },
    });
    if (!minutes) return [];
    return this.prisma.minutesVersion.findMany({
      where: { minutesId: minutes.id },
      select: { id: true, version: true, bodyHtml: true, createdAt: true },
      orderBy: { version: 'desc' },
    });
  }

  /** Used by the MoM machine; returns null rather than throwing when absent. */
  async raw(meetingId: string) {
    return this.prisma.minutes.findUnique({
      where: { meetingId },
      select: { id: true, bodyHtml: true, lockedAt: true },
    });
  }
}
