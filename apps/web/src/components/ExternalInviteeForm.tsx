'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Field, Notice } from '@/components/ui';

/**
 * Adding somebody who is not on the system.
 *
 * `docs/01-PRD.md` has had External invitee as a role from the start —
 * "Bankers, corporation engineers | Receive notifications, be named in
 * attendance. No login" — but there was no way to record one, so a
 * coordinator expecting the bank's branch manager had to either leave them
 * off the sheet or have an administrator create an officer account for
 * somebody who will never sign in.
 *
 * Name and designation are typed, because the whole point is that these
 * people are not in the designation master. The designation is printed
 * verbatim on the agenda and the attendance sheet: "Branch Manager, SBI" is
 * what makes the sheet worth reading a year later.
 *
 * Contact details are optional on purpose. On the morning of a meeting
 * nobody has the bank manager's mobile, and a form that insists gets a made-up
 * number typed into it — which is worse than a blank, because a blank can be
 * filled in later and a wrong number cannot be spotted.
 */
export function ExternalInviteeForm({
  meetingId,
  onAdded,
}: {
  meetingId: string;
  /** The refreshed invitee list is handed back so the caller can re-render. */
  onAdded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim().length >= 2 && designation.trim().length >= 2;

  function reset() {
    setName('');
    setDesignation('');
    setEmail('');
    setMobile('');
    setError(null);
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meetingId}/invitees/external`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          designation: designation.trim(),
          // Omitted rather than sent empty: the DTO takes an address or
          // nothing, and "" is neither.
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
        }),
      });
      reset();
      setOpen(false);
      await onAdded();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.display : 'That person could not be added.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Add someone not on the system
      </button>
    );
  }

  return (
    <div className="rounded-[10px] border border-line bg-[#F8FAFD] p-3.5">
      <p className="mb-2.5 mt-0 text-[12.5px] font-semibold text-navy">
        Somebody not on the system
      </p>

      {error && <Notice tone="red">{error}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <input
            className="i"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="K. Ramesh"
            maxLength={120}
          />
        </Field>
        <Field label="Designation" required hint="Printed as typed, on the agenda and the minutes.">
          <input
            className="i"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="Branch Manager, SBI"
            maxLength={120}
          />
        </Field>
        <Field label="Email" hint="Only if you have it. They will not be able to sign in.">
          <input
            className="i"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optional"
          />
        </Field>
        <Field label="Mobile" hint="Only if you have it.">
          <input
            className="i"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="optional"
          />
        </Field>
      </div>

      {!email.trim() && !mobile.trim() && (
        <p className="mb-0 mt-2 text-[11.5px] text-muted">
          With neither an email nor a number they can be named in attendance, but nothing can be
          sent to them.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2.5">
        <button
          type="button"
          className="btn-primary"
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Adding…' : 'Add and invite'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
