'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { MomHistoryRow, MomRow } from '@/lib/meetings';
import { Card, Field, MomChip, Notice } from '@/components/ui';

/**
 * The approval console.
 *
 * Every gate in one place, each one showing only when the state machine and the
 * caller's capability both allow it. The remark is mandatory on return and
 * reject and optional on approve — which is the asymmetry the client asked for:
 * saying yes needs no explanation, saying no always does.
 */
export function MomConsole({ mom, onDone }: { mom: MomRow; onDone: () => void }) {
  const { caps } = useSession();
  const [history, setHistory] = useState<MomHistoryRow[]>([]);
  const [asking, setAsking] = useState<'return' | 'reject' | 'sign' | null>(null);
  const [remark, setRemark] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<MomHistoryRow[]>(`/meetings/${mom.meeting.id}/mom/history`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [mom.meeting.id, mom.state, mom.version]);

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
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  /** Signing is the three-step upload, then the transition that circulates. */
  async function signAndCirculate() {
    if (!file) return;
    setBusy('sign');
    setError(null);
    try {
      const { fileId, uploadUrl } = await api<{ fileId: string; uploadUrl: string }>('/files', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          sizeBytes: file.size,
        }),
      });
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': file.type || 'application/pdf' },
        body: file,
      });
      if (!put.ok) {
        const b = (await put.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new ApiError('INTERNAL', b?.error?.message ?? 'The upload failed.', put.status);
      }
      await api(`/meetings/${mom.meeting.id}/mom/sign`, {
        method: 'POST',
        body: JSON.stringify({ fileId }),
      });
      setAsking(null);
      setFile(null);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not circulate the MoM.');
    } finally {
      setBusy(null);
    }
  }

  const canMinute = caps.includes('record_minutes');
  const canApprove = caps.includes('approve_mom');
  const canSign = caps.includes('upload_signed');

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
          {mom.signedFileId && (
            <a className="text-[12px]" href={`/api/v1/files/${mom.signedFileId}/content`}>
              signed scan
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
            <b>Circulated {formatDate(mom.circulatedAt)}.</b> Every action and clarification in this
            document is now live, and the officers named have been told. This MoM cannot be changed —
            a correction is issued as a corrigendum.
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
                  onClick={() => void act('approve', 'approve', { remark: remark.trim() })}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
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
              <span className="text-[12px] text-muted">
                With the approver. Approving needs the <b>Approve the MoM</b> capability.
              </span>
            )}
            {mom.state === 'APPROVED' && canSign && (
              <button className="btn-primary" type="button" onClick={() => setAsking('sign')}>
                Upload the signed copy &amp; circulate
              </button>
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

        {asking === 'sign' && (
          <div className="grid gap-3">
            <Notice tone="amber">
              <b>This is the last step, and it cannot be undone.</b> Circulating sets every action
              and clarification in the document live, tells the officers named on them, and closes
              the meeting. After this the MoM is immutable.
            </Notice>
            <Field label="The signed scan" required hint="A PDF of the signed copy.">
              <div className="rounded-xl border-[1.5px] border-dashed border-[#B9C6D6] bg-[#F9FBFD] p-5 text-center">
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" className="btn-ghost" onClick={() => fileInput.current?.click()}>
                  Choose the PDF
                </button>
                <div className="mt-2 text-[12.5px] text-muted">
                  {file ? <b className="text-navy">{file.name}</b> : 'PDF only, up to 25 MB.'}
                </div>
              </div>
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null || !file}
                onClick={() => void signAndCirculate()}
              >
                {busy === 'sign' ? 'Circulating…' : 'Circulate — this makes the items live'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setAsking(null)}>
                Never mind
              </button>
            </div>
          </div>
        )}

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
