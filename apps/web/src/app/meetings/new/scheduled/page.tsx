'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { CarriedItem, Person } from '@/lib/meetings';
import {
  Card,
  Empty,
  ItemStatusChip,
  Notice,
  PageHead,
  ProjectTag,
  Steps,
  TableWrap,
} from '@/components/ui';
import { MeetingFields, draftErrors, emptyDraft, type MeetingDraft } from '../MeetingForm';

const STEPS = ['Details', 'Agenda', 'Invitees', 'Confirm'];

interface Candidate {
  id: string;
  ref: string;
  type: 'ACTION' | 'CLARIFICATION';
  description: string;
  dueDate: string | null;
  actionStatus: string | null;
  clarificationStatus: string | null;
  carryCount: number;
  alreadyCarried: boolean;
  revisedDueRequired: boolean;
  project: { id: string; code: string; name: string };
  meeting: { id: string; code: string; meetingDate: string };
  owners: { user: { id: string; name: string; initials: string } }[];
}

/**
 * The four-step scheduled wizard.
 *
 * The meeting is created for real at the end of step 1 rather than held in
 * memory until the last step. That is deliberate: the agenda, the carry-forward
 * candidates and the invitee list all need a meeting id to attach to, and a
 * coordinator who closes the tab at step 3 should not lose the first two steps.
 * The meeting simply sits at its planning stage until it is confirmed — which
 * is exactly what those stages are for.
 */
