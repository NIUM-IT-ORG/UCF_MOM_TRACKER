'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MEETING_CATEGORY_LABEL } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { timeRange, type MeetingRow } from '@/lib/meetings';
import { Card, Empty, Notice, PageHead, ProjectTag, StageChip } from '@/components/ui';

/**
 * The meeting calendar — a month at a time, Monday first.
 *
 * Scoped like everything else: it draws the meetings the API returns, which
 * are already the ones this officer may see. A meeting that is not in scope is
 * not a blank square; it is simply not a meeting, as far as this screen knows.
 *
 * Dates are handled as the plain ISO day the meeting carries, never as a
 * timestamp converted to local time. A meeting on the 1st at 09:00 IST becomes
 * the previous day in UTC, and a calendar that shifts a review into last month
 * is worse than no calendar.
 */
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const isoDay = (value: string) => value.slice(0, 10);

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const router = useRouter();
  const today = todayIso();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MeetingRow[]>('/meetings')
      .then(setMeetings)
      .catch((err) =>
        setError(err instanceof ApiError ? err.display : 'Could not load the calendar.'),
      );
  }, []);

  const byDate = useMemo(() => {
    const map = new Map<string, MeetingRow[]>();
    for (const m of meetings ?? []) {
      const key = isoDay(m.meetingDate);
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [meetings]);

  const cells = useMemo(() => {
    const { year, month } = cursor;
    const first = new Date(year, month, 1);
    // Monday-first: JavaScript counts Sunday as 0, which puts the week in the
    // wrong place for every calendar anybody in the office has ever used.
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: { iso: string; day: number; outside: boolean }[] = [];

    const push = (y: number, m: number, d: number, outside: boolean) =>
      out.push({
        iso: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d,
        outside,
      });

    const prevDays = new Date(year, month, 0).getDate();
    for (let i = lead; i > 0; i--) {
      const m = month === 0 ? 11 : month - 1;
      push(month === 0 ? year - 1 : year, m, prevDays - i + 1, true);
    }
    for (let d = 1; d <= daysInMonth; d++) push(year, month, d, false);
    const tail = (7 - ((lead + daysInMonth) % 7)) % 7;
    for (let d = 1; d <= tail; d++) {
      const m = month === 11 ? 0 : month + 1;
      push(month === 11 ? year + 1 : year, m, d, true);
    }
    return out;
  }, [cursor]);

  const upcoming = (meetings ?? [])
    .filter((m) => isoDay(m.meetingDate) >= today && m.stage !== 'CANCELLED')
    .sort((a, b) => isoDay(a.meetingDate).localeCompare(isoDay(b.meetingDate)))
    .slice(0, 5);
  const recent = (meetings ?? [])
    .filter((m) => isoDay(m.meetingDate) < today)
    .sort((a, b) => isoDay(b.meetingDate).localeCompare(isoDay(a.meetingDate)))
    .slice(0, 5);

  const move = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      if (m < 0) return { year: c.year - 1, month: 11 };
      if (m > 11) return { year: c.year + 1, month: 0 };
      return { ...c, month: m };
    });

  const inThisMonth = (meetings ?? []).filter((m) => {
    const iso = isoDay(m.meetingDate);
    return (
      Number(iso.slice(0, 4)) === cursor.year && Number(iso.slice(5, 7)) - 1 === cursor.month
    );
  }).length;

  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="Meeting calendar"
        lede="Every meeting you can see, by the day it is held. Click one to open it."
      />

      {error && <Notice tone="red">{error}</Notice>}

      <Card
        title={`${MONTHS[cursor.month]} ${cursor.year}`}
        tag={`${inThisMonth} meeting${inThisMonth === 1 ? '' : 's'} this month · ${
          meetings?.length ?? 0
        } in scope`}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-[17px] py-2.5">
          <button className="btn-ghost" type="button" onClick={() => move(-1)} aria-label="Previous month">
            ← Previous
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={() =>
              setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })
            }
          >
            Today
          </button>
          <button className="btn-ghost" type="button" onClick={() => move(1)} aria-label="Next month">
            Next →
          </button>
        </div>

        <div className="px-[17px] py-4">
          {!meetings ? (
            <Empty>Loading…</Empty>
          ) : (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
              {DOW.map((d) => (
                <div
                  key={d}
                  className="bg-[#F4F7FB] px-2 py-1.5 text-center text-[10px] font-extrabold uppercase tracking-[1.1px] text-muted"
                >
                  {d}
                </div>
              ))}

              {cells.map((cell) => {
                const events = byDate.get(cell.iso) ?? [];
                return (
                  <div
                    key={cell.iso}
                    className={`min-h-[96px] bg-white px-1.5 py-1.5 ${
                      cell.outside ? 'opacity-45' : ''
                    } ${cell.iso === today ? 'ring-2 ring-inset ring-accent' : ''}`}
                  >
                    <div className="mb-1 text-[11px] font-bold tabular-nums text-muted">
                      {cell.day}
                    </div>
                    <div className="grid gap-1">
                      {events.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => router.push(`/meetings/${m.id}`)}
                          title={`${m.code} — ${m.title}`}
                          className={`block w-full truncate rounded-md px-1.5 py-1 text-left text-[10.5px] font-semibold ${
                            m.stage === 'CANCELLED'
                              ? 'bg-[#F4F4F5] text-muted line-through'
                              : m.type === 'INSTANT'
                                ? 'bg-[#FFF2E0] text-[#A66A12]'
                                : ['CLOSED', 'MINUTED'].includes(m.stage)
                                  ? 'bg-[#E7F4EC] text-[#1B7F44]'
                                  : 'bg-ice text-blue'
                          }`}
                        >
                          {m.startTime} {m.title}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <MiniList
          title="Coming up"
          empty="Nothing scheduled ahead of today."
          meetings={upcoming}
          onOpen={(id) => router.push(`/meetings/${id}`)}
        />
        <MiniList
          title="Recently held"
          empty="No meetings have been held yet."
          meetings={recent}
          onOpen={(id) => router.push(`/meetings/${id}`)}
        />
      </div>
    </>
  );
}

function MiniList({
  title,
  empty,
  meetings,
  onOpen,
}: {
  title: string;
  empty: string;
  meetings: MeetingRow[];
  onOpen: (id: string) => void;
}) {
  return (
    <Card title={title} tag={`${meetings.length}`}>
      {meetings.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="px-[17px] py-2">
          {meetings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.id)}
              className="flex w-full items-center gap-3 border-b border-line py-2.5 text-left last:border-0"
            >
              <div className="min-w-[42px] text-center">
                <div className="text-[17px] font-extrabold leading-none text-navy">
                  {Number(m.meetingDate.slice(8, 10))}
                </div>
                <div className="text-[9.5px] font-bold uppercase tracking-[1px] text-muted">
                  {(MONTHS[Number(m.meetingDate.slice(5, 7)) - 1] ?? '').slice(0, 3)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[12.5px] text-navy">{m.title}</b>
                <small className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  {timeRange(m)} · {MEETING_CATEGORY_LABEL[m.category] ?? m.category}
                  {m.projects.map((p) => (
                    <ProjectTag key={p.project.id} code={p.project.code} />
                  ))}
                </small>
              </div>
              <StageChip stage={m.stage} />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
