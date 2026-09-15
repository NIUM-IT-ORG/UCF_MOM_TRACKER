'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ATTENDANCE_LABEL,
  DOCUMENT_TYPE_LABEL,
  MEETING_CATEGORY_LABEL,
  RSVP_LABEL,
  type AttendanceMark,
  type DocumentType,
  type RsvpResponse,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSetCrumbTail } from '@/lib/crumb';
import { formatBytes, formatDate } from '@/lib/format';
import { nextStep, timeRange, type ItemRow, type MeetingDetail, type MomRow } from '@/lib/meetings';
import {
  Avatar,
  Card,
  Empty,
  ItemStatusChip,
  MomChip,
  Notice,
  PageHead,
  ProjectTag,
  StageChip,
  TableWrap,
  Tabs,
} from '@/components/ui';
import { MeetingActions } from './MeetingActions';

const TABS = ['agenda', 'attendance', 'items', 'documents', 'mom'] as const;
type TabKey = (typeof TABS)[number];

interface MeetingDoc {
  id: string;
  name: string;
  type: DocumentType;
  remarks: string | null;
  createdAt: string;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number | null };
  uploadedBy: { id: string; name: string; initials: string };
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { caps, user } = useSession();

  const requested = params.get('tab');
  const tab: TabKey = (TABS as readonly string[]).includes(requested ?? '')
    ? (requested as TabKey)
    : 'agenda';

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [mom, setMom] = useState<MomRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, i, d, mm] = await Promise.all([
        api<MeetingDetail>(`/meetings/${id}`),
        api<ItemRow[]>(`/items?meetingId=${id}`).catch(() => []),
        api<MeetingDoc[]>(`/meetings/${id}/documents`).catch(() => []),
        api<MomRow>(`/meetings/${id}/mom`).catch(() => null),
      ]);
      setMeeting(m);
      setItems(i);
      setDocs(d);
      setMom(mm && 'id' in mm ? mm : null);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'NOT_FOUND'
            ? 'That meeting is not one you have access to.'
            : err.display
          : 'Could not load the meeting.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetCrumbTail(meeting?.code);

  function setTab(key: string) {
    router.replace(`/meetings/${id}?tab=${key}`, { scroll: false });
  }

  if (error) {
    return (
      <>
        <PageHead eyebrow="Meetings" title="Meeting" />
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

  return (
    <>
      <PageHead
        eyebrow={`${MEETING_CATEGORY_LABEL[meeting.category]} · ${meeting.code}`}
        title={meeting.title}
        lede={`${formatDate(meeting.meetingDate)} · ${timeRange(meeting)} · ${meeting.venue}`}
        actions={
          <>
            {meeting.type === 'INSTANT' && (
              <span className="rounded-md bg-[#FFF2E0] px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#A66A12]">
                Instant
              </span>
            )}
            <StageChip stage={meeting.stage} />
          </>
        }
      />

      {meeting.stage === 'CANCELLED' && meeting.cancelledReason && (
        <Notice tone="red">
          <b>Cancelled.</b> {meeting.cancelledReason} — the record is kept exactly as it was.
        </Notice>
      )}

      <MeetingActions meeting={meeting} mom={mom} onDone={() => void load()} />

      <div className="mb-3 flex flex-wrap items-center gap-2.5 text-[12px] text-muted">
        <span>Next step:</span>
        <b className="text-navy">{nextStep(meeting)}</b>
        <span className="ml-auto flex flex-wrap gap-1">
          {meeting.projects.map((p) => (
            <ProjectTag key={p.project.id} code={p.project.code} />
          ))}
        </span>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'agenda', label: 'Agenda', count: meeting.agenda.length },
          { key: 'attendance', label: 'Attendance', count: meeting.invitees.length },
          { key: 'items', label: 'Actions & clarifications', count: items.length },
          { key: 'documents', label: 'Documents', count: docs.length },
          { key: 'mom', label: 'Signed MoM' },
        ]}
      />

      {tab === 'agenda' && <AgendaTab meeting={meeting} />}
      {tab === 'attendance' && (
        <AttendanceTab
          meeting={meeting}
          canMark={caps.includes('mark_attendance')}
          meId={user?.id ?? ''}
          onDone={() => void load()}
        />
      )}
      {tab === 'items' && <ItemsTab meeting={meeting} items={items} />}
      {tab === 'documents' && <DocumentsTab docs={docs} />}
      {tab === 'mom' && <MomTab meeting={meeting} mom={mom} />}
    </>
  );
}

