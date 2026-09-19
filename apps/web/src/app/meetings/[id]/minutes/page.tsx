'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSetCrumbTail } from '@/lib/crumb';
import { formatDate } from '@/lib/format';
import type { ItemRow, MeetingDetail, MomRow } from '@/lib/meetings';
import { DOCUMENT_TYPE_LABEL, type DocumentType } from '@mom/shared';
import { formatBytes } from '@/lib/format';
import { Card, Empty, ItemStatusChip, Notice, PageHead, TableWrap } from '@/components/ui';
import { DocumentUpload } from '@/components/DocumentUpload';
import { Editor } from './Editor';
import { ItemForm } from './ItemForm';

interface Annexure {
  id: string;
  name: string;
  type: DocumentType;
  remarks: string | null;
  createdAt: string;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number | null };
  uploadedBy: { id: string; name: string; initials: string };
}

/**
 * The minutes editor, with the typed entry form beside it.
 *
 * Two panes rather than two screens, because they are one task: you write a
 * paragraph about an agenda point and then raise the action it produced, and
 * making that a navigation is how actions stop getting raised at all.
 */
export default function MinutesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { caps } = useSession();

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [mom, setMom] = useState<MomRow | null>(null);
  const [annexures, setAnnexures] = useState<Annexure[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [body, setBody] = useState('');
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const [m, min, its, mm, docs] = await Promise.all([
        api<MeetingDetail>(`/meetings/${id}`),
        api<{ bodyHtml: string; lockedAt: string | null; updatedAt?: string }>(`/meetings/${id}/minutes`),
        api<ItemRow[]>(`/items?meetingId=${id}`).catch(() => []),
        api<MomRow>(`/meetings/${id}/mom`).catch(() => null),
        api<Annexure[]>(`/meetings/${id}/documents`).catch(() => []),
      ]);
      setMeeting(m);
      setItems(its);
      setAnnexures(docs);
      setMom(mm && 'id' in mm ? mm : null);
      setLocked(Boolean(min.lockedAt));
      if (!loaded.current) {
        setBody(min.bodyHtml ?? '');
        loaded.current = true;
      }
      setSavedAt(min.updatedAt ?? null);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'NOT_FOUND'
            ? 'That meeting is not one you have access to.'
            : err.display
          : 'Could not load the minutes.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetCrumbTail(meeting ? `${meeting.code} · minutes` : null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ updatedAt: string }>(`/meetings/${id}/minutes`, {
        method: 'POST',
        body: JSON.stringify({ bodyHtml: body }),
      });
      setSavedAt(res.updatedAt);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'MINUTES_LOCKED'
            ? 'These minutes are locked while the MoM is with the approver. Ask for it to be returned.'
            : err.display
          : 'Could not save.',
      );
      if (err instanceof ApiError && err.code === 'MINUTES_LOCKED') setLocked(true);
    } finally {
      setSaving(false);
    }
  }

  // Generating the MoM is the next step after saving, and it was reachable
  // from nowhere in the interface — the endpoint existed, every screen said to
  // do it, and no screen offered it.
  const unmarked = (meeting?.invitees ?? []).filter((i) => !i.attendance).map((i) => i.user.name);
  const ready =
    Boolean(meeting) &&
    ['HELD', 'MINUTED', 'CLOSED'].includes(meeting?.stage ?? '') &&
    unmarked.length === 0 &&
    body.trim().length > 0;
  const blocking = !meeting
    ? ''
    : !['HELD', 'MINUTED', 'CLOSED'].includes(meeting.stage)
      ? 'The meeting has to be held first.'
      : unmarked.length > 0
        ? `Attendance is still unmarked for ${unmarked.join(', ')}.`
        : body.trim().length === 0
          ? 'Write the minutes first.'
          : 'Save the minutes first.';

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await api(`/meetings/${id}/mom/generate`, { method: 'POST' });
      await load();
      router.push(`/mom?meeting=${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not generate the MoM.');
    } finally {
      setGenerating(false);
    }
  }

  if (error && !meeting) {
    return (
      <>
        <PageHead eyebrow="Minutes" title="Minutes" />
        <Card>
          <Empty>
            {error}
            <div className="mt-3">
              <Link href="/meetings">Back to meetings</Link>
            </div>
          </Empty>
        </Card>
      </>
    );
  }

  if (!meeting) {
    return (
      <Card>
        <Empty>Loading…</Empty>
      </Card>
    );
  }

  const canWrite = caps.includes('record_minutes') && !locked;
  const canRaise = caps.includes('create_items') && !locked;
  /*
   * Annexures lock with the minutes. Once the MoM is with the approver, what
   * was approved has to be what is circulated — otherwise a paper can be
   * slipped in after the reading and before the signature.
   */
  const canAttach = caps.includes('manage_project_docs') && !locked;

  return (
    <>
      <PageHead
        eyebrow={`Minutes · ${meeting.code}`}
        title={meeting.title}
        lede={`${formatDate(meeting.meetingDate)} · ${meeting.venue}`}
        actions={
          <Link className="btn-ghost" href={`/meetings/${meeting.id}`}>
            Back to the meeting
          </Link>
        }
      />

      {locked && (
        <Notice tone="amber">
          <b>Locked.</b> The MoM was submitted for approval, so the text underneath it must not
          move. It unlocks if the approver returns it.
        </Notice>
      )}
      {!caps.includes('record_minutes') && (
        <Notice>
          You can read these minutes, but writing them needs the <b>Record minutes</b> capability.
        </Notice>
      )}
      {error && <Notice tone="red">{error}</Notice>}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid gap-4">
          <Card
            title="Discussion and decisions"
            tag={savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Not saved yet'}
          >
            <div className="px-[17px] py-4">
              {meeting.agenda.length > 0 && (
                <details className="mb-3 rounded-[10px] border border-line bg-[#F9FBFD] px-3 py-2.5">
                  <summary className="cursor-pointer text-[12px] font-semibold text-navy">
                    The agenda, for reference ({meeting.agenda.length})
                  </summary>
                  <ol className="mb-0 mt-2 space-y-1 pl-5 text-[12px] text-muted">
                    {meeting.agenda.map((a) => (
                      <li key={a.id}>{a.text}</li>
                    ))}
                  </ol>
                </details>
              )}

              <Editor value={body} onChange={setBody} disabled={!canWrite} />

              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <button className="btn-primary" type="button" onClick={() => void save()} disabled={!canWrite || saving}>
                  {saving ? 'Saving…' : 'Save the minutes'}
                </button>
                <span className="text-[11.5px] text-muted">
                  Formatting is stripped to a small allow-list on save — pasting from Word keeps the
                  structure and loses the styling, on purpose.
                </span>
              </div>
            </div>
          </Card>

          {/*
            * Attachments belong here rather than on the meeting screen.
            *
            * A paper is tabled at the moment it is discussed, and the officer
            * writing "the revised estimate was reviewed" has the file open in
            * front of them. Asking them to finish the minutes, navigate away
            * and upload it afterwards is how a minute ends up referring to a
            * document nobody attached.
            *
            * They are listed on the MoM as numbered annexures and travel with
            * it when it is circulated.
            */}
          <Card
            title="Annexures"
            tag={annexures.length === 0 ? 'None attached' : `${annexures.length} attached`}
          >
            <div className="px-[17px] py-4">
              <p className="m-0 mb-3 text-[12.5px] text-muted">
                Papers tabled at this meeting — estimates, drawings, presentations. They are listed
                on the MoM as numbered annexures and are sent with it when it is circulated.
              </p>

              {annexures.length === 0 ? (
                <Empty>Nothing attached to these minutes yet.</Empty>
              ) : (
                <TableWrap>
                  <table>
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Document</th>
                        <th>Type</th>
                        <th>File</th>
                        <th>Attached by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annexures.map((d, n) => (
                        <tr key={d.id}>
                          <td className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-navy">
                            A-{String(n + 1).padStart(2, '0')}
                          </td>
                          <td>
                            {d.name}
                            {d.remarks && (
                              <small className="block text-[11px] text-muted">{d.remarks}</small>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {DOCUMENT_TYPE_LABEL[d.type] ?? d.type}
                          </td>
                          <td>
                            <a href={`/api/v1/files/${d.file.id}/content`} className="font-medium">
                              {d.file.fileName}
                            </a>
                            <small className="ml-1.5 text-[11px] text-muted">
                              {formatBytes(d.file.sizeBytes)}
                            </small>
                          </td>
                          <td className="whitespace-nowrap">{d.uploadedBy.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}

              {canAttach && !attaching && (
                <button
                  className="btn-ghost mt-3"
                  type="button"
                  onClick={() => setAttaching(true)}
                >
                  Attach a document
                </button>
              )}
              {!caps.includes('manage_project_docs') && (
                <p className="mb-0 mt-3 text-[11.5px] text-muted">
                  Attaching needs the <b>Add project documents</b> capability.
                </p>
              )}
              {caps.includes('manage_project_docs') && locked && (
                <p className="mb-0 mt-3 text-[11.5px] text-muted">
                  The MoM is with the approver, so the annexures are fixed too — what was approved
                  has to be what is circulated. They unlock if it is returned.
                </p>
              )}
            </div>
          </Card>

          {attaching && (
            <DocumentUpload
              target={`meetings/${id}`}
              onDone={() => {
                setAttaching(false);
                void load();
              }}
              onCancel={() => setAttaching(false)}
            />
          )}

          <Card
            title="Entries from these minutes"
            tag={`${items.filter((i) => i.type === 'ACTION').length} actions · ${items.filter((i) => i.type === 'CLARIFICATION').length} clarifications`}
            actions={<ItemForm meeting={meeting} enabled={canRaise} onCreated={() => void load()} />}
          >
            {items.length === 0 ? (
              <Empty>
                Nothing raised yet. Use <b>Add entry</b> above to record an action or a
                clarification.
              </Empty>
            ) : (
              <TableWrap>
                <table>
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Description</th>
                      <th>Responsible</th>
                      <th>Due</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-navy">
                          {i.ref}
                        </td>
                        <td>{i.description}</td>
                        <td>
                          {i.type === 'ACTION'
                            ? i.owners.map((o) => o.user.name).join(', ') || '—'
                            : (i.respondedBy?.name ?? '—')}
                        </td>
                        <td className="whitespace-nowrap">{formatDate(i.dueDate)}</td>
                        <td>
                          <ItemStatusChip
                            type={i.type}
                            status={(i.actionStatus ?? i.clarificationStatus) as never}
                            isActive={i.isActive}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Then what" tag="After the minutes">
            <div className="px-[17px] py-4 text-[12.5px] text-muted">
              <ol className="m-0 space-y-2 pl-5">
                <li>Record attendance for everyone invited.</li>
                <li>Generate the MoM — it needs the minutes and full attendance.</li>
                <li>Submit it. Every action needs an owner and a date, and the minutes lock.</li>
                <li>It is approved, signed and circulated.</li>
                <li>
                  <b className="text-navy">Circulation is what makes the items live.</b> Until then
                  nobody has been told.
                </li>
              </ol>
              <div className="mt-3">
                {mom && mom.state !== 'NOT_GENERATED' ? (
                  <Link className="btn-ghost" href={`/mom?meeting=${meeting.id}`}>
                    Go to the MoM console
                  </Link>
                ) : (
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={!caps.includes('record_minutes') || generating || !ready}
                    onClick={() => void generate()}
                  >
                    {generating ? 'Generating…' : 'Generate the draft MoM'}
                  </button>
                )}
                {!ready && (!mom || mom.state === 'NOT_GENERATED') && (
                  <p className="mb-0 mt-2 text-[11.5px] text-muted">
                    {blocking}
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
