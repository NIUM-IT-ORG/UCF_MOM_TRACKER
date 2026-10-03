'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ATTENDANCE_LABEL,
  DOCUMENT_TYPE_LABEL,
  MEETING_CATEGORY_LABEL,
  momStateLabel,
  RSVP_LABEL,
  type AttendanceMark,
  type DocumentType,
  type RsvpResponse,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSetCrumbTail } from '@/lib/crumb';
import { formatBytes, formatDate } from '@/lib/format';
import {
  nextStep,
  timeRange,
  type ItemRow,
  type MeetingDetail,
  type MomRow,
} from '@/lib/meetings';
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
import { GenerateMom } from './GenerateMom';
import { MomPreview } from '@/components/MomPreview';
import { WhoCan } from '@/components/WhoCan';
import { DocumentUpload } from '@/components/DocumentUpload';
import { ShareDialog } from '@/components/ShareDialog';
import { ItemDrawer } from '@/components/ItemDrawer';

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
  /** Filed after the signed MoM went out, so it is not in the circulated copy. */
  afterCirculation: boolean;
  circulatedVersion: number | null;
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

  const [sharing, setSharing] = useState(false);
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
            <StageChip
              stage={meeting.stage}
              /*
               * A closed meeting reads "Closed", which is true and useless:
               * the question anyone has in front of a finished meeting is
               * whether the MoM went out and in what form. When it has, the
               * chip answers that instead.
               */
              label={
                meeting.stage === 'CLOSED' && mom?.state === 'SIGNED'
                  ? momStateLabel('SIGNED', Boolean(mom.signedFileId))
                  : undefined
              }
            />
            {caps.includes('share_object') && (
              <button type="button" className="btn-ghost" onClick={() => setSharing(true)}>
                Share
              </button>
            )}
          </>
        }
      />

      {sharing && (
        <ShareDialog
          subjectType="MEETING"
          subjectId={meeting.id}
          subjectRef={meeting.code}
          defaultSubject={`${meeting.code} · ${meeting.title}`}
          link={`/meetings/${meeting.id}`}
          // The agenda travels with the invitation; that is what docs/06 hangs
          // on MTG-01 and MTG-05, and it is the thing a recipient actually
          // needs before the meeting.
          attachments={[
            { label: 'Agenda PDF', href: `/api/v1/meetings/${meeting.id}/agenda.pdf` },
            ...(mom
              ? [{ label: 'MoM PDF', href: `/api/v1/meetings/${meeting.id}/mom.pdf` }]
              : []),
          ]}
          onClose={() => setSharing(false)}
        />
      )}

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

      {tab === 'agenda' && (
        <AgendaTab
          meeting={meeting}
          canShare={caps.includes('share_object')}
          canEdit={caps.includes('add_agenda')}
          onChanged={() => void load()}
        />
      )}
      {tab === 'attendance' && (
        <AttendanceTab
          meeting={meeting}
          canMark={caps.includes('mark_attendance')}
          meId={user?.id ?? ''}
          onDone={() => void load()}
        />
      )}
      {tab === 'items' && (
        <ItemsTab meeting={meeting} items={items} onChanged={() => void load()} />
      )}
      {tab === 'documents' && (
        <DocumentsTab
          meetingId={meeting.id}
          docs={docs}
          canUpload={caps.includes('manage_project_docs')}
          onUploaded={() => void load()}
        />
      )}
      {tab === 'mom' && (
        <MomTab
          meeting={meeting}
          mom={mom}
          canGenerate={caps.includes('record_minutes')}
          onGenerated={() => void load()}
        />
      )}
    </>
  );
}

