/**
 * The eighteen capabilities. This file is the only place they are defined.
 * A capability string must never be typed as a literal anywhere else.
 *
 * Capabilities are granted to a DESIGNATION, never to a user. Data scope
 * comes separately from the user's project mapping — see docs/04-RBAC.md.
 */

export const CAPABILITIES = {
  plan_instant: 'Create an instant meeting',
  plan_scheduled: 'Plan a scheduled meeting',
  add_agenda: 'Add agenda points',
  confirm_meeting: 'Confirm a scheduled meeting',
  mark_attendance: 'Mark attendance',
  record_minutes: 'Record minutes',
  create_items: 'Create actions & clarifications',
  update_own_item: 'Update an item assigned to me',
  respond_clarification: 'Respond to a clarification',
  confirm_completion: 'Confirm an item as completed',
  approve_mom: 'Approve the MoM and route it for signature',
  sign_mom: 'Sign a MoM routed to me',
  upload_signed: 'Upload the signed MoM',
  manage_project_docs: 'Add project documents',
  manage_masters: 'Manage master data',
  manage_access: 'Manage access control',
  view_all_projects: 'See every project',
  share_object: 'Share a meeting, MoM, item, document or report',
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[];

/**
 * Seed grants, mirrored by prisma/seed.ts and by the prototype's access matrix.
 * After go-live the matrix is editable at runtime (`PUT /designations/:id/capabilities`);
 * this constant is the starting state, not the enforcement point.
 */
export const SEED_DESIGNATION_CAPS: Record<string, Capability[]> = {
  MD: ['add_agenda', 'confirm_completion', 'sign_mom', 'view_all_projects', 'share_object'],
  AMD: ['add_agenda', 'confirm_completion', 'sign_mom', 'view_all_projects', 'share_object'],
  CDMA: ['view_all_projects', 'share_object'],
  PD: [
    'add_agenda',
    'approve_mom',
    'record_minutes',
    'create_items',
    'update_own_item',
    'respond_clarification',
    'confirm_completion',
    'manage_project_docs',
    'share_object',
  ],
  PDMC: [
    'plan_instant',
    'plan_scheduled',
    'add_agenda',
    'confirm_meeting',
    'mark_attendance',
    'record_minutes',
    'create_items',
    'update_own_item',
    'respond_clarification',
    'confirm_completion',
    'upload_signed',
    'manage_project_docs',
    'view_all_projects',
    'share_object',
  ],
  MC: [
    'plan_instant',
    'plan_scheduled',
    'add_agenda',
    'confirm_meeting',
    'mark_attendance',
    'record_minutes',
    'create_items',
    'update_own_item',
    'respond_clarification',
    'upload_signed',
    'manage_project_docs',
    'share_object',
  ],
  ULB: ['add_agenda', 'update_own_item', 'respond_clarification', 'share_object'],
  SYS: ['manage_masters', 'manage_access', 'view_all_projects', 'share_object'],
  EXT: [],
};

/**
 * The MoM chain, named once.
 *
 * Meeting Coordinator records and submits → Project Coordinator validates,
 * approves, and chooses who signs → that officer, and only that officer,
 * signs. Two different capabilities, held by different offices, because the
 * point of the chain is that the person who checks the document is not the
 * person who puts their name to it.
 */
export const MOM_APPROVER: Capability = 'approve_mom';
export const MOM_SIGNER: Capability = 'sign_mom';

/** Capability check. Scope is a separate question — never conflate the two. */
export function hasCapability(caps: readonly string[], required: Capability): boolean {
  return caps.includes(required);
}
