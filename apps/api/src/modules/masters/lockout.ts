import { CAPABILITIES, type Capability } from '@mom/shared';

/**
 * Editing the designation matrix can lock everybody out of it.
 *
 * `manage_masters` is what lets anyone edit designations at all, and
 * `manage_access` is what lets anyone inspect and repair access. Clear the
 * last one of either from the only designation that holds it and the system
 * has no administrator and no way to appoint one — a state no screen can
 * recover from, only a DBA can.
 *
 * So the rule is: after any edit, at least one ACTIVE officer must still hold
 * each of these two. It is checked here, as arithmetic over the whole matrix,
 * rather than in the service, because the interesting cases are combinations —
 * two designations each holding it, one being edited — and those are worth
 * testing without a database.
 */
export const UNLOSABLE: Capability[] = ['manage_masters', 'manage_access'];

export interface DesignationRow {
  id: string;
  code: string;
  caps: string[];
  /** Officers whose account can actually sign in. INVITE_ONLY cannot. */
  activeUsers: number;
}

export interface ProposedChange {
  /** The designation being changed, or created when it is not in `current`. */
  id: string;
  /** The capabilities it would hold afterwards. An empty list is allowed. */
  caps: string[];
  /** True when the designation is being retired rather than re-capped. */
  retired?: boolean;
}

/** Every capability key the code knows about. Anything else is a typo. */
export function unknownCapabilities(caps: string[]): string[] {
  const known = new Set(Object.keys(CAPABILITIES));
  return caps.filter((c) => !known.has(c));
}

/**
 * @returns the capabilities that would be left with no active holder, in the
 * order of UNLOSABLE. Empty means the change is safe.
 */
export function wouldLockEverybodyOut(
  current: DesignationRow[],
  change: ProposedChange,
): Capability[] {
  const after = current.map((d) =>
    d.id === change.id ? { ...d, caps: change.retired ? [] : change.caps } : d,
  );
  // A designation that did not exist before is a creation: nobody holds it yet,
  // so it cannot rescue a capability, and it cannot remove one either.
  if (!current.some((d) => d.id === change.id) && !change.retired) {
    after.push({ id: change.id, code: 'new', caps: change.caps, activeUsers: 0 });
  }

  return UNLOSABLE.filter(
    (cap) => !after.some((d) => d.activeUsers > 0 && d.caps.includes(cap)),
  );
}

/** The sentence an officer reads when the guard stops them. */
export function lockoutMessage(lost: Capability[]): string {
  const named = lost.map((c) => `“${CAPABILITIES[c]}”`).join(' and ');
  return (
    `That would leave nobody who can sign in holding ${named}. ` +
    'Give it to another designation first, or assign an active officer to one that has it.'
  );
}
