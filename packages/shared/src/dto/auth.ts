import { z } from 'zod';
import { cuid } from './common.js';

export const loginDto = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1, 'enter your password'),
  })
  .strict();
export type LoginDto = z.infer<typeof loginDto>;

export const verifyOtpDto = z
  .object({
    challengeId: cuid,
    otp: z.string().trim().regex(/^\d{6}$/, 'the code is six digits'),
  })
  .strict();
export type VerifyOtpDto = z.infer<typeof verifyOtpDto>;

/**
 * Minimum twelve characters, per docs/04-RBAC.md §6. Length beats character
 * classes — a rule demanding one of each mostly produces Password1! — so the
 * only other requirement is that it is not one of the obvious ones.
 */
const OBVIOUS = new Set([
  'password',
  'password123',
  'passw0rd123',
  '123456789012',
  'qwertyuiop12',
  'administrator',
  'letmein12345',
]);

export const passwordDto = z
  .string()
  .min(12, 'use at least 12 characters')
  .max(128)
  .refine((p) => !OBVIOUS.has(p.toLowerCase()), 'that password is on every breach list');

export const setPasswordDto = z
  .object({ currentPassword: z.string().optional(), newPassword: passwordDto })
  .strict();

/** What `GET /auth/me` returns. The client never derives permissions itself. */
export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  email: string;
  designation: { code: string; name: string; band: string };
  department: { id: string; name: string };
  /** Resolved from the designation on every request, never from the token. */
  caps: string[];
  /** Project ids in scope. Empty with `view_all_projects` means "all". */
  projectIds: string[];
  /** The same projects, named — so a screen never has to render a raw id. */
  projects: { id: string; code: string; name: string }[];
  seesAllProjects: boolean;
}