function AgendaTab({ meeting }: { meeting: MeetingDetail }) {
  if (meeting.agenda.length === 0) {
    return (
      <Card>
        <Empty>
          {meeting.type === 'INSTANT'
            ? 'An instant meeting has no circulated agenda. The points taken are in the minutes.'
            : 'Nothing on the agenda yet.'}
        </Empty>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {meeting.agendaFreezeAt && (
        <Notice>
          Invitee contributions {new Date(meeting.agendaFreezeAt) <= new Date() ? 'closed' : 'close'}{' '}
          <b>{formatDate(meeting.agendaFreezeAt)}</b>. The coordinator can still edit until the
          meeting is confirmed.
        </Notice>
      )}
      <Card title="Agenda" tag={meeting.stage === 'CONFIRMED' ? 'Circulated and frozen' : 'Draft'}>
        <ol className="m-0 list-none p-0">
          {meeting.agenda.map((a) => (
            <li key={a.id} className="border-b border-line px-[17px] py-3.5 last:border-0">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-bold ${
                    a.isCarryBlock ? 'bg-[#FFF2E0] text-[#A66A12]' : 'bg-ice text-navy'
                  }`}
                >
                  {a.ordinal}
                </span>
                <div className="min-w-0 flex-1">
                  <b className={`text-[13px] text-navy ${a.isDeferred ? 'line-through opacity-70' : ''}`}>
                    {a.text}
                  </b>
                  {a.isDeferred && (
                    <small className="ml-2 text-[11px] font-semibold text-accent">deferred</small>
                  )}

                  {a.carriedItems.length > 0 && (
                    <ul className="mt-2 space-y-1.5 p-0">
                      {a.carriedItems.map((c) => (
                        <li
                          key={c.item.id}
                          className="flex list-none flex-wrap items-center gap-2 rounded-lg bg-[#F9FBFD] px-2.5 py-1.5 text-[12px]"
                        >
                          <span className="font-mono text-[11px] font-bold text-navy">{c.item.ref}</span>
                          <span className="min-w-0 flex-1 truncate">{c.item.description}</span>
                          <ItemStatusChip
                            type={c.item.type}
                            status={(c.item.actionStatus ?? c.item.clarificationStatus) as never}
                          />
                          {c.revisedDue && (
                            <span className="text-[11px] text-muted">
                              revised to <b className="text-navy">{formatDate(c.revisedDue)}</b>
                            </span>
                          )}
                          {c.item.carryCount > 1 && (
                            <span className="rounded bg-[#FBEBE8] px-1.5 py-0.5 text-[10px] font-bold text-[#BF3B2B]">
                              carried {c.item.carryCount}×
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function AttendanceTab({
  meeting,
  canMark,
  meId,
  onDone,
}: {
  meeting: MeetingDetail;
  canMark: boolean;
  meId: string;
  onDone: () => void;
}) {
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>(() =>
    Object.fromEntries(
      meeting.invitees.filter((i) => i.attendance).map((i) => [i.user.id, i.attendance as AttendanceMark]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = ['HELD', 'MINUTED', 'CLOSED'].includes(meeting.stage);
  const mine = meeting.invitees.find((i) => i.user.id === meId);
  const unmarked = meeting.invitees.filter((i) => !marks[i.user.id]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meeting.id}/attendance`, {
        method: 'PUT',
        body: JSON.stringify({ marks }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not save attendance.');
    } finally {
      setBusy(false);
    }
  }

  async function rsvp(response: RsvpResponse) {
    try {
      await api(`/meetings/${meeting.id}/rsvp`, {
        method: 'PUT',
        body: JSON.stringify({ response }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not record your response.');
    }
  }

  return (
    <div className="grid gap-4">
      {error && <Notice tone="red">{error}</Notice>}

      {mine && meeting.type === 'SCHEDULED' && !held && (
        <Card title="Your response">
          <div className="flex flex-wrap items-center gap-2.5 px-[17px] py-4">
            {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as RsvpResponse[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => void rsvp(r)}
                aria-pressed={mine.rsvp === r}
                className={`rounded-[9px] border px-3.5 py-2 text-[12.5px] font-semibold ${
                  mine.rsvp === r
                    ? 'border-navy bg-navy text-white'
                    : 'border-line bg-white text-navy hover:border-steel'
                }`}
              >
                {RSVP_LABEL[r]}
              </button>
            ))}
            {mine.rsvp && <span className="text-[12px] text-muted">Recorded — you can change it.</span>}
          </div>
        </Card>
      )}

      <Card
        title="Attendance"
        tag={held ? `${unmarked.length} still unmarked` : 'Recorded after the meeting'}
      >
        {!held && (
          <Notice>
            Attendance is recorded once the meeting has been held. Marking everyone is what lets the
            MoM be generated.
          </Notice>
        )}
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>Officer</th>
                <th>Designation</th>
                <th>Department</th>
                <th>RSVP</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {meeting.invitees.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={i.user.initials} size={28} />
                      <div>
                        <b className="block text-[12.5px] text-navy">{i.user.name}</b>
                        {i.user.id === meeting.chair?.id && (
                          <small className="text-[10px] font-bold uppercase tracking-wide text-accent">
                            Chair
                          </small>
                        )}
                        {i.isWalkIn && (
                          <small className="ml-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                            walk-in
                          </small>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>{i.user.designation.name}</td>
                  <td>{i.user.department?.name ?? '—'}</td>
                  <td>{i.rsvp ? RSVP_LABEL[i.rsvp] : <span className="text-muted">—</span>}</td>
                  <td>
                    {canMark && held ? (
                      <div className="flex gap-1">
                        {(['PRESENT', 'VIRTUAL', 'ABSENT'] as AttendanceMark[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={marks[i.user.id] === m}
                            onClick={() => setMarks((cur) => ({ ...cur, [i.user.id]: m }))}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                              marks[i.user.id] === m
                                ? 'border-navy bg-navy text-white'
                                : 'border-line bg-white text-muted hover:border-steel'
                            }`}
                          >
                            {ATTENDANCE_LABEL[m]}
                          </button>
                        ))}
                      </div>
                    ) : i.attendance ? (
                      ATTENDANCE_LABEL[i.attendance]
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>

        {canMark && held && (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-[17px] py-3.5">
            <button className="btn-primary" type="button" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save attendance'}
            </button>
            {unmarked.length > 0 && (
              <span className="text-[12px] text-muted">
                {unmarked.length} still unmarked — the MoM cannot be generated until everyone is.
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function ItemsTab({ meeting, items }: { meeting: MeetingDetail; items: ItemRow[] }) {
  const inert = items.filter((i) => !i.isActive).length;

  if (items.length === 0) {
    return (
      <Card>
        <Empty>
          No actions or clarifications recorded yet. They are raised in the{' '}
          <Link href={`/meetings/${meeting.id}/minutes`}>minutes editor</Link>.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {inert > 0 && (
        <Notice tone="amber">
          {inert} of these {inert === 1 ? 'is' : 'are'} <b>not yet active</b>. Nobody has been told
          about them and no reminders will go out until the signed MoM is circulated.
        </Notice>
      )}
      <Card title="Actions & clarifications" tag={`${items.length} raised here`}>
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
                  <td>
                    {i.description}
                    {i.remarks && (
                      <small className="mt-0.5 block text-[11.5px] text-muted">{i.remarks}</small>
                    )}
                  </td>
                  <td>
                    {i.type === 'ACTION'
                      ? i.owners.map((o) => o.user.name).join(', ') || '—'
                      : (i.respondedBy?.name ?? '—')}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDate(i.dueDate)}
                    {i.daysOverdue > 0 && (
                      <small className="mt-0.5 block text-[11px] font-semibold text-danger">
                        {i.daysOverdue} day{i.daysOverdue === 1 ? '' : 's'} overdue
                      </small>
                    )}
                  </td>
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
      </Card>
    </div>
  );
}

function DocumentsTab({ docs }: { docs: MeetingDoc[] }) {
  if (docs.length === 0) {
    return (
      <Card>
        <Empty>Nothing filed against this meeting yet.</Empty>
      </Card>
    );
  }
  return (
    <Card title="Documents" tag={`${docs.length} on file`}>
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>File</th>
              <th>Added by</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <b className="text-navy">{d.name}</b>
                  {d.remarks && <small className="mt-0.5 block text-[11.5px] text-muted">{d.remarks}</small>}
                </td>
                <td className="whitespace-nowrap">{DOCUMENT_TYPE_LABEL[d.type] ?? d.type}</td>
                <td>
                  <a href={`/api/v1/files/${d.file.id}/content`} className="font-medium">
                    {d.file.fileName}
                  </a>
                  <small className="ml-1.5 text-[11px] text-muted">{formatBytes(d.file.sizeBytes)}</small>
                </td>
                <td className="whitespace-nowrap">{d.uploadedBy.name}</td>
                <td className="whitespace-nowrap">{formatDate(d.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function MomTab({ meeting, mom }: { meeting: MeetingDetail; mom: MomRow | null }) {
  if (!mom) {
    return (
      <Card>
        <Empty>
          No MoM has been generated yet. Record the minutes first, in the{' '}
          <Link href={`/meetings/${meeting.id}/minutes`}>minutes editor</Link>.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card title="Minutes of meeting" tag={`Version ${mom.version}`}>
        <div className="px-[17px] py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <MomChip state={mom.state} />
            {mom.circulatedAt && (
              <span className="text-[12px] text-muted">
                Circulated {formatDate(mom.circulatedAt)}
              </span>
            )}
            {mom.correctsMomId && (
              <span className="rounded-md bg-[#FFF2E0] px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#A66A12]">
                Corrigendum
              </span>
            )}
          </div>

          {mom.decisionRemark && (
            <Notice tone={mom.state === 'RETURNED' ? 'red' : 'green'}>
              <b>{mom.state === 'RETURNED' ? 'Returned:' : 'Approver’s remark:'}</b>{' '}
              {mom.decisionRemark}
            </Notice>
          )}

          <div className="flex flex-wrap gap-2.5">
            <a className="btn-primary" href={`/api/v1/meetings/${meeting.id}/mom.html`} target="_blank" rel="noreferrer">
              Open the document
            </a>
            <Link className="btn-ghost" href={`/mom?meeting=${meeting.id}`}>
              Approval console
            </Link>
            {mom.signedFileId && (
              <a className="btn-ghost" href={`/api/v1/files/${mom.signedFileId}/content`}>
                Signed scan
              </a>
            )}
          </div>
          <p className="mb-0 mt-3 text-[11.5px] text-muted">
            The document opens print-ready at A4 with its watermark. Use your browser’s
            “Save as PDF” for a copy to send on.
          </p>
        </div>
      </Card>
    </div>
  );
}
