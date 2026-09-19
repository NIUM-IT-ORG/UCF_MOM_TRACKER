'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { MomHistoryRow, MomRow } from '@/lib/meetings';
import { Card, Field, MomChip, Notice } from '@/components/ui';
import { MomPreview } from '@/components/MomPreview';
import { WhoCan } from '@/components/WhoCan';

/**
 * The approval console.
 *
 * Every gate in one place, each one showing only when the state machine and the
 * caller's capability both allow it. The remark is mandatory on return and
 * reject and optional on approve — which is the asymmetry the client asked for:
 * saying yes needs no explanation, saying no always does.
 */
interface Signatory {
  id: string;
  name: string;
  initials: string;
  designation: { code: string; name: string };
}

export function MomConsole({ mom, onDone }: { mom: MomRow; onDone: () => void }) {
  const { user, caps } = useSession();
  const [history, setHistory] = useState<MomHistoryRow[]>([]);
  const [asking, setAsking] = useState<'return' | 'reject' | 'approve' | 'sign' | null>(null);
  const [remark, setRemark] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [signatoryId, setSignatoryId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<MomHistoryRow[]>(`/meetings/${mom.meeting.id}/mom/history`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [mom.meeting.id, mom.state, mom.version]);

  // Who this can be routed to. Loaded when the approval panel opens rather
  // than on every render of every row in the register.
  useEffect(() => {
    if (asking !== 'approve') return;
    api<Signatory[]>(`/meetings/${mom.meeting.id}/mom/signatories`)
      .then((rows) => {
        setSignatories(rows);
        // Deliberately not preselected. Choosing who signs a government
        // minute is the decision being asked for; a default turns it into a
        // click-through.
        setSignatoryId('');
      })
      .catch(() => setSignatories([]));
  }, [asking, mom.meeting.id]);

  async function act(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      await api(`/meetings/${mom.meeting.id}/mom/${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setAsking(null);
      setRemark('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Signing.
   *
   * The signature is the act, recorded against the officer's name with the
   * moment it was made. A wet-signed scan is optional and only for the
   * physical file — if one is chosen it is uploaded first and filed alongside,
   * but nothing waits on it.
   */
  async function signAndCirculate() {
    setBusy('sign');
    setError(null);
    try {
      let fileId: string | undefined;
      if (file) {
        const reserved = await api<{ fileId: string; uploadUrl: string }>('/files', {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || 'application/pdf',
            sizeBytes: file.size,
          }),
        });
        const put = await fetch(reserved.uploadUrl, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': file.type || 'application/pdf' },
          body: file,
        });
        if (!put.ok) {
          const b = (await put.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new ApiError('INTERNAL', b?.error?.message ?? 'The upload failed.', put.status);
        }
        fileId = reserved.fileId;
      }
      await api(`/meetings/${mom.meeting.id}/mom/sign`, {
        method: 'POST',
        body: JSON.stringify(fileId ? { fileId } : {}),
      });
      setAsking(null);
      setFile(null);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not sign the MoM.');
    } finally {
      setBusy(null);
    }
  }

  const canMinute = caps.includes('record_minutes');
  const canApprove = caps.includes('approve_mom');
  /*
   * Holding `sign_mom` is not enough, and the screen has to say so. This MoM
   * was routed to one officer; showing a Sign button to the other one and
   * letting the server refuse it is how people conclude the system is broken.
   */
  const holdsSigning = caps.includes('sign_mom');
  const isMySignature = Boolean(mom.signatoryId && user?.id === mom.signatoryId);

  return (
    <Card title={`${mom.meeting.code} · ${mom.meeting.title}`} tag={`Version ${mom.version}`}>
      <div className="px-[17px] py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <MomChip state={mom.state} />
          <Link className="text-[12px]" href={`/meetings/${mom.meeting.id}`}>
            the meeting
          </Link>
          <a
            className="text-[12px]"
            href={`/api/v1/meetings/${mom.meeting.id}/mom.html`}
            target="_blank"
            rel="noreferrer"
          >
            open the document
          </a>
          <a
            className="text-[12px] font-semibold"
            href={`/api/v1/meetings/${mom.meeting.id}/mom.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            PDF with annexures
          </a>
          {mom.signedFileId && (
            <a className="text-[12px]" href={`/api/v1/files/${mom.signedFileId}/content`}>
              wet-signed scan
            </a>
          )}
        </div>

        {error && <Notice tone="red">{error}</Notice>}

        {mom.decisionRemark && (
          <Notice tone={mom.state === 'RETURNED' ? 'red' : 'green'}>
            <b>{mom.state === 'RETURNED' ? 'Returned for changes:' : 'Remark:'}</b> {mom.decisionRemark}
          </Notice>
        )}

        {mom.state === 'SIGNED' && (
          <Notice tone="green">
            <b>
              Signed
              {mom.signedBy
                ? ` by ${mom.signedBy.name}, ${mom.signedBy.designation.name},`
                : ''}{' '}
              and circulated {formatDate(mom.circulatedAt)}.
            </b>{' '}
            Every action and clarification in this document is now live, and the officers named have
            been told. This MoM cannot be changed — a correction is issued as a corrigendum.
          </Notice>
        )}

        {asking === null && (
          <div className="flex flex-wrap gap-2.5">
            {mom.state === 'DRAFT' && canMinute && (
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null}
                onClick={() => void act('submit', 'submit')}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            {mom.state === 'RETURNED' && canMinute && (
              <>
                <Link className="btn-ghost" href={`/meetings/${mom.meeting.id}/minutes`}>
                  Edit the minutes
                </Link>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act('submit', 'submit')}
                >
                  {busy === 'submit' ? 'Resubmitting…' : `Resubmit as v${mom.version + 1}`}
                </button>
              </>
            )}
            {mom.state === 'SUBMITTED' && canApprove && (
              <>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setAsking('approve')}
                >
                  Approve &amp; send for signature
                </button>
                <button className="btn-ghost" type="button" onClick={() => setAsking('return')}>
                  Return for changes
                </button>
                <button className="btn-ghost" type="button" onClick={() => setAsking('reject')}>
                  Reject
                </button>
              </>
            )}
            {mom.state === 'SUBMITTED' && !canApprove && (
              <WhoCan
                capability="approve_mom"
                lead="With the Project Coordinator for validation."
                who="Approving it and choosing who signs is their step"
              />
            )}
            {mom.state === 'APPROVED' && isMySignature && (
              <button className="btn-primary" type="button" onClick={() => setAsking('sign')}>
                Sign &amp; circulate
              </button>
            )}
            {mom.state === 'APPROVED' && !isMySignature && (
              <Notice tone="amber">
                <b>
                  Approved, and with{' '}
                  {mom.signatory
                    ? `${mom.signatory.name}, ${mom.signatory.designation.name},`
                    : 'the nominated officer'}{' '}
                  for signature.
                </b>{' '}
                {holdsSigning
                  ? 'It was routed to a different officer, so only they can sign it. Ask the Project Coordinator to return and re-route it if that is wrong.'
                  : 'It goes live the moment they sign — nothing is waiting on you.'}
              </Notice>
            )}
            {mom.state === 'DRAFT' && !canMinute && (
              <WhoCan
                capability="record_minutes"
                lead="A draft, not yet with the approver."
                who="Submitting it is the coordinator's step"
              />
            )}
            {mom.state === 'SIGNED' && canMinute && (
              <button
                className="btn-ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => void act('corrigendum', 'corrigendum')}
              >
                {busy === 'corrigendum' ? 'Opening…' : 'Issue a corrigendum'}
              </button>
            )}
          </div>
        )}

        {(asking === 'return' || asking === 'reject') && (
          <div className="grid gap-3">
            <Notice tone="amber">
              {asking === 'return'
                ? 'Returning unlocks the minutes so the coordinator can act on your remark. The next submission is a new version.'
                : 'Rejecting sends it back as a draft at the same version. Use this when nothing was accepted.'}
            </Notice>
            <Field label="Remark" required hint="This is what the coordinator will act on. Be specific.">
              <textarea
                className="i min-h-[76px]"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Action 13 has no date against the mutation record. Add it and resubmit."
              />
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null || remark.trim().length < 3}
                onClick={() => void act(asking, asking, { remark: remark.trim() })}
              >
                {busy ? 'Sending…' : asking === 'return' ? 'Return it' : 'Reject it'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
                Never mind
              </button>
            </div>
          </div>
        )}

        {asking === 'approve' && (
          <div className="grid gap-3">
            <Notice>
              Approving does two things: it accepts the minutes as correct, and it sends the
              document to one officer for signature. Nobody else will be able to sign it.
            </Notice>
            <Field
              label="Send for signature to"
              required
              hint="The Additional Mission Director or the Mission Director for this project."
            >
              {signatories.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">
                  No officer mapped to this project holds the authority to sign. Ask the System
                  Administrator to map an Additional Mission Director or a Mission Director.
                </p>
              ) : (
                <select
                  className="i"
                  value={signatoryId}
                  onChange={(e) => setSignatoryId(e.target.value)}
                >
                  <option value="">Choose an officer…</option>
                  {signatories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.designation.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Remark" hint="Optional on approval. Saying yes needs no explanation.">
              <textarea
                className="i min-h=[64px] min-h-[64px]"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Checked against the attendance and the agenda."
              />
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null || !signatoryId}
                onClick={() =>
                  void act('approve', 'approve', {
                    signatoryId,
                    ...(remark.trim() ? { remark: remark.trim() } : {}),
                  })
                }
              >
                {busy === 'approve' ? 'Approving…' : 'Approve & send for signature'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
                Never mind
              </button>
            </div>
          </div>
        )}

        {asking === 'sign' && (
          <div className="grid gap-3">
            <Notice tone="amber">
              <b>This is the last step, and it cannot be undone.</b> Circulating sets every action
              and clarification in the document live, tells the officers named on them, and closes
              the meeting. After this the MoM is immutable.
            </Notice>
            <p className="m-0 rounded-[10px] border border-line bg-[#F9FBFD] px-3.5 py-3 text-[12.5px] text-ink">
              Signing records your name, your designation and this moment on the document, beside a
              green tick. You are signing as{' '}
              <b className="text-navy">
                {user?.name}, {user?.designation?.name}
              </b>
              .
            </p>
            <Field
              label="Signed scan"
              hint="Optional. Only if a wet-signed copy is being kept in the physical file — the signature above is what circulates."
            >
              <div className="rounded-xl border-[1.5px] border-dashed border-[#B9C6D6] bg-[#F9FBFD] p-5 text-center">
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" className="btn-ghost" onClick={() => fileInput.current?.click()}>
                  Choose a PDF
                </button>
                <div className="mt-2 text-[12.5px] text-muted">
                  {file ? <b className="text-navy">{file.name}</b> : 'Not required. PDF, up to 25 MB.'}
                </div>
              </div>
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null}
                onClick={() => void signAndCirculate()}
              >
                {busy === 'sign' ? 'Signing…' : 'Sign & circulate — this makes the items live'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
                Never mind
              </button>
            </div>
          </div>
        )}

        <MomPreview
          meetingId={mom.meeting.id}
          label={`The document · ${mom.meeting.code} v${mom.version}`}
        />

        {history.length > 0 && (
          <div className="mt-4 border-t border-line pt-3.5">
            <h4 className="mb-2 mt-0 text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-muted">
              History
            </h4>
            <ol className="m-0 list-none space-y-1.5 p-0 text-[12px]">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-2">
                  <b className="text-navy">{h.event.replaceAll('_', ' ').toLowerCase()}</b>
                  <span className="text-muted">v{h.version}</span>
                  <span className="text-muted">· {h.actor?.name ?? 'System'}</span>
                  <span className="text-muted">· {formatDate(h.createdAt)}</span>
                  {h.remark && <span className="w-full text-muted">“{h.remark}”</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Card>
  );
}
