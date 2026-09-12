import { z } from 'zod';
import { cuid, isoDate } from './common.js';

/**
 * Money arrives as a string, not a number.
 *
 * A JavaScript number cannot hold every value a `Decimal(14,2)` can, and the
 * rounding it does instead is silent. ₹ 120.45 cr is `"120.45"` on the wire,
 * a Decimal in the database, and never a float anywhere in between.
 */
export const money = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v.trim()))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'expected an amount like 120.45')
  .refine((v) => Number(v) >= 0, 'an amount cannot be negative');

const projectCore = {
  name: z.string().trim().min(2, 'give the project a short name'),
  fullName: z.string().trim().min(5, 'give the project its full name'),
  description: z.string().trim().optional(),
  status: z.enum(['PLANNING', 'PROCUREMENT', 'UNDER_EXECUTION', 'COMPLETED', 'ON_HOLD']),
  implementingAgency: z.string().trim().optional(),
  costCr: money,
  debtSanctionedCr: money,
  debtDrawnCr: money,
  startDate: isoDate.optional(),
  targetEndDate: isoDate.optional(),
};

export const createProjectDto = z
  .object({
    /** P1, P2, … — it goes into every meeting code, so it never changes. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9-]{0,9}$/, 'a short code like P1 or UCF-04'),
    ...projectCore,
  })
  .strict()
  .refine((p) => Number(p.debtDrawnCr) <= Number(p.debtSanctionedCr), {
    message: 'drawn cannot exceed sanctioned',
    path: ['debtDrawnCr'],
  })
  .refine((p) => !p.startDate || !p.targetEndDate || p.targetEndDate >= p.startDate, {
    message: 'the target end date is before the start date',
    path: ['targetEndDate'],
  });
export type CreateProjectDto = z.infer<typeof createProjectDto>;

/** The code is absent on purpose: it is in every meeting reference already. */
export const updateProjectDto = z
  .object({
    name: projectCore.name.optional(),
    fullName: projectCore.fullName.optional(),
    description: z.string().trim().optional(),
    status: projectCore.status.optional(),
    implementingAgency: z.string().trim().optional(),
    costCr: money.optional(),
    debtSanctionedCr: money.optional(),
    debtDrawnCr: money.optional(),
    startDate: isoDate.optional(),
    targetEndDate: isoDate.optional(),
  })
  .strict();
export type UpdateProjectDto = z.infer<typeof updateProjectDto>;

export const ulbDto = z
  .object({
    code: z.string().trim().toUpperCase().min(2, 'give the ULB a code'),
    name: z.string().trim().min(3, 'give the ULB its full name'),
    wards: z.coerce.number().int().min(0).max(10_000).optional(),
    nodalName: z.string().trim().optional(),
    contact: z.string().trim().optional(),
    /** Exactly one lead per project — enforced by a partial unique index. */
    isLead: z.boolean().default(false),
  })
  .strict();
export type UlbDto = z.infer<typeof ulbDto>;

/**
 * Reserving a file. The bytes go up separately, to the URL this returns.
 */
export const reserveFileDto = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(3).max(160),
    sizeBytes: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type ReserveFileDto = z.infer<typeof reserveFileDto>;

export const cuidRef = cuid;