function AgendaTab({
  meeting,
  canShare,
  canEdit,
  onChanged,
}: {
  meeting: MeetingDetail;
  canShare: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [newPoint, setNewPoint] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The agenda closes for good once the meeting has been held: from then on
   * it is the record of what was taken, and section 2 of the MoM reproduces
   * it. Anything thought of afterwards belongs in the minutes.
   */
  const held = ['HELD', 'MINUTED', 'CLOSED', 'CANCELLED'].includes(meeting.stage);
  const editable = canEdit && !held;
  /*
   * Confirming circulates the agenda, so invitees may be holding a printed
   * copy. Changes are still allowed — the coordinator's — but the screen says
   * what they cost before anybody makes one.
   */
  const circulated = meeting.stage === 'CONFIRMED';

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const addPoint = () =>
    run(async () => {
      await api(`/meetings/${meeting.id}/agenda-items`, {
        method: 'POST',
        body: JSON.stringify({ text: newPoint.trim() }),
      });
      setNewPoint('');
    });

  const saveEdit = () =>
    run(async () => {
      if (!editing) return;
      await api(`/meetings/${meeting.id}/agenda-items/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: editing.text.trim() }),
      });
      setEditing(null);
    });

  const removePoint = (id: string) =>
    run(() => api(`/meetings/${meeting.id}/agenda-items/${id}`, { method: 'DELETE' }));

  const toggleDefer = (id: string) =>
    run(() => api(`/meetings/${meeting.id}/agenda-items/${id}/defer`, { method: 'POST' }));

  /*
   * The agenda document is offered even when there is nothing on it yet: the
   * letterhead, the date, the venue and the invitee list are already worth
   * circulating, and a coordinator assembling a meeting wants to see what the
   * notice will look like before they confirm it. It prints with a DRAFT
   * watermark until the meeting is confirmed, so an early copy cannot be
   * mistaken for the final one.
   */
  const documentActions = (
    <>
      <a
        className="btn-ghost"
        href={`/api/v1/meetings/${meeting.id}/agenda.pdf`}
        target="_blank"
        rel="noreferrer"
      >
        Agenda PDF
      </a>
      {canShare && (
        <button type="button" className="btn-ghost" onClick={() => setSharing(true)}>
          Share
        </button>
      )}
    </>
  );

  const dialog = sharing && (
    <ShareDialog
      subjectType="MEETING"
      subjectId={meeting.id}
      subjectRef={`${meeting.code} · agenda`}
      defaultSubject={`Agenda · ${meeting.code} · ${meeting.title}`}
      link={`/meetings/${meeting.id}?tab=agenda`}
      attachments={[
        { label: 'Agenda PDF', href: `/api/v1/meetings/${meeting.id}/agenda.pdf` },
      ]}
      onClose={() => setSharing(false)}
    />
  );

  if (meeting.agenda.length === 0) {
    return (
      <>
        {dialog}
        <Card title="Agenda" actions={documentActions}>
          <Empty>
            {meeting.type === 'INSTANT'
              ? 'An instant meeting has no circulated agenda. The points taken are in the minutes.'
              : 'Nothing on the agenda yet.'}
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <div className="grid gap-4">
      {dialog}
      {error && <Notice tone="red">{error}</Notice>}

      {meeting.agendaFreezeAt && !circulated && !held && (
        <Notice>
          Invitee contributions{' '}
          {new Date(meeting.agendaFreezeAt) <= new Date() ? 'closed' : 'close'}{' '}
          <b>{formatDate(meeting.agendaFreezeAt)}</b>. The coordinator can still edit.
        </Notice>
      )}

      {circulated && editable && (
        <Notice tone="amber">
          This agenda went out when the meeting was confirmed, so invitees may be holding a copy.
          You can still change it — the document will say it was amended, and when.
        </Notice>
      )}

      {held && (
        <Notice>
          This meeting has been held, so the agenda is now the record of what was taken. Anything
          further belongs in the <Link href={`/meetings/${meeting.id}/minutes`}>minutes</Link>.
        </Notice>
      )}

      <Card
        title="Agenda"
        tag={
          held
            ? 'As taken'
            : circulated
              ? meeting.agendaAmendedAt
                ? 'Circulated · amended'
                : 'Circulated'
              : 'Draft'
        }
        actions={documentActions}
      >
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
                  {editing?.id === a.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        className="i min-w-[240px] flex-1"
                        value={editing.text}
                        onChange={(e) => setEditing({ id: a.id, text: e.target.value })}
                        aria-label={`Reword point ${a.ordinal}`}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy || editing.text.trim().length < 5}
                        onClick={() => void saveEdit()}
                      >
                        Save
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start gap-2">
                      <b
                        className={`flex-1 text-[13px] text-navy ${a.isDeferred ? 'line-through opacity-70' : ''}`}
                      >
                        {a.text}
                        {a.isDeferred && (
                          <small className="ml-2 text-[11px] font-semibold text-accent">
                            deferred
                          </small>
                        )}
                      </b>
                      {/*
                        * The carry block is generated from the items it
                        * carries, so it cannot be reworded or removed — only
                        * the individual items can be deferred. Buttons that
                        * would always be refused are not shown.
                        */}
                      {editable && !a.isCarryBlock && (
                        <span className="flex flex-none gap-1">
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => setEditing({ id: a.id, text: a.text })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => void toggleDefer(a.id)}
                          >
                            {a.isDeferred ? 'Reinstate' : 'Defer'}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => void removePoint(a.id)}
                          >
                            Remove
                          </button>
                        </span>
                      )}
                    </div>
                  )}

                  {a.carriedItems.length > 0 && (
                    <ul className="mt-2 space-y-1.5 p-0">
                      {a.carriedItems.map((c) => (
                        <li
                          key={c.item.id}
                          className="flex list-none flex-wrap items-center gap-2 rounded-lg bg-[#F9FBFD] px-2.5 py-1.5 text-[12px]"
                        >
                          <span className="font-mono text-[11px] font-bold text-navy">
                            {c.item.ref}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{c.item.description}</span>
                          <ItemStatusChip
                            type={c.item.type}
                            status={
                              (c.item.actionStatus ?? c.item.clarificationStatus) as never
                            }
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

        {editable && (
          <div className="flex flex-wrap gap-2 border-t border-line px-[17px] py-3.5">
            <input
              className="i min-w-[240px] flex-1"
              value={newPoint}
              onChange={(e) => setNewPoint(e.target.value)}
              placeholder="Add a point — what is to be discussed"
              aria-label="New agenda point"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newPoint.trim().length >= 5) void addPoint();
              }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={busy || newPoint.trim().length < 5}
              onClick={() => void addPoint()}
            >
              {busy ? 'Saving…' : 'Add'}
            </button>
          </div>
        )}
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
      meeting.invitees
        .filter((i) => i.attendance)
        .map((i) => [i.user.id, i.attendance as AttendanceMark]),
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
            {mine.rsvp && (
              <span className="text-[12px] text-muted">Recorded — you can change it.</span>
            )}
          </div>
        </Card>
      )}

      <Card
        title="Attendance"
        tag={held ? `${unmarked.length} still unmarked` : 'Recorded after the meeting'}
      >
        {!held && (
          <Notice>
            Attendance is recorded once the meeting has been held. Marking everyone is what lets
            the MoM be generated.
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
            <button
              className="btn-primary"
              type="button"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save attendance'}
            </button>
            {unmarked.length > 0 && (
              <span className="text-[12px] text-muted">
                {unmarked.length} still unmarked — the MoM cannot be generated until everyone
                is.
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function ItemsTab({
  meeting,
  items,
  onChanged,
}: {
  meeting: MeetingDetail;
  items: ItemRow[];
  onChanged: () => void;
}) {
  const inert = items.filter((i) => !i.isActive).length;
  /*
   * The same drawer the register uses, rather than a second set of buttons.
   *
   * This tab showed a status and offered no way to change it, so an officer
   * looking at the meeting an action came from had to find it again in the
   * register to report it complete. Reusing the drawer means the transition
   * rules — inertness, "nobody confirms their own work", who may close a
   * clarification — are stated in exactly one place.
   */
  const [openItem, setOpenItem] = useState<string | null>(null);

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
          {inert} of these {inert === 1 ? 'is' : 'are'} <b>not yet active</b>. Nobody has been
          told about them and no reminders will go out until the signed MoM is circulated.
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
                <tr
                  key={i.id}
                  className="cursor-pointer hover:bg-[#F6F9FC]"
                  onClick={() => setOpenItem(i.id)}
                >
                  <td className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-navy">
                    {/* A button, so the row is reachable by keyboard and
                        announced as something that opens. */}
                    <button
                      type="button"
                      className="font-mono text-[11.5px] font-semibold text-navy underline-offset-2 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenItem(i.id);
                      }}
                    >
                      {i.ref}
                    </button>
                  </td>
                  <td>
                    {i.description}
                    {i.remarks && (
                      <small className="mt-0.5 block text-[11.5px] text-muted">
                        {i.remarks}
                      </small>
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
        <p className="mb-0 px-[17px] pb-3.5 pt-1 text-[11.5px] text-muted">
          Open one to report it complete, confirm it, send it back, or answer a clarification.
        </p>
      </Card>

      {openItem && (
        <ItemDrawer
          itemId={openItem}
          onClose={() => setOpenItem(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function DocumentsTab({
  meetingId,
  docs,
  canUpload,
  onUploaded,
}: {
  meetingId: string;
  docs: MeetingDoc[];
  canUpload: boolean;
  onUploaded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const late = docs.filter((d) => d.afterCirculation);

  return (
    <div className="grid gap-4">
      {late.length > 0 && (
        <Notice tone="amber">
          {late.length === 1 ? 'One document was' : `${late.length} documents were`} filed after
          the signed MoM was circulated, so {late.length === 1 ? 'it is' : 'they are'} on record
          here but not inside the copy that went out. A corrigendum re-merges every annexure on
          file; until then {late.length === 1 ? 'it has' : 'they have'} to travel separately.
        </Notice>
      )}

      {!canUpload && (
        <Notice>
          <WhoCan
            capability="manage_project_docs"
            lead="You can read these; filing one is somebody else's step."
            who="On this meeting that is"
          />
        </Notice>
      )}

      {canUpload && !adding && (
        <div>
          <button className="btn-primary" onClick={() => setAdding(true)} type="button">
            Add a document
          </button>
        </div>
      )}

      {adding && (
        <DocumentUpload
          target={`meetings/${meetingId}`}
          onDone={() => {
            setAdding(false);
            onUploaded();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <Card title="Documents" tag={`${docs.length} on file`}>
        {docs.length === 0 ? (
          <Empty>
            Nothing tabled at this meeting yet. Papers circulated with the agenda, presentations
            shown, and anything handed round belong here.
          </Empty>
        ) : (
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
                      {d.afterCirculation && (
                        <span className="ml-1.5 rounded-full bg-[#FDF4E7] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A5A1B]">
                          Not in v{d.circulatedVersion}
                        </span>
                      )}
                      {d.remarks && (
                        <small className="mt-0.5 block text-[11.5px] text-muted">
                          {d.remarks}
                        </small>
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
                    <td className="whitespace-nowrap">{formatDate(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function MomTab({
  meeting,
  mom,
  canGenerate,
  onGenerated,
}: {
  meeting: MeetingDetail;
  mom: MomRow | null;
  canGenerate: boolean;
  onGenerated: () => void;
}) {
  const router = useRouter();
  const { caps } = useSession();
  const [opening, setOpening] = useState(false);
  const [corrigendumError, setCorrigendumError] = useState<string | null>(null);

  /*
   * Opening a corrigendum lived only on the approval console, which is not
   * where anyone looks for it: the coordinator reading the circulated MoM is
   * on this tab, and the route out was a button on another screen that does
   * not say what it is for. Same endpoint, same capability, same refusal if
   * the MoM has not been circulated — just offered where the question is
   * asked.
   */
  async function openCorrigendum() {
    setOpening(true);
    setCorrigendumError(null);
    try {
      await api(`/meetings/${meeting.id}/mom/corrigendum`, { method: 'POST' });
      // Straight to the editor: the corrigendum unlocks the minutes, and
      // correcting them is the only reason to have opened one.
      router.push(`/meetings/${meeting.id}/minutes`);
    } catch (err) {
      setCorrigendumError(
        err instanceof ApiError ? err.display : 'The corrigendum could not be opened.',
      );
    } finally {
      setOpening(false);
    }
  }

  // "No MoM yet" is a step, not a dead end. Whoever is looking at this tab is
  // trying to produce one, so the button to do it belongs here — with the two
  // things it needs stated plainly, because the server refuses without them.
  if (!mom || mom.state === 'NOT_GENERATED') {
    return (
      <GenerateMom
        meeting={meeting}
        canGenerate={canGenerate}
        onGenerated={onGenerated}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <Card title="Minutes of meeting" tag={`Version ${mom.version}`}>
        <div className="px-[17px] py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <MomChip state={mom.state} uploaded={Boolean(mom.signedFileId)} />
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
            {/* The signed upload is the MoM when there is one, so it is what
                this opens. The generated copy is still reachable beside it. */}
            <a
              className="btn-primary"
              href={
                mom.signedFileId
                  ? `/api/v1/files/${mom.signedFileId}/content`
                  : `/api/v1/meetings/${meeting.id}/mom.html`
              }
              target="_blank"
              rel="noreferrer"
            >
              Open the document
            </a>
            <Link className="btn-ghost" href={`/mom?meeting=${meeting.id}`}>
              Approval console
            </Link>
            {mom.signedFileId && (
              <a
                className="btn-ghost"
                href={`/api/v1/meetings/${meeting.id}/mom.html`}
                target="_blank"
                rel="noreferrer"
              >
                System copy
              </a>
            )}
            {mom.state === 'SIGNED' && caps.includes('record_minutes') && (
              <button
                className="btn-ghost"
                type="button"
                disabled={opening}
                onClick={() => void openCorrigendum()}
              >
                {opening ? 'Opening…' : 'Issue a corrigendum'}
              </button>
            )}
          </div>

          {corrigendumError && (
            <div className="mt-3">
              <Notice tone="red">{corrigendumError}</Notice>
            </div>
          )}

          {mom.state === 'SIGNED' && caps.includes('record_minutes') && (
            <p className="mb-0 mt-3 text-[11.5px] text-muted">
              This version has been circulated, so it cannot be changed. A corrigendum opens
              version {mom.version + 1} as a draft, unlocks the minutes and re-merges every
              annexure on file — this one stays exactly as people received it.
            </p>
          )}
          <MomPreview
            meetingId={meeting.id}
            label={`The document · version ${mom.version}`}
            signedFileId={mom.signedFileId}
          />

          {mom.signedFileId && (
            <p className="mb-0 mt-3 text-[11.5px] text-muted">
              This MoM was signed on paper and the signed document filed, so that document is
              what circulated and what <b>PDF with annexures</b> is built from. <b>System copy</b>
              {' '}opens the version this system generated — the one the approver approved.
            </p>
          )}

          <p className="mb-0 mt-3 text-[11.5px] text-muted">
            The document opens print-ready at A4 with its watermark. Use your browser’s “Save as
            PDF” for a copy to send on.
          </p>
        </div>
      </Card>
    </div>
  );
}
