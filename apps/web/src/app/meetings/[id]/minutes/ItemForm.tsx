'use client';

import { useEffect, useState } from 'react';
import { PRIORITY_LABEL, type ItemType, type Priority } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Field, Notice } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { OfficerPicker, type PickableOfficer } from '@/components/OfficerPicker';
import type { MeetingDetail } from '@/lib/meetings';

/**
 * One form, two shapes, in a dialog.
 *
 * The dropdown at the top is the only control that changes the form, and it
 * changes it completely: an action has owners, a due date and a priority; a
 * clarification has one nominated responder and none of those. They are not
 * merged into a single superset with half the fields greyed out, because the
 * two are different commitments and the register counts them separately.
 *
 * A clarification carrying `ownerIds`, `dueDate` or `priority` is *rejected* by
 * the server rather than silently stripped — so this form never sends them.
 *
 * It is a dialog rather than the old panel beside the editor for two reasons.
 * The panel was 380px wide, which is why the officer picker could show a name
 * and a three-letter code and nothing else — and choosing who is accountable
 * deserves to show who the officer is and what they can see. And writing up a
 * meeting produces four or five commitments in a row, which is what
 * "Save & add another" is for.
 */
const TYPE_BLURB: Record<ItemType, string> = {
  ACTION: 'Action — something someone must do by a date',
  CLARIFICATION: 'Clarification — a question somebody has to answer',
};

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
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ItemType>('ACTION');
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');
  const [projectId, setProjectId] = useState(meeting.projects[0]?.project.id ?? '');
  const [agendaItemId, setAgendaItemId] = useState('');
  const [owners, setOwners] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [responder, setResponder] = useState<string[]>([]);
  const [people, setPeople] = useState<PickableOfficer[]>([]);
  /*
   * Who raised this, which is usually not whoever is typing.
   *
   * The Meeting Coordinator minutes on behalf of the chair: they are at the
   * keyboard for the whole meeting, but the point was raised by the Project
   * Director, or the engineer, or the chair. Stamping every item with the
   * typist made the register read as though one person raised everything,
   * and "who asked for this?" is the first question about any commitment a
   * year later.
   *
   * It still defaults to the person typing, because that is the common case
   * on an instant meeting and a default nobody changes is better than a
   * blank nobody fills.
   */
  const [raisedById, setRaisedById] = useState('');
  /*
   * Plenty of clarifications are raised and settled in the room.
   *
   * Without this the minute could only record such a question as Open — and
   * since a clarification cannot be answered until the MoM is circulated, and
   * the MoM is generated before circulation, the document printed "Open"
   * against something answered in front of everybody. The status is on the
   * page, so that is a minute misreporting its own meeting.
   */
  const [answered, setAnswered] = useState(false);
  const [answer, setAnswer] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    // The people who were actually in the room come first, and are marked: an
    // action is nearly always given to somebody who attended.
    const present = new Set(meeting.invitees.map((i) => i.user.id));
    setPeople(meeting.invitees.map((i) => ({ ...i.user, attended: true })));
    api<PickableOfficer[]>('/users')
      .then((all) => {
        setPeople([
          ...all.filter((p) => present.has(p.id)).map((p) => ({ ...p, attended: true })),
          ...all.filter((p) => !present.has(p.id)),
        ]);
      })
      .catch(() => {});
  }, [meeting.invitees]);

  const canCreate = caps.includes('create_items');
  const descBad = touched && description.trim().length < 5;
  const ownersBad = touched && type === 'ACTION' && owners.length === 0;
  const dueBad = touched && type === 'ACTION' && !dueDate;

  useEffect(() => {
    // Only as an initial value: an explicit choice must survive a re-render.
    setRaisedById((cur) => cur || user?.id || '');
  }, [user?.id]);

  function reset() {
    setDescription('');
    setRemarks('');
    setOwners([]);
    setDueDate('');
    setResponder([]);
    setAgendaItemId('');
    setAnswered(false);
    setAnswer('');
    setRaisedById(user?.id ?? '');
    setTouched(false);
  }

  async function save(andAnother: boolean) {
    setTouched(true);
    setError(null);
    setDone(null);
    if (description.trim().length < 5) return;
    if (type === 'ACTION' && (owners.length === 0 || !dueDate)) return;
    /*
     * A clarification marked answered has to say what the answer was and who
     * gave it. The server refuses it either way; stopping here means the
     * officer is told beside the field rather than by a banner after a round
     * trip. "Responded" with no response on a signed minute is worse than
     * "Open" — it asserts something was settled and cannot say with what.
     */
    if (type === 'CLARIFICATION' && answered && (!answer.trim() || !responder[0])) return;

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
          raisedById: raisedById || user?.id,
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
          ...(type === 'ACTION'
            ? { ownerIds: owners, dueDate, priority }
            : {
                ...(responder[0] ? { respondedById: responder[0] } : {}),
                // Sent only when it really was answered in the room; the
                // server opens the item at Responded when it is present.
                ...(answered && answer.trim() ? { response: answer.trim() } : {}),
              }),
        }),
      });
      onCreated();
      reset();
      if (andAnother) {
        setDone(`${created.ref} recorded. It stays inert until the signed MoM is circulated.`);
      } else {
        setOpen(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return (
      <p className="m-0 text-[12.5px] text-muted">
        Raising an entry needs the <b>Create actions &amp; clarifications</b> capability. Your
        designation does not carry it.
      </p>
    );
  }

  return (
    <>
      <button
        className="btn-primary"
        type="button"
        disabled={!enabled}
        onClick={() => {
          reset();
          setError(null);
          setDone(null);
          setOpen(true);
        }}
      >
        + Add entry
      </button>
      {!enabled && (
        <p className="mb-0 mt-2 text-[11.5px] text-muted">
          The minutes are locked while the MoM is with the approver.
        </p>
      )}

      {open && (
        <Modal
          title="New entry from the minutes"
          lede="Every commitment in the text becomes an entry — an action with responsible officers and a date, or a clarification with a responder."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => void save(true)}
              >
                {busy ? 'Saving…' : 'Save & add another'}
              </button>
              <button
                className="btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void save(false)}
              >
                {busy ? 'Saving…' : 'Add entry'}
              </button>
            </>
          }
        >
          <form onSubmit={(e) => e.preventDefault()} noValidate>
            {done && <Notice tone="green">{done}</Notice>}
            {error && <Notice tone="red">{error}</Notice>}

            <div className="grid gap-4">
              <Field label="Entry type" required>
                <select
                  className="i"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as ItemType);
                    setTouched(false);
                  }}
                >
                  {(['ACTION', 'CLARIFICATION'] as ItemType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_BLURB[t]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label={type === 'ACTION' ? 'Action description' : 'What needs clarifying'}
                required
                error={descBad ? 'Describe it in a sentence somebody else would understand.' : null}
              >
                <textarea
                  className={`i min-h-[78px] ${descBad ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    type === 'ACTION'
                      ? 'What has to be done — short, specific and testable'
                      : 'Whether trench barricading cost is met from the contingency head'
                  }
                  aria-invalid={descBad}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Raised by" required>
                  <select
                    className="i"
                    value={raisedById}
                    onChange={(e) => setRaisedById(e.target.value)}
                  >
                    {/* Only as a fallback: the list below always contains the
                        signed-in officer once /users has answered. */}
                    {people.length === 0 && user && (
                      <option value={user.id}>
                        {user.name} - {user.designation.name}
                      </option>
                    )}
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} - {p.designation.name}
                        {p.attended ? ' (in the room)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Project" required>
                  <select
                    className="i"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    {meeting.projects.map((p) => (
                      <option key={p.project.id} value={p.project.id}>
                        {p.project.code} — {p.project.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Agenda point">
                  <select
                    className="i"
                    value={agendaItemId}
                    onChange={(e) => setAgendaItemId(e.target.value)}
                  >
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
                    hint="Pick one or more; all of them are equally accountable."
                    error={
                      ownersBad
                        ? 'Name at least one officer. An action with nobody on it is not a commitment.'
                        : null
                    }
                  >
                    <OfficerPicker
                      people={people}
                      selected={owners}
                      onChange={setOwners}
                      projectId={projectId}
                      invalid={ownersBad}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                      label="Due date"
                      required
                      error={dueBad ? 'Every action needs a date.' : null}
                    >
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
                      fixed
                      hint="Captured now; which priority needs whose sign-off is still an open decision."
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
                    <Field label="Meeting" fixed>
                      <input className="i" readOnly value={meeting.code} />
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <Field
                    label={answered ? 'Who answered it' : 'Who should answer'}
                    required={answered}
                    hint={
                      answered
                        ? 'The minute has to say who gave the answer.'
                        : 'Can be left open and nominated later.'
                    }
                  >
                    <OfficerPicker
                      people={people}
                      selected={responder}
                      onChange={setResponder}
                      multiple={false}
                      projectId={projectId}
                      invalid={touched && answered && !responder[0]}
                    />
                  </Field>

                  <div className="rounded-[10px] border border-line bg-[#F8FAFD] px-3.5 py-3">
                    <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px]">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={answered}
                        onChange={(e) => setAnswered(e.target.checked)}
                      />
                      <span>
                        <b className="text-navy">It was answered in the meeting</b>
                        <small className="mt-0.5 block text-[11.5px] text-muted">
                          The minutes will show it as <b>Responded</b> rather than Open. Closing
                          it stays with the officer who raised it.
                        </small>
                      </span>
                    </label>

                    {answered && (
                      <div className="mt-3">
                        <Field label="The answer" required>
                          <textarea
                            className={`i min-h-[72px] ${
                              touched && !answer.trim() ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''
                            }`}
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            placeholder="What was said in reply"
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                </>
              )}

              <Field label="Remarks">
                <input
                  className="i"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Targets, conditions, anything the chair specified"
                />
              </Field>

              <p className="m-0 rounded-[10px] border border-[#DCD2F0] bg-[#F5F1FE] px-3.5 py-3 text-[12.5px] text-[#4B3388]">
                {type === 'ACTION' ? (
                  <>
                    All the selected responsible officers see this on their dashboard, all of them
                    get the reminders, and <b>any one of them can report it complete</b> —
                    completion then goes for confirmation.
                  </>
                ) : (
                  <>
                    A clarification has <b>no owners, no due date and no priority</b>. It is a
                    question: somebody answers it, and whoever raised it closes it.
                  </>
                )}
              </p>

              <p className="m-0 text-[11.5px] text-muted">
                Nothing recorded here is live yet. Entries stay inert until the signed MoM is
                circulated — that is the moment the officers are actually told.
              </p>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
