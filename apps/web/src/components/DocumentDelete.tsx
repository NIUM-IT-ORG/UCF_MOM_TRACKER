'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';

/**
 * Removing a filed document, with the confirmation in the row.
 *
 * Two clicks rather than a modal: the question is "this one?", and the answer
 * is in the row the officer is already looking at. A dialog would ask the
 * same question with the document's name copied into it, which is how people
 * end up confirming the wrong row.
 *
 * `locked` is for an annexure already inside a circulated MoM. The server
 * refuses those, and it has to - deleting A-02 here would not take it out of
 * the PDF in two hundred inboxes - but a button that exists only to produce
 * an error is a worse way to say so than a button that is not offered.
 */
export function DocumentDelete({
  target,
  documentId,
  name,
  locked,
  onDeleted,
}: {
  /** `projects/<id>` or `meetings/<id>` - the owner the document hangs off. */
  target: string;
  documentId: string;
  name: string;
  locked?: { version: number | null };
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (locked) {
    return (
      <span
        className="text-[11px] text-muted"
        title={`Circulated as an annexure to version ${locked.version} of the MoM. Issue a corrigendum if the minutes need to change.`}
      >
        In the signed MoM
      </span>
    );
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/${target}/documents/${documentId}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That could not be removed.');
      setBusy(false);
      setAsking(false);
    }
  }

  if (error) {
    return (
      <span className="text-[11px] text-[#BF3B2B]" role="alert">
        {error}
      </span>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        className="text-[11.5px] font-semibold text-[#BF3B2B]"
        onClick={() => setAsking(true)}
      >
        Remove
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-[11px] text-muted">Remove {name}?</span>
      <button
        type="button"
        className="text-[11.5px] font-bold text-[#BF3B2B]"
        disabled={busy}
        onClick={() => void remove()}
      >
        {busy ? 'Removing…' : 'Yes'}
      </button>
      <button
        type="button"
        className="text-[11.5px] font-semibold text-muted"
        onClick={() => setAsking(false)}
      >
        No
      </button>
    </span>
  );
}
