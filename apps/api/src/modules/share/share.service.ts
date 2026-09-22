import { Injectable, Logger } from '@nestjs/common';
import type { ShareDto, SubjectType } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import {
  meetingScope,
  projectIdScope,
  projectScope,
  visibleUsersScope,
} from '../../common/scope.js';
import type { AuthUser } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Manual share — `docs/01-PRD.md` §10 "Share anywhere", ticket P5-10.
 *
 * Two rules, and they are the whole of this class:
 *
 *   1. You cannot share something you cannot see. The subject is re-read
 *      through its own scope filter rather than trusted from the request.
 *   2. You cannot share with someone you cannot see. Recipients are checked
 *      against `visibleUsersScope`, which is the same list the picker draws
 *      from — but the picker is a convenience and this is the guard.
 *
 * **Nothing is delivered yet.** `NotificationsService.emit` writes the event
 * and this writes the audit row; the dispatch worker and the e-mail and
 * WhatsApp adapters are P5-01 and P5-02, and they do not exist. That is why
 * the result says `delivered: false` and names the channels as *requested*
 * rather than sent: an officer who is told their message went out when it did
 * not will not follow it up, and a commitment quietly goes unread. When Phase
 * 5 lands it drains these same rows, and nothing here has to change.
 */
@Injectable()
export class ShareService {
  private readonly log = new Logger('Share');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async share(user: AuthUser, dto: ShareDto) {
    const subject = await this.resolveSubject(user, dto.subjectType, dto.subjectId);
    const recipients = await this.resolveRecipients(user, dto.recipientIds);

    /*
     * The event and the audit row go in one transaction. A share that is
     * recorded as an event but leaves no audit trail — or the reverse — is a
     * communication nobody can account for later, which is the thing rule 7
     * in CLAUDE.md exists to prevent.
     */
    const notification = await this.prisma.$transaction(async (tx) => {
      const row = await this.notifications.emit(
        {
          eventCode: 'MANUAL',
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          subjectRef: subject.ref,
          templateKey: dto.templateKey ?? 'ucf_generic_share',
          triggeredById: user.id,
          recipientIds: recipients.map((r) => r.id),
          payload: {
            subject: dto.subject,
            note: dto.note ?? null,
            channels: dto.channels,
            attachmentFileIds: dto.attachmentFileIds,
            sharedByName: user.name,
          },
        },
        tx,
      );

      await tx.auditEntry.create({
        data: {
          actorId: user.id,
          objectType: dto.subjectType,
          objectId: dto.subjectId,
          objectRef: subject.ref,
          event: 'SHARED',
          detail: `Shared with ${recipients.length} recipient(s) on ${dto.channels.join(', ')}`,
          after: {
            recipientIds: recipients.map((r) => r.id),
            channels: dto.channels,
            subject: dto.subject,
          },
        },
      });

      return row;
    });

    this.log.log(
      `MANUAL · ${subject.ref} · ${recipients.length} recipient(s) · ${dto.channels.join(', ')} · recorded, not dispatched`,
    );

    return {
      id: notification.id,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      subjectRef: subject.ref,
      recipients: recipients.map((r) => ({ id: r.id, name: r.name })),
      channelsRequested: dto.channels,
      /*
       * Stated rather than implied. The Share dialog prints this back to the
       * officer, so the one person who could chase it up knows it has not
       * gone out.
       */
      delivered: false,
      deliveryNote:
        'Recorded against the subject and in the audit trail. Automatic delivery over e-mail and WhatsApp arrives with Phase 5; until then, send the document yourself using the link or the PDF.',
    };
  }

  /**
   * What has been sent about this subject, newest first — automatic events
   * and manual shares together.
   *
   * Scoped through the subject, not merely authenticated. The rows carry the
   * subject's reference and the recipients' names, so an unscoped read here
   * would hand an officer the participants and meeting codes of projects they
   * cannot see — CLAUDE.md rule 2, and the reason the scope check is a
   * repository concern rather than a UI one.
   */
  async history(user: AuthUser, subjectType: SubjectType, subjectId: string) {
    await this.resolveSubject(user, subjectType, subjectId);
    return this.notifications.listFor(subjectType, subjectId);
  }

  /**
   * Re-read the subject through its own scope filter.
   *
   * The id arrives from the client, so it is a claim, not a fact. Reading it
   * back through the same filter the list endpoints use is what stops an
   * officer sharing a meeting on a project they cannot see by pasting its id —
   * and a miss returns 404 rather than 403, so ids cannot be probed.
   */
  private async resolveSubject(
    user: AuthUser,
    type: SubjectType,
    id: string,
  ): Promise<{ ref: string }> {
    switch (type) {
      case 'MEETING': {
        const meeting = await this.prisma.meeting.findFirst({
          where: { AND: [{ id }, meetingScope(user)] },
          select: { code: true },
        });
        if (!meeting) throw AppError.notFound('That meeting');
        return { ref: meeting.code };
      }
      case 'MOM': {
        // A MoM is scoped through the meeting it minutes; it has no existence
        // apart from it.
        const mom = await this.prisma.mom.findFirst({
          where: { AND: [{ id }, { meeting: meetingScope(user) }] },
          select: { version: true, meeting: { select: { code: true } } },
        });
        if (!mom) throw AppError.notFound('That MoM');
        return { ref: `${mom.meeting.code} · MoM v${mom.version}` };
      }
      case 'ITEM': {
        const item = await this.prisma.item.findFirst({
          where: { AND: [{ id }, projectScope(user)] },
          select: { ref: true },
        });
        if (!item) throw AppError.notFound('That item');
        return { ref: item.ref };
      }
      case 'PROJECT': {
        const project = await this.prisma.project.findFirst({
          where: { AND: [{ id }, projectIdScope(user)] },
          select: { code: true, name: true },
        });
        if (!project) throw AppError.notFound('That project');
        return { ref: `${project.code} · ${project.name}` };
      }
      case 'REPORT':
        /*
         * A report is a query, not a row — there is no id to look up, so the
         * key travels as the subjectId and the scope is applied when the
         * report itself is run. Sharing one shares the link, and the
         * recipient's own scope decides what they see in it.
         */
        return { ref: id };
      default: {
        // Exhaustive: the zod enum already rejects anything else, but a new
        // subject type must not silently become an unscoped share.
        const never: never = type;
        throw new AppError('VALIDATION_FAILED', `Cannot share a ${String(never)}.`);
      }
    }
  }

  /**
   * Recipients, checked against the sharer's own scope.
   *
   * Named in the error rather than silently dropped: an officer who picked
   * five people and reached four would never know, and the person who was
   * dropped is the one who needed telling.
   */
  private async resolveRecipients(user: AuthUser, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.user.findMany({
      where: { AND: [{ id: { in: unique } }, visibleUsersScope(user)] },
      select: { id: true, name: true, email: true, mobile: true, accountState: true },
    });

    if (found.length !== unique.length) {
      throw AppError.notFound('One of those recipients');
    }

    /*
     * SUSPENDED only. An INVITE_ONLY officer has not signed in yet but is a
     * real person with a real address — they are frequently exactly who needs
     * the agenda, and refusing to share with them would make the system
     * unusable during a rollout.
     */
    const suspended = found.filter((r) => r.accountState === 'SUSPENDED');
    if (suspended.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${suspended.map((d) => d.name).join(', ')} ${suspended.length === 1 ? 'is' : 'are'} suspended and cannot be sent anything.`,
        { recipientIds: suspended.map((d) => d.id) },
      );
    }

    return found;
  }
}
