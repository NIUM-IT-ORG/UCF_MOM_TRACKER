'use client';

import { useEffect, useState } from 'react';
import { PRIORITY_LABEL, type Priority } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import type { ItemRow, MeetingDetail } from '@/lib/meetings';
import { Modal } from '@/components/Modal';
import { OfficerPicker, type PickableOfficer } from '@/components/OfficerPicker';
import { Field, Notice } from '@/components/ui';

/**
 * Correcting an item while the minutes are being drafted.
 *
 * Minuting is typing at speed while a meeting runs, so the wrong date, the
 * wrong officer and a half-finished sentence all happen. There was no way to
 * fix any of it: an item could be raised and never touched again, which meant
 * the only remedy was raising a second one and explaining the first in the
 * remarks.
 *
 * Everything here is a drafting fix, and the server allows it only while the
 * item is inert — before the signed MoM is circulated, when nobody has been
 * told. After that the ladder takes over: report complete, confirm, respond,
 * close. That is rule 4, and this screen stays on the right side of it.
 */
export function EditItem({
  item,
  meeting,
  onClose,
  onSaved,
}: {
  item: ItemRow;
  meeting: MeetingDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isAction = item.type === 'ACTION';

  const [description, setDescription] = useState(item.description);
  const [remarks, setRemarks] = useState(item.remarks ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ? item.dueDate.slice(0, 10) : '');
  const [priority, setPriority] = useState<Priority>((item.priority ?? 'MEDIUM') as Priority);
  const [owners, setOwners] = useState<string[]>(item.owners.map((o) => o.user.id));
  const [responder, setResponder] = useState<string[]>(
    item.respondedBy ? [item.respondedBy.id] : [],
  );
  const [people, setPeople] = useState<PickableOfficer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Whoever was in the room first, as when the item was raised.
    const present = new Set(meeting.invitees.map((i) => i.user.id));
    setPeople(meeting.invitees.map((i) => ({ ...i.user, attended: true })));
    api<PickableOfficer[]>('/users')
      .then((all) =>
        setPeople([
          ...all.filter((p) => present.has(p.id)).map((p) => ({ ...p, attended: true })),
          ...all.filter((p) => !present.has(p.id)),
        ]),
      )
      .catch(() => {});
  }, [meeting.invitees]);

  const problem =
    description.trim().length < 5
      ? 'Describe the item in a sentence.'
      : isAction && owners.length === 0
        ? 'Name at least one responsible officer.'
        : isAction && !dueDate
          ? 'An action needs a date.'
          : null;

  async function save() {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * Two calls, because owners are their own endpoint — the list is a
       * relation, not a column, and setting it is an act of its own. Owners
       * go second: if the patch fails nothing has moved, and the picker is
       * still showing what the officer chose.
       */
      await api(`/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: description.trim(),
          remarks: remarks.trim(),
          ...(isAction ? { dueDate, priority } : {}),
          ...(!isAction && responder[0] ? { respondedById: responder[0] } : {}),
        }),
      });

      if (isAction) {
        const before = item.owners.map((o) => o.user.id).sort().join(',');
        if (owners.slice().sort().join(',') !== before) {
          await api(`/items/${item.id}/owners`, {
            method: 'PUT',
            body: JSON.stringify({ ownerIds: owners }),
          });
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${item.ref}`}
      lede={
        item.isActive
          ? 'This item has been circulated — most of it can no longer be changed here.'
          : 'Not circulated yet, so this is still a draft correction.'
      }
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2.5">
          {problem && <span className="mr-auto text-[12px] text-muted">{problem}</span>}
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!!problem || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save the change'}
          </button>
        </div>
      }
    >
      <div className="grid gap-3.5 p-[18px]">
        {error && <Notice tone="red">{error}</Notice>}

        {item.isActive && (
          <Notice tone="amber">
            The signed MoM for this meeting has been circulated, so {item.ref} is a commitment
            somebody has been given. The server will refuse changes that would rewrite it.
          </Notice>
        )}

        <Field label={isAction ? 'What is to be done' : 'What needs clarifying'} required>
          <textarea
            className="i min-h-[76px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {isAction ? (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Due" required>
                <input
                  type="date"
                  className="i"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
              <Field label="Priority" fixed>
                <select
                  className="i"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                >
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div role="group" aria-label="Responsible officers">
              <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
                Responsible officers
              </span>
              <OfficerPicker
                people={people}
                selected={owners}
                onChange={setOwners}
                multiple
                projectId={item.project.id}
              />
            </div>
          </>
        ) : (
          <div role="group" aria-label="Who should answer">
            <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
              Who should answer
            </span>
            <OfficerPicker
              people={people}
              selected={responder}
              onChange={setResponder}
              multiple={false}
              projectId={item.project.id}
            />
          </div>
        )}

        <Field label="Remarks">
          <input className="i" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
