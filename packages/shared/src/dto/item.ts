import { z } from 'zod';
import { cuid, isoDate } from './common.js';

/**
 * One typed form, two shapes — the discriminated union is the API-edge half of
 * the guarantee. The other half is the `items_shape` CHECK constraint in the
 * first migration, so a bad row cannot exist even if a service is wrong.
 *
 * A clarification that arrives carrying `ownerIds`, `dueDate` or `priority` is
 * REJECTED rather than silently stripped: silently dropping a due date the user
 * typed is how people lose trust in a form.
 */

const base = {
  meetingId: cuid,
  projectId: cuid,
  agendaItemId: cuid.optional(),
  description: z.string().trim().min(5, 'describe the item in a sentence'),
  raisedById: cuid,
  remarks: z.string().trim().optional(),
};

export const createActionDto = z
  .object({
    type: z.literal('ACTION'),
    ...base,
    /** Joint ownership: every named officer is equally accountable. */
    ownerIds: z.array(cuid).min(1, 'name at least one responsible officer'),
    dueDate: isoDate,
    priority: z.enum(['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'LOWER']).optional(),
  })
  .strict();

export const createClarificationDto = z
  .object({
    type: z.literal('CLARIFICATION'),
    ...base,
    respondedById: cuid.optional(),
    /**
     * The answer, when it was given in the meeting itself.
     *
     * Plenty of clarifications are raised and settled in the room. Without
     * this the item could only be recorded as OPEN, and since a clarification
     * cannot be answered until the MoM is circulated — and the MoM is
     * generated before circulation — the minutes printed "Open" against a
     * question that had already been answered in front of everybody. The
     * status is on the document, so that is a minute that misreports its own
     * meeting.
     *
     * Supplying it opens the item at RESPONDED instead. It does not close it:
     * `docs/05` gives that to the officer who raised it, and accepting on
     * their behalf is not ours to do.
     */
    response: z.string().trim().min(3, 'record what the answer was').optional(),
  })
  .strict();

/*
 * The refinement sits on the union, not on the clarification member: a
 * `.refine()` produces a ZodEffects, and `discriminatedUnion` takes objects
 * only — putting it on the member throws at module load rather than failing
 * a test.
 */
export const createItemDto = z
  .discriminatedUnion('type', [createActionDto, createClarificationDto])
  .refine((i) => i.type !== 'CLARIFICATION' || !i.response || !!i.respondedById, {
    // Without a name the minute says an answer was given and cannot say by
    // whom, which is exactly the gap a minute exists to close.
    message: 'Name who answered it.',
    path: ['respondedById'],
  });
export type CreateItemDto = z.infer<typeof createItemDto>;

export const updateItemDto = z
  .object({
    description: z.string().trim().min(5).optional(),
    remarks: z.string().trim().optional(),
    dueDate: isoDate.optional(),
    priority: z.enum(['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'LOWER']).optional(),
  })
  .strict();
export type UpdateItemDto = z.infer<typeof updateItemDto>;

export const setOwnersDto = z.object({ ownerIds: z.array(cuid).min(1) }).strict();
export type SetOwnersDto = z.infer<typeof setOwnersDto>;

export const reportCompleteDto = z
  .object({
    note: z.string().trim().min(3, 'say what was done'),
    evidenceFileId: cuid.optional(),
  })
  .strict();
export type ReportCompleteDto = z.infer<typeof reportCompleteDto>;

export const sendBackDto = z
  .object({ reason: z.string().trim().min(3, 'say why it is going back') })
  .strict();
export type SendBackDto = z.infer<typeof sendBackDto>;

export const respondDto = z
  .object({ response: z.string().trim().min(3), respondedById: cuid.optional() })
  .strict();
export type RespondDto = z.infer<typeof respondDto>;

export const itemQueryDto = z.object({
  type: z.enum(['ACTION', 'CLARIFICATION']).optional(),
  status: z.string().optional(),
  projectId: cuid.optional(),
  ownerId: cuid.optional(),
  meetingId: cuid.optional(),
  overdue: z.coerce.boolean().optional(),
  q: z.string().trim().optional(),
});
export type ItemQueryDto = z.infer<typeof itemQueryDto>;
