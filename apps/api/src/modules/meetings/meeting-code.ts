import type { MeetingType } from '@mom/shared';

/**
 * `UCF/<scope>/<RM|IM>-nn`
 *
 * Scope is the project code when the meeting covers exactly one project, and
 * `HO` when it covers several — a head-office meeting. RM is a scheduled review
 * meeting, IM an instant one, and the letter is load-bearing: a reader of the
 * MoM must be able to tell from the reference alone that no agenda was ever
 * circulated.
 *
 * The number is per scope and per kind, so `UCF/P1/RM-04` is the fourth
 * scheduled meeting on Project 1 — which is what people say out loud. A global
 * counter would produce references nobody can place.
 */
export function meetingScopeFor(projectCodes: string[]): string {
  return projectCodes.length === 1 ? projectCodes[0] : 'HO';
}

export function kindFor(type: MeetingType): 'RM' | 'IM' {
  return type === 'INSTANT' ? 'IM' : 'RM';
}

export function formatMeetingCode(scope: string, kind: 'RM' | 'IM', n: number): string {
  return `UCF/${scope}/${kind}-${String(n).padStart(2, '0')}`;
}

/**
 * The next free number for a scope and kind, given the codes already issued.
 *
 * Derived from the highest existing number rather than from a count, because a
 * count reuses a number the moment anything is ever deleted — and two meetings
 * sharing a reference is the kind of defect that is only noticed a year later,
 * in a document nobody can correct.
 */
export function nextMeetingNumber(existingCodes: string[], scope: string, kind: 'RM' | 'IM'): number {
  const prefix = `UCF/${scope}/${kind}-`;
  const highest = existingCodes
    .filter((c) => c.startsWith(prefix))
    .map((c) => Number.parseInt(c.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => (n > max ? n : max), 0);
  return highest + 1;
}

/**
 * Item references are issued per type across the whole system — `ACT-07`,
 * `CLA-03` — which is how the prototype and the client's existing registers
 * read. Same derivation, same reason.
 */
export function nextItemRef(existingRefs: string[], type: 'ACTION' | 'CLARIFICATION'): string {
  const prefix = type === 'ACTION' ? 'ACT-' : 'CLA-';
  const highest = existingRefs
    .filter((r) => r.startsWith(prefix))
    .map((r) => Number.parseInt(r.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => (n > max ? n : max), 0);
  return `${prefix}${String(highest + 1).padStart(2, '0')}`;
}
