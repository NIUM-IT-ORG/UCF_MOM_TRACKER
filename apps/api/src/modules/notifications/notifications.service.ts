import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The seam Phases 3 and 4 emit through, and Phase 5 fills in.
 *
 * What it does today: writes one `notifications` row per event, with the
 * subject, the recipients and the payload the template will need. What it does
 * not do: create `dispatches`, or send anything. That is P5-01.
 *
 * This is deliberately built now rather than later. If the state machines
 * shipped with no emit call at all, Phase 5 would mean revisiting every
 * transition in two modules and hoping none were missed — and a missed one is
 * invisible, because nothing fails when a notification is simply never sent.
 * Emitting into a table that nobody drains yet makes the gap visible: the rows
 * are there to be counted, and the Phase 5 work is to drain them.
 *
 * Every call takes a transaction client where one is open, because the rule
 * from docs/06 is that an event is emitted **in the same transaction as the
 * change that caused it**. A circulated MoM that fails to record ACT-01 must
 * not stay circulated.
 */

export interface EmitInput {
  eventCode: string;
  subjectType: 'MEETING' | 'MOM' | 'ITEM' | 'PROJECT' | 'REPORT';
  subjectId: string;
  /** The human reference — UCF/P1/RM-04, ACT-07. Shown in the log and the message. */
  subjectRef: string;
  templateKey: string;
  /** Who caused it. Null for a scheduled job, which is not a person. */
  triggeredById?: string | null;
  /** Recipients, resolved by the caller — it knows who is involved; this does not. */
  recipientIds?: string[];
  payload?: Record<string, unknown>;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  async emit(input: EmitInput, tx?: Db) {
    const db = tx ?? this.prisma;
    const row = await db.notification.create({
      data: {
        eventCode: input.eventCode,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectRef: input.subjectRef,
        templateKey: input.templateKey,
        triggeredById: input.triggeredById ?? null,
        payload: {
          ...(input.payload ?? {}),
          recipientIds: input.recipientIds ?? [],
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Until Phase 5 this is the only visible sign an event fired, which is what
    // makes the end-to-end walkthroughs checkable before any provider exists.
    this.log.log(
      `${input.eventCode} · ${input.subjectRef} · ${input.recipientIds?.length ?? 0} recipient(s)`,
    );
    return row;
  }

  /** Events for one subject, newest first — the "what was sent about this" list. */
  listFor(subjectType: string, subjectId: string) {
    return this.prisma.notification.findMany({
      where: { subjectType, subjectId },
      select: {
        id: true,
        eventCode: true,
        subjectRef: true,
        templateKey: true,
        payload: true,
        createdAt: true,
        triggeredBy: { select: { id: true, name: true, initials: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
