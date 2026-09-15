'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { Card, Empty, Field, Notice, PageHead } from '@/components/ui';
import { useSession } from '@/lib/session';
import { api as call } from '@/lib/api';
import type { Person } from '@/lib/meetings';
import { MeetingFields, draftErrors, emptyDraft, type MeetingDraft } from '../MeetingForm';
import { useEffect } from 'react';

/**
 * The instant composer — one screen, then launch.
 *
 * docs/05 §2: launch requires only a title, one project and one invitee.
 * Everything else may be filled later. So this form collects the shared fields
 * and the people, and the *only* thing it insists on beyond the DTO is at least
 * one person to tell, because launching a meeting nobody is told about does
 * nothing at all.
 */
export default function InstantMeetingPage() {
  const router = useRouter();
  const { caps } = useSession();
  const [draft, setDraft] = useState<MeetingDraft>(() => ({
    ...emptyDraft(),
    category: 'TECHNICAL_COORDINATION',
    venue: 'Video conference',
  }));
  const [invitees, setInvitees] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Person[]>('/users')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  const errors = useMemo(() => draftErrors(draft), [draft]);
  const noPeople = invitees.length === 0 && !draft.chairId;

  if (!caps.includes('plan_instant')) {
    return (
      <>
        <PageHead eyebrow="Meetings" title="Instant meeting" />
        <Card>
          <Empty>
            This needs the <b>Create an instant meeting</b> capability.{' '}
            <Link href="/meetings">Back to meetings</Link>
          </Empty>
        </Card>
      </>
    );
  }

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (Object.keys(errors).length > 0 || noPeople) return;

    setBusy(true);
    try {
      const meeting = await api<{ id: string }>('/meetings', {
        method: 'POST',
        body: JSON.stringify({
          type: 'INSTANT',
          category: draft.category,
          title: draft.title.trim(),
          meetingDate: draft.meetingDate,
          startTime: draft.startTime,
          endTime: draft.endTime,
          venue: draft.venue.trim(),
          ...(draft.vcLink.trim() ? { vcLink: draft.vcLink.trim() } : {}),
          chairId: draft.chairId,
          projectIds: draft.projectIds,
        }),
      });

      // Invitees, then launch — in that order, because launching is what tells
      // them, and telling an empty list is the one failure worth avoiding.
      await api(`/meetings/${meeting.id}/invitees`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: [...new Set([...invitees, draft.chairId])] }),
      });
      await api(`/meetings/${meeting.id}/launch`, { method: 'POST' });

      router.push(`/meetings/${meeting.id}?tab=agenda`);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not start the meeting.');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Meetings"
        title="Instant meeting"
        lede="For a meeting happening now. Launching it tells everyone named immediately."
      />

      <form onSubmit={launch} noValidate>
        <Card title="The meeting">
          <div className="px-[17px] py-4">
            <Notice tone="amber">
              An instant meeting circulates no agenda. Every register, the MoM header and every
              export will say so, because a reader has to know the points were taken as raised.
            </Notice>
            <MeetingFields
              draft={draft}
              set={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              errors={errors}
              showErrors={touched}
            />
          </div>
        </Card>

        <div className="mt-4">
          <Card title="Who is in it" tag="They are told the moment you launch">
            <div className="px-[17px] py-4">
              <Field
                label="People"
                required
                error={touched && noPeople ? 'Name at least one person. Launching tells them.' : null}
              >
                <div className="grid max-h-[280px] gap-1 overflow-y-auto rounded-[10px] border border-line bg-white p-2 sm:grid-cols-2">
                  {people.length === 0 && (
                    <span className="px-1 py-1 text-[12px] text-muted">Loading officers…</span>
                  )}
                  {people.map((p) => {
                    const on = invitees.includes(p.id) || p.id === draft.chairId;
                    const locked = p.id === draft.chairId;
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ${
                          locked ? 'bg-ice font-semibold text-navy' : on ? 'bg-ice text-navy' : 'hover:bg-[#F6F9FC]'
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
                          <small className="ml-1.5 text-[11px] text-muted">{p.designation.code}</small>
                        </span>
                        {locked && <small className="ml-auto text-[10px] font-bold text-accent">CHAIR</small>}
                      </label>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Card>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-[#FDF3F1] px-3 py-2.5 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Starting…' : 'Launch the meeting'}
          </button>
          <Link className="btn-ghost" href="/meetings">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
