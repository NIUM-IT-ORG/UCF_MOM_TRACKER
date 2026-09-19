'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ACTION_STATUS_LABEL,
  CLARIFICATION_STATUS_LABEL,
  type ActionStatus,
  type ClarificationStatus,
  type MeetingStage,
  type MeetingType,
  type ProjectStatus,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import {
  Card,
  Empty,
  Notice,
  PageHead,
  ProjectTag,
  StageChip,
  StatusChip,
  TableWrap,
} from '@/components/ui';
import { Donut } from '@/components/Donut';

/**
 * The dashboard.
 *
 * The order is the brief's order: how much was conducted, then what came out
 * of it, then what is still open, then what is waiting on the officer reading
 * it. Every figure is scoped — sign in as a ULB officer and the same page
 * shows one project's numbers.
 *
 * The one thing worth saying out loud, and the page says it: a figure counts
 * only **live** items, meaning those carried by a MoM that has been
 * circulated. An action raised while minuting exists, but nobody has been told
 * about it and no clock is running, so counting it would flatter the numbers
 * in both directions at once.
 */
interface Summary {
  meetings: {
    conducted: number;
    instant: number;
    scheduled: number;
    ahead: number;
    inPipeline: number;
    cancelled: number;
  };
  actions: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    delayed: number;
    underReview: number;
    overdue: number;
    byStatus: Record<ActionStatus, number>;
  };
  clarifications: {
    total: number;
    closed: number;
    pending: number;
    open: number;
    responded: number;
    byStatus: Record<ClarificationStatus, number>;
  };
  projects: {
    id: string;
    code: string;
    name: string;
    status: ProjectStatus;
    actionsOpen: number;
    actionsOverdue: number;
    clarificationsOpen: number;
  }[];
  upcoming: {
    id: string;
    code: string;
    title: string;
    meetingDate: string;
    startTime: string;
    type: MeetingType;
    stage: MeetingStage;
  }[];
  attention: { tone: string; text: string; href: string; action: string }[];
}

/*
 * The status colours, and the order the ring draws them in.
 *
 * Both were chosen by running the palette through a colour-blindness check
 * rather than by eye, and the *order* is part of the result: blue → red →
 * amber → green clears the separation test on every touching pair, and the
 * same four hues in their natural status order does not. Reordering these
 * arrays is a change to the chart, not to a list.
 *
 * A fifth status means re-checking the palette, not appending a colour.
 */
const ACTION_TONES: Record<ActionStatus, string> = {
  IN_PROGRESS: '#2a78d6',
  DELAYED: '#d03b3b',
  UNDER_REVIEW: '#eda100',
  COMPLETED: '#008300',
};
const ACTION_RING: ActionStatus[] = ['IN_PROGRESS', 'DELAYED', 'UNDER_REVIEW', 'COMPLETED'];

const CLARIFICATION_TONES: Record<ClarificationStatus, string> = {
  OPEN: '#eda100',
  RESPONDED: '#2a78d6',
  CLOSED: '#008300',
};
const CLARIFICATION_RING: ClarificationStatus[] = ['OPEN', 'RESPONDED', 'CLOSED'];

