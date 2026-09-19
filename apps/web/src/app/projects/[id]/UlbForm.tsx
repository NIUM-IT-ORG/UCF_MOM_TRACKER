'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Card, Field, Notice } from '@/components/ui';

/**
 * A ULB on a project — added, and edited.
 *
 * "Lead" is the one that matters: exactly one ULB per project leads it, and a
 * partial unique index in the database says so. Ticking it here moves the
 * flag; the server is what refuses two.
 */
export function UlbForm({
  projectId,
  ulb,
  onSaved,
  onCancel,
}: {
  projectId: string;
  ulb?: {
    id: string;
    code: string;
    name: string;
    wards: number | null;
    nodalName: string | null;
    contact: string | null;
    isLead: boolean;
  };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(ulb);
  const [code, setCode] = useState(ulb?.code ?? '');
  const [name, setName] = useState(ulb?.name ?? '');
  const [wards, setWards] = useState(ulb?.wards?.toString() ?? '');
  const [nodalName, setNodalName] = useState(ulb?.nodalName ?? '');
  const [contact, setContact] = useState(ulb?.contact ?? '');
  const [isLead, setIsLead] = useState(ulb?.isLead ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      isLead,
    };
    if (wards.trim()) body.wards = Number(wards);
    if (nodalName.trim()) body.nodalName = nodalName.trim();
    if (contact.trim()) body.contact = contact.trim();

    try {
      await api(editing ? `/projects/${projectId}/ulbs/${ulb?.id}` : `/projects/${projectId}/ulbs`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not save the ULB.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={editing ? `Edit ${ulb?.code}` : 'Add a ULB'} tag="Exactly one ULB leads a project">
      <div className="grid gap-3.5 px-[17px] py-4">
        {error && <Notice tone="red">{error}</Notice>}

        <div className="grid gap-3.5 sm:grid-cols-[1fr_2fr_1fr]">
          <Field label="Code" required>
            <input
              className="i"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ULB-07"
            />
          </Field>
          <Field label="Name" required>
            <input
              className="i"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="City 4 Municipal Corporation"
            />
          </Field>
          <Field label="Wards">
            <input
              className="i"
              inputMode="numeric"
              value={wards}
              onChange={(e) => setWards(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="42"
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Nodal officer">
            <input
              className="i"
              value={nodalName}
              onChange={(e) => setNodalName(e.target.value)}
              placeholder="Name of the nodal officer"
            />
          </Field>
          <Field label="Contact">
            <input
              className="i"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="+91 9XXXXXXXXX"
            />
          </Field>
        </div>

        <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
          <input
            type="checkbox"
            className="mt-[3px]"
            checked={isLead}
            onChange={(e) => setIsLead(e.target.checked)}
          />
          <span>
            <b className="text-navy">This ULB leads the project.</b> Only one can, so ticking it
            here is refused while another still holds it — clear that one first.
          </span>
        </label>

        <div className="flex flex-wrap gap-2.5">
          <button
            className="btn-primary"
            type="button"
            disabled={busy || code.trim().length < 2 || name.trim().length < 3}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : editing ? 'Save the changes' : 'Add the ULB'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Never mind
          </button>
        </div>
      </div>
    </Card>
  );
}
