import { z } from 'zod';
import { cuid, hhmm, isoDate, requiredRemark } from './common.js';

const meetingCore = {
  category: z.enum([
    'WEEKLY_PROGRESS_REVIEW',
    'REVIEW_WITH_FINANCIER',
    'STEERING_COMMITTEE',
    'TECHNICAL_COORDINATION',
  ]),
  title: z.string().trim().min(5, 'give the meeting a title'),
  meetingDate: isoDate,
  startTime: hhmm,
  endTime: hhmm,
  venue: z.string().trim().min(2),
  vcLink: z.string().url().optional().or(z.literal('')),
  chairId: cuid,
  projectIds: z.array(cuid).min(1, 'a meeting must cover at least one project'),
};

export const createMeetingDto = z
  .object({
    type: z.enum(['INSTANT', 'SCHEDULED']),
    ...meetingCore,
  })
  .strict()
  .refine((m) => m.endTime > m.startTime, {
    message: 'the meeting must end after it starts',
    path: ['endTime'],
  });
export type CreateMeetingDto = z.infer<typeof createMeetingDto>;

export const updateMeetingDto = z
  .object({
    category: meetingCore.category.optional(),
    title: meetingCore.title.optional(),
    meetingDate: isoDate.optional(),
    startTime: hhmm.optional(),
    endTime: hhmm.optional(),
    venue: z.string().trim().min(2).optional(),
    vcLink: z.string().url().optional().or(z.literal('')),
    chairId: cuid.optional(),
    projectIds: z.array(cuid).min(1).optional(),
  })
  .strict();
export type UpdateMeetingDto = z.infer<typeof updateMeetingDto>;

export const agendaItemDto = z
  .object({
    text: z.string().trim().min(5, 'write the agenda point as a sentence'),
    projectId: cuid.optional(),
  })
  .strict();
export type AgendaItemDto = z.infer<typeof agendaItemDto>;

/**
 * Carrying an item forward a second time requires a new date. Without this the
 * same overdue action rides from meeting to meeting with a date nobody believes.
 */
export const carryDto = z
  .object({
    items: z
      .array(z.object({ itemId: cuid, revisedDue: isoDate.optional() }))
      .min(1),
  })
  .strict();
export type CarryDto = z.infer<typeof carryDto>;

export const inviteesDto = z.object({ userIds: z.array(cuid) }).strict();
export type InviteesDto = z.infer<typeof inviteesDto>;

export const rsvpDto = z
  .object({ response: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']) })
  .strict();
export type RsvpDto = z.infer<typeof rsvpDto>;

export const attendanceDto = z
  .object({
    marks: z.record(cuid, z.enum(['PRESENT', 'VIRTUAL', 'ABSENT'])),
  })
  .strict();
export type AttendanceDto = z.infer<typeof attendanceDto>;

export const rescheduleDto = z
  .object({
    meetingDate: isoDate,
    startTime: hhmm,
    endTime: hhmm,
    reason: requiredRemark,
  })
  .strict();
export type RescheduleDto = z.infer<typeof rescheduleDto>;

export const cancelDto = z.object({ reason: requiredRemark }).strict();
export type CancelDto = z.infer<typeof cancelDto>;

export const minutesDto = z
  .object({ bodyHtml: z.string().min(1) })
  .strict();
export type MinutesDto = z.infer<typeof minutesDto>;

export const momDecisionDto = z.object({ remark: requiredRemark }).strict();
export type MomDecisionDto = z.infer<typeof momDecisionDto>;
export const momSignDto = z.object({ fileId: cuid }).strict();
export type MomSignDto = z.infer<typeof momSignDto>;
