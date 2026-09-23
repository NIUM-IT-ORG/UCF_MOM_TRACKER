import { z } from 'zod';

/**
 * Somebody who belongs at a meeting but not on the system.
 *
 * `docs/01-PRD.md` lists External invitee as a role — "Bankers, corporation
 * engineers | Receive notifications, be named in attendance. No login" — and
 * `docs/04-RBAC.md` gives EXT an empty capability row. What was missing was a
 * way to add one without leaving the meeting, which is the only moment
 * anybody knows the bank manager is coming.
 *
 * Name and designation, both typed. Contact details are optional because on
 * the morning of a meeting they are frequently not known, and a form that
 * demands them gets a fake number typed into it.
 */
export const externalInviteeDto = z
  .object({
    name: z.string().trim().min(2, 'Give the person a name.'),
    /**
     * Printed verbatim on the agenda and the attendance sheet — "Branch
     * Manager, SBI", not the name of a designation row. Capability still
     * comes from the EXT designation the record is attached to, because a
     * typed string has no answer to "what may this person do?".
     */
    designation: z.string().trim().min(2, 'Give the person a designation.').max(120),
    email: z.string().trim().toLowerCase().email('That is not an email address.').optional(),
    mobile: z.string().trim().min(8, 'That is too short to be a number.').optional(),
  })
  .strict();

export type ExternalInviteeDto = z.infer<typeof externalInviteeDto>;