export default function Dashboard() {
  const { user } = useSession();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Summary>('/dashboard')
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.display : 'Could not load the dashboard.'),
      );
  }, []);

  const seesAll = Boolean(user?.seesAllProjects || user?.caps.includes('view_all_projects'));

  return (
    <>
      <PageHead
        eyebrow={seesAll ? 'Head-office view' : 'Your projects'}
        title={user ? `Good day, ${user.name}` : 'Dashboard'}
        lede={
          seesAll
            ? 'Every project under the Urban Challenge Fund — meetings held, what came out of them, and what is still open.'
            : 'The projects you are mapped to. Head-office designations see all of them.'
        }
      />

      {error && <Notice tone="red">{error}</Notice>}

      {!data ? (
        <Card>
          <Empty>Loading the figures…</Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Hero
              value={data.meetings.conducted}
              label="Meetings conducted"
              note={`${data.meetings.scheduled} scheduled · ${data.meetings.instant} instant · ${data.meetings.inPipeline} in the pipeline`}
              tone="lead"
              href="/meetings"
            />
            <Hero
              value={data.actions.pending}
              label="Open action items"
              note={
                data.actions.underReview > 0
                  ? `${data.actions.underReview} awaiting confirmation`
                  : `${data.actions.total} raised · ${data.actions.completed} completed`
              }
              href="/register?type=ACTION"
            />
            <Hero
              value={data.actions.overdue}
              label="Actions past their date"
              note={
                data.actions.overdue > 0
                  ? `of ${data.actions.pending} still open`
                  : 'nothing is overdue'
              }
              tone={data.actions.overdue > 0 ? 'red' : undefined}
              href="/register?type=ACTION&status=DELAYED"
            />
            <Hero
              value={data.clarifications.pending}
              label="Clarifications not yet closed"
              note={
                data.clarifications.open > 0
                  ? `${data.clarifications.open} still unanswered`
                  : `${data.clarifications.total} raised · ${data.clarifications.closed} closed`
              }
              tone={data.clarifications.pending > 0 ? 'amber' : undefined}
              href="/register?type=CLARIFICATION"
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card
              title="Actions by status"
              tag={`${data.actions.total} live · click a slice to filter the register`}
            >
              <div className="px-[17px] py-4">
                <Donut
                  total={data.actions.total}
                  totalLabel="Actions"
                  slices={ACTION_RING.map((s) => ({
                    key: s,
                    label: ACTION_STATUS_LABEL[s],
                    value: data.actions.byStatus[s] ?? 0,
                    colour: ACTION_TONES[s],
                    href: `/register?type=ACTION&status=${s}`,
                  }))}
                  empty="No action is live yet. They go live when the MoM that carries them is circulated."
                />
              </div>
              {data.actions.total > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-line px-[17px] py-3">
                  {ACTION_RING.map((s) => (
                    <Link key={s} className="btn-ghost" href={`/register?type=ACTION&status=${s}`}>
                      {ACTION_STATUS_LABEL[s]} →
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Clarifications by status"
              tag={`${data.clarifications.total} live · Open → Responded → Closed`}
            >
              <div className="px-[17px] py-4">
                <Donut
                  total={data.clarifications.total}
                  totalLabel="Clarifications"
                  slices={CLARIFICATION_RING.map((s) => ({
                    key: s,
                    label: CLARIFICATION_STATUS_LABEL[s],
                    value: data.clarifications.byStatus[s] ?? 0,
                    colour: CLARIFICATION_TONES[s],
                    href: `/register?type=CLARIFICATION&status=${s}`,
                  }))}
                  empty="Nothing has been raised as a clarification yet."
                />
              </div>
              {data.clarifications.total > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-line px-[17px] py-3">
                  {CLARIFICATION_RING.map((s) => (
                    <Link
                      key={s}
                      className="btn-ghost"
                      href={`/register?type=CLARIFICATION&status=${s}`}
                    >
                      {CLARIFICATION_STATUS_LABEL[s]} →
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Needs your attention" tag="Changes with your designation">
              <div className="grid gap-2 px-[17px] py-4">
                {data.attention.length === 0 ? (
                  <Notice tone="green">
                    Nothing is pending with you right now. The calendar, the register and the
                    project master are in the sidebar.
                  </Notice>
                ) : (
                  data.attention.map((a, n) => (
                    <div
                      key={n}
                      className={`flex flex-wrap items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-[12.5px] ${
                        a.tone === 'red'
                          ? 'border-[#F2C9C4] bg-[#FDECEC] text-[#8A2018]'
                          : a.tone === 'amber'
                            ? 'border-[#F0DDB4] bg-[#FFF8EA] text-[#7A5210]'
                            : a.tone === 'violet'
                              ? 'border-[#DCD2F0] bg-[#F5F1FE] text-[#4B3388]'
                              : 'border-line bg-[#F9FBFD] text-ink'
                      }`}
                    >
                      <span className="flex-1">{a.text}</span>
                      <Link className="btn-ghost" href={a.href}>
                        {a.action}
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card title="Coming up" tag={`${data.upcoming.length}`}>
              {data.upcoming.length === 0 ? (
                <Empty>Nothing is scheduled ahead of today.</Empty>
              ) : (
                <div className="px-[17px] py-2">
                  {data.upcoming.map((m) => (
                    <Link
                      key={m.id}
                      href={`/meetings/${m.id}`}
                      className="flex items-center gap-3 border-b border-line py-2.5 text-navy last:border-0"
                    >
                      <div className="min-w-[46px] text-center">
                        <div className="text-[16px] font-extrabold leading-none">
                          {Number(m.meetingDate.slice(8, 10))}
                        </div>
                        <div className="text-[9.5px] font-bold uppercase tracking-[1px] text-muted">
                          {formatDate(m.meetingDate).split(' ')[1]}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-[12.5px]">{m.title}</b>
                        <small className="text-[11px] text-muted">
                          {m.startTime} · {m.code}
                        </small>
                      </div>
                      <StageChip stage={m.stage} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4">
            <Card title="By project" tag="Live items only">
              {data.projects.length === 0 ? (
                <Empty>You are not mapped to any project yet.</Empty>
              ) : (
                <TableWrap>
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Actions open</th>
                        <th>Of those, overdue</th>
                        <th>Clarifications open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="flex items-center gap-2">
                              <ProjectTag code={p.code} />
                              <Link href={`/projects/${p.id}`} className="font-semibold text-navy">
                                {p.name}
                              </Link>
                            </div>
                          </td>
                          <td>
                            <StatusChip status={p.status} />
                          </td>
                          <td className="tabular-nums">{p.actionsOpen}</td>
                          <td
                            className={`tabular-nums ${
                              p.actionsOverdue > 0 ? 'font-bold text-danger' : ''
                            }`}
                          >
                            {p.actionsOverdue}
                          </td>
                          <td className="tabular-nums">{p.clarificationsOpen}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          </div>

          <p className="mt-3 text-[11.5px] text-muted">
            Every figure counts only <b>live</b> items — those carried by a MoM that has been
            circulated. What your designation lets you do, and which projects it reaches, is on{' '}
            <Link href="/capabilities">Capabilities</Link>.
          </p>
        </>
      )}
    </>
  );
}

/**
 * One headline figure.
 *
 * A number this size is the chart — there is nothing to plot in "3 meetings
 * conducted", and a one-bar bar chart would say less.
 *
 * The tint is the point of the row: the lead tile is filled so the eye starts
 * there, and the two exception tiles turn red and amber only when they have
 * something to report. A row of four identical white cards makes the officer
 * read all four to find out whether anything is wrong.
 */
function Hero({
  value,
  label,
  note,
  tone,
  href,
}: {
  value: number;
  label: string;
  note: string;
  tone?: 'lead' | 'red' | 'amber';
  href: string;
}) {
  const shell =
    tone === 'lead'
      ? 'border-navy bg-navy'
      : tone === 'red'
        ? 'border-[#F2C9C4] bg-[#FDF3F1]'
        : tone === 'amber'
          ? 'border-[#F0DDB4] bg-[#FFFAF0]'
          : 'border-line bg-white';
  const figure =
    tone === 'lead'
      ? 'text-white'
      : tone === 'red'
        ? 'text-danger'
        : tone === 'amber'
          ? 'text-[#A66A12]'
          : 'text-navy';
  const caption = tone === 'lead' ? 'text-[#C9D6E6]' : 'text-muted';
  const rule = tone === 'lead' ? 'border-[#3C5B82]' : 'border-line';

  return (
    <Link
      href={href}
      className={`rounded-[12px] border px-4 pb-3.5 pt-4 transition-shadow hover:shadow-[0_6px_20px_rgba(29,53,87,.12)] ${shell}`}
    >
      <div className={`text-[36px] font-extrabold leading-none tabular-nums ${figure}`}>
        {value}
      </div>
      <div className={`mt-2 text-[11px] font-bold uppercase tracking-[1.2px] ${caption}`}>
        {label}
      </div>
      <div className={`mt-2.5 border-t pt-2 text-[11.5px] ${rule} ${caption}`}>{note}</div>
    </Link>
  );
}
