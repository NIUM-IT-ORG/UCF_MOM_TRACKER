'use client';

import { useEffect, useState } from 'react';
import { PRIORITY_LABEL, type ItemType, type Priority } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, Field, Notice } from '@/components/ui';
import type { MeetingDetail, Person } from '@/lib/meetings';

/**
 * One form, two shapes.
 *
 * The dropdown at the top is the only control that changes the form, and it
 * changes it completely: an action has owners, a due date and a priority; a
 * clarification has one nominated responder and none of those. They are not
 * merged into a single superset with half the fields greyed out, because the
 * two are different commitments and the register counts them separately.
 *
 * A clarification carrying `ownerIds`, `dueDate` or `priority` is *rejected* by
 * the server rather than silently stripped — so this form never sends them.
 */
export function ItemForm({
  meeting,
  enabled,
  onCreated,
}: {
  meeting: MeetingDetail;
  enabled: boolean;
  onCreated: () => void;
}) {
  const { user, caps } = useSession();
  const [type, setType] = useState<ItemType>('ACTION');
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');
  const [projectId, setProjectId] = useState(meeting.projects[0]?.project.id ?? '');
  const [agendaItemId, setAgendaItemId] = useState('');
  const [owners, setOwners] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [respondedById, setRespondedById] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    // The people who were actually in the room come first: an action is nearly
    // always given to somebody who attended.
    setPeople(meeting.invitees.map((i) => i.user));
    api<Person[]>('/users')
      .then((all) => {
        const seen = new Set(meeting.invitees.map((i) => i.user.id));
        setPeople([...meeting.invitees.map((i) => i.user), ...all.filter((p) => !seen.has(p.id))]);
      })
      .catch(() => {});
  }, [meeting.invitees]);

  const descBad = touched && description.trim().length < 5;
  const ownersBad = touched && type === 'ACTION' && owners.length === 0;
  const dueBad = touched && type === 'ACTION' && !dueDate;

  if (!caps.includes('create_items')) {
    return (
      <Card title="Raise an action or clarification">
        <div className="px-[17px] py-4 text-[12.5px] text-muted">
          This needs the <b>Create actions &amp; clarifications</b> capability. Your designation does
          not carry it.
        </div>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    setDone(null);
    if (description.trim().length < 5) return;
    if (type === 'ACTION' && (owners.length === 0 || !dueDate)) return;

    setBusy(true);
    try {
      const created = await api<{ ref: string }>('/items', {
        method: 'POST',
        body: JSON.stringify({
          type,
          meetingId: meeting.id,
          projectId,
          ...(agendaItemId ? { agendaItemId } : {}),
          description: description.trim(),
          raisedById: user?.id,
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
          ...(type === 'ACTION'
            ? { ownerIds: owners, dueDate, priority }
            : respondedById
              ? { respondedById }
              : {}),
        }),
      });
      setDone(`${created.ref} recorded. It stays inert until the signed MoM is circulated.`);
      setDescription('');
      setRemarks('');
      setOwners([]);
      setDueDate('');
      setRespondedById('');
      setTouched(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Raise an action or clarification">
      <form onSubmit={submit} className="px-[17px] py-4" noValidate>
        <div className="mb-3 flex gap-1.5">
          {(['ACTION', 'CLARIFICATION'] as ItemType[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                setTouched(false);
              }}
              className={`flex-1 rounded-[9px] border px-3 py-2 text-[12.5px] font-semibold transition-colors ${
                type === t
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-white text-navy hover:border-steel'
              }`}
            >
              {t === 'ACTION' ? 'Action' : 'Clarification'}
            </button>
          ))}
        </div>

        <p className="mb-3 mt-0 text-[11.5px] text-muted">
          {type === 'ACTION'
            ? 'Work somebody has to do, by a date. Naming more than one officer makes them jointly and equally accountable.'
            : 'A question to be answered. No owners, no due date, no priority — one nominated responder.'}
        </p>

        {done && <Notice tone="green">{done}</Notice>}
        {error && <Notice tone="red">{error}</Notice>}

        <div className="grid gap-3.5">
          <Field
            label={type === 'ACTION' ? 'What has to be done' : 'What needs clarifying'}
            required
            error={descBad ? 'Describe it in a sentence somebody else would understand.' : null}
          >
            <textarea
              className={`i min-h-[70px] ${descBad ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                type === 'ACTION'
                  ? 'Submit a week-by-week pipe-laying schedule up to 31 October'
                  : 'Whether trench barricading cost is met from the contingency head'
              }
              aria-invalid={descBad}
            />
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Project" required>
              <select className="i" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {meeting.projects.map((p) => (
                  <option key={p.project.id} value={p.project.id}>
                    {p.project.code} — {p.project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Agenda point">
              <select className="i" value={agendaItemId} onChange={(e) => setAgendaItemId(e.target.value)}>
                <option value="">Not tied to one</option>
                {meeting.agenda.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ordinal}. {a.text.slice(0, 60)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {type === 'ACTION' ? (
            <>
              <Field
                label="Responsible officers"
                required
                error={ownersBad ? 'Name at least one officer. An action with nobody on it is not a commitment.' : null}
                hint="All named are jointly and equally accountable. Any one may report it complete."
              >
                <div
                  className={`grid max-h-[168px] gap-1 overflow-y-auto rounded-[10px] border p-2 ${
                    ownersBad ? 'border-[#D98C7F] bg-[#FEF8F7]' : 'border-line bg-white'
                  }`}
                >
                  {people.map((p) => {
                    const on = owners.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ${
                          on ? 'bg-ice text-navy' : 'hover:bg-[#F6F9FC]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setOwners((cur) =>
                              cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id],
                            )
                          }
                        />
                        <span className="truncate">
                          {p.name}
                          <small className="ml-1.5 text-[11px] text-muted">{p.designation.code}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Due date" required error={dueBad ? 'Every action needs a date.' : null}>
                  <input
                    type="date"
                    className={`i ${dueBad ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    aria-invalid={dueBad}
                  />
                </Field>
                <Field
                  label="Priority"
                  hint="Recorded and shown. It does not route confirmation yet."
                >
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
            </>
          ) : (
            <Field label="Who should answer" hint="Can be left open and nominated later.">
              <select
                className="i"
                value={respondedById}
                onChange={(e) => setRespondedById(e.target.value)}
              >
                <option value="">Nobody yet</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.designation.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Remarks">
            <input
              className="i"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Chair's direction: no trench open beyond 72 hours."
            />
          </Field>
        </div>

        <button className="btn-primary mt-4" type="submit" disabled={!enabled || busy}>
          {busy ? 'Recording…' : type === 'ACTION' ? 'Record the action' : 'Record the clarification'}
        </button>
        {!enabled && (
          <p className="mb-0 mt-2 text-[11.5px] text-muted">
            The minutes are locked while the MoM is with the approver.
          </p>
        )}
      </form>
    </Card>
  );
}
