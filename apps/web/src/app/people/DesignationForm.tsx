'use client';

import { useState } from 'react';
import { CAPABILITIES, type Capability } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { Card, Field, Notice } from '@/components/ui';

/**
 * The designation matrix, edited in the screen.
 *
 * This is the most consequential form in the application: a tick here decides
 * who may approve a minute, who may sign it, and who may open this form at
 * all. Three things follow from that.
 *
 * - The capabilities offered are the ones the code defines, read from the
 *   shared matrix. A capability invented in the database would look
 *   authoritative and grant nothing.
 * - Two of them are marked as the ones that cannot all be given away:
 *   `manage_masters` and `manage_access`. The server refuses the edit that
 *   would leave nobody active holding them; this form says so before the
 *   click, because discovering it afterwards teaches people to distrust the
 *   screen.
 * - The code is set once. Designations are quoted in every minute and every
 *   attendance sheet; changing one afterwards would rewrite history.
 */
const UNLOSABLE: Capability[] = ['manage_masters', 'manage_access'];

/** Grouped the way somebody thinks about the job, not the way the keys sort. */
const GROUPS: { title: string; caps: Capability[] }[] = [
  { title: 'Meetings', caps: ['plan_instant', 'plan_scheduled', 'add_agenda', 'confirm_meeting'] },
  { title: 'During and after', caps: ['mark_attendance', 'record_minutes', 'create_items'] },
  {
    title: 'Items',
    caps: ['update_own_item', 'respond_clarification', 'confirm_completion'],
  },
  // Two different offices, on purpose: whoever validates the document is not
  // whoever signs it. Granting both to one designation collapses the chain.
  { title: 'The MoM', caps: ['approve_mom', 'sign_mom', 'upload_signed'] },
  {
    title: 'Everything else',
    caps: ['manage_project_docs', 'view_all_projects', 'share_object', 'manage_masters', 'manage_access'],
  },
];

export function DesignationForm({
  designation,
  onSaved,
  onCancel,
}: {
  /** Absent when creating. */
  designation?: { id: string; code: string; name: string; band: string; caps: string[] };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(designation);
  const [code, setCode] = useState(designation?.code ?? '');
  const [name, setName] = useState(designation?.name ?? '');
  const [band, setBand] = useState(designation?.band ?? '');
  const [caps, setCaps] = useState<string[]>(designation?.caps ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anything in the matrix that this screen forgot to group still has to be
  // offered, or a capability could never be granted again.
  const grouped = new Set(GROUPS.flatMap((g) => g.caps));
  const ungrouped = (Object.keys(CAPABILITIES) as Capability[]).filter((c) => !grouped.has(c));
  const groups = ungrouped.length > 0 ? [...GROUPS, { title: 'Other', caps: ungrouped }] : GROUPS;

  function toggle(cap: Capability) {
    setCaps((cur) => (cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap]));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(editing ? `/designations/${designation?.id}` : '/designations', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(editing ? {} : { code: code.trim().toUpperCase() }),
          name: name.trim(),
          band: band.trim(),
          caps,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not save the designation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={editing ? `Edit ${designation?.code}` : 'New designation'}
      tag="What is ticked here is what these officers may do"
    >
      <div className="grid gap-3.5 px-[17px] py-4">
        {error && <Notice tone="red">{error}</Notice>}

        <div className="grid gap-3.5 sm:grid-cols-[1fr_2fr_2fr]">
          <Field
            label="Code"
            required={!editing}
            fixed={editing}
            hint={editing ? 'Fixed — minutes quote it.' : 'Short, like ULB-EO.'}
          >
            <input
              className="i"
              value={code}
              disabled={editing}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ULB-EO"
            />
          </Field>
          <Field label="Name" required>
            <input
              className="i"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ULB Executive Officer"
            />
          </Field>
          <Field label="Band" required hint="Where it sits in the hierarchy.">
            <input
              className="i"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              placeholder="Urban local body"
            />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
            Capabilities <span className="font-normal text-muted">{caps.length} of {Object.keys(CAPABILITIES).length}</span>
          </span>

          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.title} className="rounded-[10px] border border-line bg-[#F9FBFD] p-3">
                <h4 className="mb-2 mt-0 text-[10px] font-extrabold uppercase tracking-[1.3px] text-muted">
                  {group.title}
                </h4>
                <div className="grid gap-1.5">
                  {group.caps.map((cap) => (
                    <label key={cap} className="flex items-start gap-2 text-[12.5px] text-ink">
                      <input
                        type="checkbox"
                        className="mt-[3px]"
                        checked={caps.includes(cap)}
                        onChange={() => toggle(cap)}
                      />
                      <span>
                        {CAPABILITIES[cap]}
                        {UNLOSABLE.includes(cap) && (
                          <b
                            className="ml-1.5 rounded-md bg-[#FFF2E0] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#A66A12]"
                            title="Somebody active must always hold this, or nobody can administer the system."
                          >
                            keep one
                          </b>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            className="btn-primary"
            type="button"
            disabled={busy || !name.trim() || !band.trim() || (!editing && code.trim().length < 2)}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : editing ? 'Save the capabilities' : 'Create the designation'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Never mind
          </button>
        </div>

        <p className="mb-0 text-[11.5px] text-muted">
          Changes apply to every officer holding this designation, immediately and everywhere —
          there is no per-person override anywhere in the system, by design.
        </p>
      </div>
    </Card>
  );
}
