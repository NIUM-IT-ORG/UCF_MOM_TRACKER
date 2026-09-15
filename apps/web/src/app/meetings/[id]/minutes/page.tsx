'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSetCrumbTail } from '@/lib/crumb';
import { formatDate } from '@/lib/format';
import type { ItemRow, MeetingDetail, MomRow } from '@/lib/meetings';
import { Card, Empty, ItemStatusChip, Notice, PageHead, TableWrap } from '@/components/ui';
import { Editor } from './Editor';
import { ItemForm } from './ItemForm';

/**
 * The minutes editor, with the typed entry form beside it.
 *
 * Two panes rather than two screens, because they are one task: you write a
 * paragraph about an agenda point and then raise the action it produced, and
 * making that a navigation is how actions stop getting raised at all.
 */
export default function MinutesPage() {
  const { id } = useParams<{ id: string }>();
  const { caps } = useSession();

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [mom, setMom] = useState<MomRow | null>(null);
  const [body, setBody] = useState('');
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const [m, min, its, mm] = await Promise.all([
        api<MeetingDetail>(`/meetings/${id}`),
        api<{ bodyHtml: string; lockedAt: string | null; updatedAt?: string }>(`/meetings/${id}/minutes`),
        api<ItemRow[]>(`/items?meetingId=${id}`).catch(() => []),
        api<MomRow>(`/meetings/${id}/mom`).catch(() => null),
      ]);
      setMeeting(m);
      setItems(its);
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

          <Card title="Raised in this meeting" tag={`${items.length}`}>
            {items.length === 0 ? (
              <Empty>Nothing raised yet. Use the form beside this to record an action or a clarification.</Empty>
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
          <ItemForm meeting={meeting} enabled={canRaise} onCreated={() => void load()} />

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
              {mom && mom.state !== 'NOT_GENERATED' && (
                <div className="mt-3">
                  <Link className="btn-ghost" href={`/mom?meeting=${meeting.id}`}>
                    Go to the MoM console
                  </Link>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
