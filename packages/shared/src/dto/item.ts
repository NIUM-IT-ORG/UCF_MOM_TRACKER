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
    /**
     * Who is nominated to answer a clarification.
     *
     * Correcting it is a drafting fix, so the service allows it only while
     * the item is inert. Once circulated the nominee has been told, and
     * changing who owes the answer is `respond` or a new item — not a quiet
     * edit to a document people have already read.
     */
    respondedById: cuid.optional(),
    /**
     * Who raised it.
     *
     * The coordinator minutes on behalf of the room, so the wrong name here
     * is an ordinary slip — and the one correction that was impossible, since
     * it is set at creation and nothing could change it. Like the responder,
     * the service allows it only while the item is inert: the action and
     * clarification tables of the MoM both print "Raised by", so altering it
     * afterwards edits a document people have read.
     */
    raisedById: cuid.optional(),
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

/**
 * A yes/no flag arriving as a query string.
 *
 * Not `z.coerce.boolean()`, which is `Boolean(value)` - so "false" and "0"
 * both arrive as **true**, and a filter somebody turned off by hand in the
 * address bar silently stays on.
 */
const flag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) =>
    typeof v === 'string' ? ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase()) : v,
  );

export const itemQueryDto = z.object({
  type: z.enum(['ACTION', 'CLARIFICATION']).optional(),
  status: z.string().optional(),
  projectId: cuid.optional(),
  ownerId: cuid.optional(),
  /**
   * Who raised it — the mirror of `ownerId`.
   *
   * Both name a person on the item, and they answer opposite questions:
   * `ownerId` is "what does this officer owe", `raisedById` is "what did this
   * officer ask for". A chair reviewing their own meeting wants the second.
   */
  raisedById: cuid.optional(),
  meetingId: cuid.optional(),
  overdue: flag,
  /**
   * Only items the signed MoM has made live.
   *
   * The dashboard counts nothing else - an item inside an uncirculated MoM
   * has been told to nobody - so without this the register could not be asked
   * the question the dashboard answers, and every figure on that page linked
   * to a list several times longer than itself.
   */
  live: flag,
  q: z.string().trim().optional(),
});
export type ItemQueryDto = z.infer<typeof itemQueryDto>;
