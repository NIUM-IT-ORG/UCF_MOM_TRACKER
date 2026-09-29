'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Field, Notice } from '@/components/ui';
import type { MeetingDetail, MomRow } from '@/lib/meetings';

/**
 * The action bar: whatever this meeting can legally do next, and nothing else.
 *
 * Buttons are shown only when both the state machine and the caller's
 * capability allow the move, so a coordinator is never offered a button that
 * will come back with a 409. The server still refuses illegal moves — this only
 * decides what to render.
 */
export function MeetingActions({
  meeting,
  mom,
  onDone,
}: {
  meeting: MeetingDetail;
  mom: MomRow | null;
  onDone: () => void;
}) {
  const { caps } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<'cancel' | 'reschedule' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState({
    meetingDate: meeting.meetingDate.slice(0, 10),
    startTime: meeting.startTime,
    endTime: meeting.endTime,
  });

  const stage = meeting.stage;
  const canPlan = caps.includes('plan_scheduled') || caps.includes('plan_instant');
  const canConfirm = caps.includes('confirm_meeting');
  const canMinute = caps.includes('record_minutes');

  /** Returns whether it worked, so a caller can navigate only on success. */
  async function run(
    label: string,
    path: string,
    body?: unknown,
    method: 'POST' | 'DELETE' = 'POST',
  ): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setAsking(null);
      setReason('');
      onDone();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That did not work.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const buttons: React.ReactNode[] = [];

  if (stage === 'COMPOSED' && caps.includes('plan_instant')) {
    buttons.push(
      <button
        key="launch"
        className="btn-primary"
        type="button"
        disabled={busy !== null}
        onClick={() => void run('launch', `/meetings/${meeting.id}/launch`)}
      >
        {busy === 'launch' ? 'Starting…' : 'Launch the meeting'}
      </button>,
    );
  }

  if (stage === 'LIVE' || stage === 'CONFIRMED') {
    if (caps.includes('plan_instant') || canConfirm) {
      buttons.push(
        <button
          key="end"
          className="btn-primary"
          type="button"
          disabled={busy !== null}
          onClick={() => void run('end', `/meetings/${meeting.id}/end`)}
        >
          {busy === 'end' ? 'Ending…' : stage === 'LIVE' ? 'End the meeting' : 'Mark as held'}
        </button>,
      );
    }
  }

  if (stage === 'INVITEE_INPUTS' && canConfirm) {
    buttons.push(
      <button
        key="confirm"
        className="btn-primary"
        type="button"
        disabled={busy !== null}
        onClick={() => void run('confirm', `/meetings/${meeting.id}/confirm`)}
      >
        {busy === 'confirm' ? 'Confirming…' : 'Confirm & circulate the agenda'}
      </button>,
    );
  }

  if (stage === 'CONFIRMED' && canConfirm) {
    buttons.push(
      <button key="resched" className="btn-ghost" type="button" onClick={() => setAsking('reschedule')}>
        Reschedule
      </button>,
    );
  }

  if ((stage === 'CONFIRMED' || stage === 'INVITEE_INPUTS') && canConfirm) {
    buttons.push(
      <button key="cancel" className="btn-ghost" type="button" onClick={() => setAsking('cancel')}>
        Cancel the meeting
      </button>,
    );
  }

  /*
   * Housekeeping, not a step in the meeting, so it is offered only to the
   * System Administrator and only while there is nothing to lose. The server
   * refuses it the moment anything has followed from the meeting; the button
   * is hidden in the obvious cases so it is not offered and then refused.
   */
  if (caps.includes('delete_meeting') && !['HELD', 'MINUTED', 'CLOSED'].includes(stage)) {
    buttons.push(
      <button key="delete" className="btn-ghost" type="button" onClick={() => setAsking('delete')}>
        Delete
      </button>,
    );
  }

  if ((stage === 'HELD' || stage === 'MINUTED' || stage === 'LIVE') && canMinute) {
    buttons.push(
      <Link key="minutes" className="btn-primary" href={`/meetings/${meeting.id}/minutes`}>
        {meeting.minutes ? 'Continue the minutes' : 'Record the minutes'}
      </Link>,
    );
  }

  if (stage === 'MINUTED' && mom && mom.state !== 'NOT_GENERATED') {
    buttons.push(
      <Link key="console" className="btn-ghost" href={`/mom?meeting=${meeting.id}`}>
        MoM approval console
      </Link>,
    );
  }

  if (canPlan && ['PLANNED', 'AGENDA', 'INVITEES', 'INVITEE_INPUTS'].includes(stage)) {
    buttons.push(
      <Link key="edit" className="btn-ghost" href={`/meetings/new/scheduled?id=${meeting.id}`}>
        Continue planning
      </Link>,
    );
  }

  if (buttons.length === 0 && !asking && !error) return null;

  return (
    <div className="mb-4 rounded-[12px] border border-line bg-card p-[15px]">
      {error && <Notice tone="red">{error}</Notice>}

      {asking === null && <div className="flex flex-wrap gap-2.5">{buttons}</div>}

      {asking === 'reschedule' && (
        <div className="grid gap-3">
          <Notice tone="amber">
            The meeting keeps its reference and its agenda. Everyone invited is told again, and the
            reason is recorded in the audit trail — a date that moved with no reason is the first
            thing an auditor asks about.
          </Notice>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="New date" required>
              <input
                type="date"
                className="i"
                value={when.meetingDate}
                onChange={(e) => setWhen((w) => ({ ...w, meetingDate: e.target.value }))}
              />
            </Field>
            <Field label="Starts" required>
              <input
                type="time"
                className="i"
                value={when.startTime}
                onChange={(e) => setWhen((w) => ({ ...w, startTime: e.target.value }))}
              />
            </Field>
            <Field label="Ends" required>
              <input
                type="time"
                className="i"
                value={when.endTime}
                onChange={(e) => setWhen((w) => ({ ...w, endTime: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Reason" required>
            <textarea
              className="i min-h-[64px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="The Mission Director is travelling; moved at the chair's request."
            />
          </Field>
          <div className="flex flex-wrap gap-2.5">
            <button
              className="btn-primary"
              type="button"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={() => void run('resched', `/meetings/${meeting.id}/reschedule`, { ...when, reason: reason.trim() })}
            >
              {busy === 'resched' ? 'Rescheduling…' : 'Reschedule and tell everyone'}
            </button>
            <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
              Never mind
            </button>
          </div>
        </div>
      )}

      {asking === 'delete' && (
        <div className="mt-3 rounded-[10px] border border-[#EBC7C0] bg-[#FDF3F1] px-3.5 py-3">
          <p className="mb-2 mt-0 text-[12.5px]">
            <b>Delete {meeting.code} for good.</b> This is for a meeting created in error — a
            duplicate, or one raised against the wrong project. It cannot be undone, and the
            agenda, the invitees and any attached papers go with it.
          </p>
          <p className="mb-2.5 mt-0 text-[12px] text-muted">
            If the meeting was real and simply is not happening, cancel it instead: that keeps it
            in the register with a reason. The server refuses this outright if minutes, a MoM or
            any action has been recorded against it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void (async () => {
                  const gone = await run('delete', `/meetings/${meeting.id}`, undefined, 'DELETE');
                  // Only on success. A refused delete has a reason worth
                  // reading, and it is on this page — navigating away would
                  // throw it off screen before anybody saw it.
                  if (!gone) return;
                  // Nothing to come back to: reloading the page it was on
                  // would only produce "that meeting is not one you have
                  // access to", which reads like a permissions problem.
                  router.push('/meetings');
                  router.refresh();
                })()
              }
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete it permanently'}
            </button>
            <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {asking === 'cancel' && (
        <div className="grid gap-3">
          <Notice tone="red">
            A cancelled meeting keeps its record — it never disappears from the register. Everyone
            invited is told.
          </Notice>
          <Field label="Reason" required>
            <textarea
              className="i min-h-[64px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Superseded by the steering committee on 18 September."
            />
          </Field>
          <div className="flex flex-wrap gap-2.5">
            <button
              className="btn-primary"
              type="button"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={() => void run('cancel', `/meetings/${meeting.id}/cancel`, { reason: reason.trim() })}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel the meeting'}
            </button>
            <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
              Never mind
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
