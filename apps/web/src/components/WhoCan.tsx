'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CAPABILITIES, type Capability } from '@mom/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Says who can do the thing this officer cannot, by name.
 *
 * "Your designation does not carry that capability" is true and useless: it
 * leaves somebody with nothing to do but ask around the building. Both halves
 * of a hand-off matter — that it is not yours, and whose it is.
 *
 * The names come from the designation matrix rather than the copy, so they
 * stay right when somebody edits the matrix, and the list of people is
 * already scoped to the officers this viewer is allowed to see.
 */
export function WhoCan({
  capability,
  lead,
  who,
  /** Shown to an administrator, who can also just grant it. */
  offerToGrant = true,
}: {
  capability: Capability;
  lead: string;
  who: string;
  offerToGrant?: boolean;
}) {
  const { caps } = useSession();
  const [names, setNames] = useState<string[] | null>(null);
  const canManage = caps.includes('manage_masters');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ code: string; caps: string[] }[]>('/designations'),
      api<{ name: string; accountState: string; designation: { code: string } }[]>('/users'),
    ])
      .then(([designations, users]) => {
        const holders = new Set(
          designations.filter((d) => d.caps.includes(capability)).map((d) => d.code),
        );
        if (!alive) return;
        setNames(
          users
            .filter((u) => u.accountState === 'ACTIVE' && holders.has(u.designation.code))
            .map((u) => `${u.name} (${u.designation.code})`),
        );
      })
      // Not being able to name them does not make the sentence wrong.
      .catch(() => alive && setNames([]));
    return () => {
      alive = false;
    };
  }, [capability]);

  return (
    <span className="text-[12.5px] text-muted">
      {lead} {who}
      {names && names.length > 0
        ? `: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ', and others' : ''}.`
        : '.'}
      {offerToGrant && canManage && (
        <>
          {' '}
          You can give <b>{CAPABILITIES[capability]}</b> to another designation on{' '}
          <Link href="/people?tab=designations">People &amp; designations</Link>.
        </>
      )}
    </span>
  );
}