export default function ScheduledWizard() {
  const router = useRouter();
  const { caps } = useSession();

  const [step, setStep] = useState(0);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [code, setCode] = useState<string>('');
  const [draft, setDraft] = useState<MeetingDraft>(emptyDraft);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agenda, setAgenda] = useState<{ id: string; ordinal: number; text: string; isCarryBlock: boolean; carriedItems?: CarriedItem[] }[]>([]);
  const [newPoint, setNewPoint] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [carry, setCarry] = useState<Record<string, string>>({});
  /*
   * The carry list stays folded away until it is asked for.
   *
   * Open actions on a busy project run to dozens, and a table of them opening
   * between the agenda and the invitees made the step look like its job was
   * reviewing old work — coordinators were scrolling past it to get to the
   * point they came to add. It is offered, with its count, and shown on
   * request.
   */
  const [showCarry, setShowCarry] = useState(false);

  const [people, setPeople] = useState<Person[]>([]);
  const [invitees, setInvitees] = useState<string[]>([]);

  const errors = useMemo(() => draftErrors(draft), [draft]);

  useEffect(() => {
    api<Person[]>('/users')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  if (!caps.includes('plan_scheduled')) {
    return (
      <>
        <PageHead eyebrow="Meetings" title="Schedule a review" />
        <Card>
          <Empty>
            This needs the <b>Plan a scheduled meeting</b> capability.{' '}
            <Link href="/meetings">Back to meetings</Link>
          </Empty>
        </Card>
      </>
    );
  }

  async function saveDetails() {
    setTouched(true);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const payload = {
        category: draft.category,
        title: draft.title.trim(),
        meetingDate: draft.meetingDate,
        startTime: draft.startTime,
        endTime: draft.endTime,
        venue: draft.venue.trim(),
        ...(draft.vcLink.trim() ? { vcLink: draft.vcLink.trim() } : {}),
        chairId: draft.chairId,
        projectIds: draft.projectIds,
      };
      const meeting = meetingId
        ? await api<{ id: string; code: string }>(`/meetings/${meetingId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<{ id: string; code: string }>('/meetings', {
            method: 'POST',
            body: JSON.stringify({ type: 'SCHEDULED', ...payload }),
          });

      setMeetingId(meeting.id);
      setCode(meeting.code);
      setInvitees((cur) => [...new Set([...cur, draft.chairId])]);
      await loadAgenda(meeting.id);
      setStep(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not save the meeting.');
    } finally {
      setBusy(false);
    }
  }

  async function loadAgenda(id: string) {
    const [points, cands] = await Promise.all([
      api<typeof agenda>(`/meetings/${id}/agenda-items`),
      api<Candidate[]>(`/meetings/${id}/carry-candidates`).catch(() => []),
    ]);
    setAgenda(points);
    setCandidates(cands);
  }

  async function addPoint() {
    if (!meetingId || newPoint.trim().length < 5) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meetingId}/agenda-items`, {
        method: 'POST',
        body: JSON.stringify({ text: newPoint.trim() }),
      });
      setNewPoint('');
      await loadAgenda(meetingId);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not add that point.');
    } finally {
      setBusy(false);
    }
  }

  async function removePoint(id: string) {
    if (!meetingId) return;
    try {
      await api(`/meetings/${meetingId}/agenda-items/${id}`, { method: 'DELETE' });
      await loadAgenda(meetingId);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not remove that point.');
    }
  }

  async function applyCarry() {
    if (!meetingId) return;
    const chosen = Object.keys(carry);
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meetingId}/carry`, {
        method: 'POST',
        body: JSON.stringify({
          items: chosen.map((itemId) => ({
            itemId,
            ...(carry[itemId] ? { revisedDue: carry[itemId] } : {}),
          })),
        }),
      });
      setCarry({});
      await loadAgenda(meetingId);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not carry those items forward.');
    } finally {
      setBusy(false);
    }
  }

  async function saveInvitees() {
    if (!meetingId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meetingId}/invitees`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: [...new Set([...invitees, draft.chairId])] }),
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not save the invitees.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!meetingId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meetingId}/confirm`, { method: 'POST' });
      router.push(`/meetings/${meetingId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not confirm the meeting.');
      setBusy(false);
    }
  }

  const realPoints = agenda.filter((a) => !a.isCarryBlock);
  const carryBlock = agenda.find((a) => a.isCarryBlock);

  return (
    <>
      <PageHead
        eyebrow="Meetings"
        title="Schedule a review"
        lede="Four steps. Confirming is the last one, and it is what sends the agenda out."
        actions={code ? <span className="font-mono text-[12px] font-bold text-navy">{code}</span> : null}
      />

      <Steps steps={STEPS} current={step} onGo={meetingId ? (i) => setStep(i) : undefined} />

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-[#FDF3F1] px-3 py-2.5 text-[12.5px] text-danger">
          {error}
        </p>
      )}

      {step === 0 && (
        <Card title="Details">
          <div className="px-[17px] py-4">
            <MeetingFields
              draft={draft}
              set={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              errors={errors}
              showErrors={touched}
            />
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button className="btn-primary" type="button" onClick={() => void saveDetails()} disabled={busy}>
                {busy ? 'Saving…' : 'Save and continue'}
              </button>
              <Link className="btn-ghost" href="/meetings">
                Cancel
              </Link>
            </div>
          </div>
        </Card>
      )}

      {step === 1 && (
        <div className="grid gap-4">
          <Card title="Agenda" tag={`${realPoints.length} point${realPoints.length === 1 ? '' : 's'}`}>
            <div className="px-[17px] py-4">
              <div className="flex flex-wrap gap-2">
                <input
                  className="i flex-1 min-w-[240px]"
                  value={newPoint}
                  onChange={(e) => setNewPoint(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addPoint();
                    }
                  }}
                  placeholder="Zone A pipeline — revised completion target after the extra crew"
                  aria-label="New agenda point"
                />
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => void addPoint()}
                  disabled={busy || newPoint.trim().length < 5}
                >
                  Add
                </button>
              </div>

              {realPoints.length === 0 ? (
                <Empty>Nothing on the agenda yet. A meeting cannot be confirmed without at least one point.</Empty>
              ) : (
                <ol className="mt-3 space-y-1.5 p-0">
                  {realPoints.map((a) => (
                    <li
                      key={a.id}
                      className="flex list-none items-start gap-2.5 rounded-[10px] border border-line bg-white px-3 py-2.5"
                    >
                      <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-ice text-[10.5px] font-bold text-navy">
                        {a.ordinal}
                      </span>
                      <span className="flex-1 text-[12.5px]">{a.text}</span>
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={() => void removePoint(a.id)}
                        aria-label={`Remove agenda point ${a.ordinal}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>

          <Card
            title="Items carried forward"
            tag={carryBlock ? `${carryBlock.carriedItems?.length ?? 0} already on the agenda` : 'Agenda item 0'}
          >
            <div className="px-[17px] py-4">
              {candidates === null ? (
                <Empty>Loading…</Empty>
              ) : candidates.length === 0 ? (
                <Empty>Nothing open on these projects. Nothing to carry forward.</Empty>
              ) : !showCarry ? (
                /*
                 * Closed by default. The count is still shown, because "there
                 * are 14 open actions on these projects" is itself worth
                 * knowing before a meeting — it is the decision about whether
                 * to look, and hiding it entirely would just move the
                 * surprise to the meeting itself.
                 */
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => setShowCarry(true)}
                  >
                    Show actions ({candidates.filter((c) => !c.alreadyCarried).length})
                  </button>
                  <span className="text-[12px] text-muted">
                    {candidates.length} open item{candidates.length === 1 ? '' : 's'} on the
                    projects this meeting covers
                    {carryBlock?.carriedItems?.length
                      ? ` · ${carryBlock.carriedItems.length} already on the agenda`
                      : ''}
                    .
                  </span>
                </div>
              ) : (
                <>
                  <Notice>
                    Only items whose MoM has actually been circulated appear here — an item nobody
                    has been told about is not a commitment to review. Carrying an action forward a{' '}
                    <b>second</b> time needs a revised due date.
                  </Notice>

                  <TableWrap>
                    <table>
                      <thead>
                        <tr>
                          <th />
                          <th>Ref</th>
                          <th>Item</th>
                          <th>From</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th>Revised due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c) => {
                          const picked = c.id in carry;
                          return (
                            <tr key={c.id} className={c.alreadyCarried ? 'opacity-55' : ''}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={picked}
                                  disabled={c.alreadyCarried}
                                  aria-label={`Carry ${c.ref} forward`}
                                  onChange={() =>
                                    setCarry((cur) => {
                                      const next = { ...cur };
                                      if (picked) delete next[c.id];
                                      else next[c.id] = '';
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td className="whitespace-nowrap font-mono text-[11.5px] font-semibold">{c.ref}</td>
                              <td>
                                {c.description}
                                {c.owners.length > 0 && (
                                  <small className="mt-0.5 block text-[11px] text-muted">
                                    {c.owners.map((o) => o.user.name).join(', ')}
                                  </small>
                                )}
                              </td>
                              <td className="whitespace-nowrap">
                                <ProjectTag code={c.project.code} />
                                <small className="mt-0.5 block text-[10.5px] text-muted">{c.meeting.code}</small>
                              </td>
                              <td className="whitespace-nowrap">{formatDate(c.dueDate)}</td>
                              <td>
                                <ItemStatusChip
                                  type={c.type}
                                  status={(c.actionStatus ?? c.clarificationStatus) as never}
                                />
                              </td>
                              <td>
                                {c.alreadyCarried ? (
                                  <span className="text-[11.5px] text-muted">Already on the agenda</span>
                                ) : c.revisedDueRequired ? (
                                  <input
                                    type="date"
                                    className={`i ${picked && !carry[c.id] ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
                                    value={carry[c.id] ?? ''}
                                    disabled={!picked}
                                    aria-label={`Revised due date for ${c.ref}`}
                                    onChange={(e) => setCarry((cur) => ({ ...cur, [c.id]: e.target.value }))}
                                  />
                                ) : (
                                  <span className="text-[11.5px] text-muted">Not required</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>

                  <div className="mt-3 flex flex-wrap gap-2.5">
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => void applyCarry()}
                      disabled={busy || Object.keys(carry).length === 0}
                    >
                      Carry {Object.keys(carry).length || ''} forward
                    </button>
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => {
                        setShowCarry(false);
                        // Folding it away discards an unconfirmed selection
                        // rather than carrying it invisibly into a later click.
                        setCarry({});
                      }}
                    >
                      Hide actions
                    </button>
                  </div>
                </>
              )}
            </div>
          </Card>

          <div className="flex flex-wrap gap-2.5">
            <button className="btn-primary" type="button" onClick={() => setStep(2)} disabled={realPoints.length === 0}>
              Continue to invitees
            </button>
            <button className="btn-ghost" type="button" onClick={() => setStep(0)}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <Card title="Invitees" tag="The chairperson is always included">
          <div className="px-[17px] py-4">
            <Notice>
              Invitees may add to the agenda until it freezes 24 hours before the meeting. After
              that they can read it but not change it.
            </Notice>
            <div className="grid max-h-[360px] gap-1 overflow-y-auto rounded-[10px] border border-line bg-white p-2 sm:grid-cols-2">
              {people.map((p) => {
                const locked = p.id === draft.chairId;
                const on = invitees.includes(p.id) || locked;
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ${
                      on ? 'bg-ice text-navy' : 'hover:bg-[#F6F9FC]'
                    } ${locked ? '' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={locked}
                      onChange={() =>
                        setInvitees((cur) =>
                          cur.includes(p.id) ? cur.filter((id) => id !== p.id) : [...cur, p.id],
                        )
                      }
                    />
                    <span className="truncate">
                      {p.name}
                      <small className="ml-1.5 text-[11px] text-muted">{p.designation.name}</small>
                    </span>
                    {locked && <small className="ml-auto text-[10px] font-bold text-accent">CHAIR</small>}
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button className="btn-primary" type="button" onClick={() => void saveInvitees()} disabled={busy}>
                {busy ? 'Saving…' : 'Save and continue'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="Confirm" tag="This is what sends the agenda out">
          <div className="px-[17px] py-4">
            <Notice tone="amber">
              Confirming circulates the agenda and freezes it. After this the date only moves through
              <b> reschedule</b>, which tells everyone again.
            </Notice>

            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Reference" value={code} />
              <Fact label="Title" value={draft.title} />
              <Fact label="When" value={`${formatDate(draft.meetingDate)} · ${draft.startTime}–${draft.endTime}`} />
              <Fact label="Venue" value={draft.venue} />
              <Fact label="Agenda" value={`${realPoints.length} point${realPoints.length === 1 ? '' : 's'}${carryBlock ? ` + ${carryBlock.carriedItems?.length ?? 0} carried forward` : ''}`} />
              <Fact
                label="Invitees"
                value={`${new Set([...invitees, draft.chairId]).size} people`}
              />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button className="btn-primary" type="button" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm and circulate the agenda'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setStep(2)}>
                Back
              </button>
              {meetingId && (
                <Link className="btn-ghost" href={`/meetings/${meetingId}`}>
                  Finish later
                </Link>
              )}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9.5px] font-bold uppercase tracking-[1.2px] text-muted">{label}</dt>
      <dd className="m-0 mt-1 text-[13px] font-semibold text-navy">{value || '—'}</dd>
    </div>
  );
}
