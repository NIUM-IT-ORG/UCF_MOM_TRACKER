'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  MEETING_CATEGORY_LABEL,
  MEETING_TYPE_LABEL,
  type MeetingCategory,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useProjectOptions } from '@/lib/projects';
import { formatDate } from '@/lib/format';
import { timeRange, type MeetingRow } from '@/lib/meetings';
import {
  Card,
  Empty,
  PageHead,
  ProjectTag,
  StageChip,
  TableWrap,
} from '@/components/ui';

/** The four groupings a coordinator actually works in. */
const VIEWS = [
  { key: 'all', label: 'All', stages: '' },
  { key: 'planning', label: 'Planning', stages: 'PLANNED,AGENDA,INVITEES,INVITEE_INPUTS,COMPOSED' },
  { key: 'upcoming', label: 'Confirmed & live', stages: 'CONFIRMED,LIVE' },
  { key: 'held', label: 'Held', stages: 'HELD,MINUTED' },
  { key: 'closed', label: 'Closed', stages: 'CLOSED,CANCELLED' },
] as const;

export default function MeetingsPage() {
  const { caps } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const { projects, loading: projectsLoading } = useProjectOptions();

  /*
   * Filters live in the URL.
   *
   * They used to be component state, so opening a meeting and pressing back
   * dropped everything you had narrowed to — which on a list that grows by a
   * meeting a week is the difference between a filter being used and being
   * worked around. In the address bar they survive the back button and a
   * reload, and a filtered list can be sent to somebody.
   */
  const [view, setView] = useState<string>(() => params.get('view') ?? 'all');
  const [type, setType] = useState(() => params.get('type') ?? '');
  const [category, setCategory] = useState(() => params.get('category') ?? '');
  const [projectId, setProjectId] = useState(() => params.get('projectId') ?? '');
  const [from, setFrom] = useState(() => params.get('from') ?? '');
  const [to, setTo] = useState(() => params.get('to') ?? '');
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [rows, setRows] = useState<MeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stages = VIEWS.find((v) => v.key === view)?.stages ?? '';

  const load = useCallback(async () => {
    // Named `search`, not `params`: `params` is the page's own URL above.
    const search = new URLSearchParams();
    if (stages) search.set('stage', stages);
    if (type) search.set('type', type);
    if (category) search.set('category', category);
    if (projectId) search.set('projectId', projectId);
    if (from) search.set('from', from);
    if (to) search.set('to', to);
    if (q.trim()) search.set('q', q.trim());
    try {
      setRows(await api<MeetingRow[]>(`/meetings?${search.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not load meetings.');
    }
  }, [stages, type, category, projectId, from, to, q]);

  useEffect(() => {
    // Typing in the search box should not fire a request per keystroke.
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const counts = useMemo(() => {
    if (!rows) return null;
    return {
      total: rows.length,
      instant: rows.filter((r) => r.type === 'INSTANT').length,
    };
  }, [rows]);

  /*
   * The view tabs are not counted: one of them is always chosen, and "All"
   * is not a filter. Counting it would mean the Clear button never went away.
   */
  const activeFilters = [type, category, projectId, from, to, q.trim()].filter(Boolean).length;

  function clearFilters() {
    setType('');
    setCategory('');
    setProjectId('');
    setFrom('');
    setTo('');
    setQ('');
  }

  /*
   * Mirror the filters into the address bar, replacing rather than pushing:
   * every keystroke would otherwise be a history entry, and the back button
   * would walk letter by letter out of a search instead of leaving the page.
   */
  useEffect(() => {
    const next = new URLSearchParams();
    if (view !== 'all') next.set('view', view);
    if (type) next.set('type', type);
    if (category) next.set('category', category);
    if (projectId) next.set('projectId', projectId);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (q.trim()) next.set('q', q.trim());
    const qs = next.toString();
    router.replace(qs ? `/meetings?${qs}` : '/meetings', { scroll: false });
  }, [router, view, type, category, projectId, from, to, q]);

  /**
   * The export carries the filters in force, so what you see is what you get.
   *
   * It is a plain link rather than a fetch: the browser handles the download,
   * the Content-Disposition names the file, and a PDF opens in the viewer —
   * none of which is worth reimplementing with blobs.
   */
  function exportHref(format: 'csv' | 'pdf'): string {
    const out = new URLSearchParams({ format });
    if (stages) out.set('stage', stages);
    if (type) out.set('type', type);
    if (category) out.set('category', category);
    if (projectId) out.set('projectId', projectId);
    if (from) out.set('from', from);
    if (to) out.set('to', to);
    if (q.trim()) out.set('q', q.trim());
    return `/api/v1/meetings/export?${out.toString()}`;
  }

  const canPlan = caps.includes('plan_scheduled') || caps.includes('plan_instant');

  return (
    <>
      <PageHead
        eyebrow="Meetings"
        title="Meetings"
        lede="Both journeys in one list — a scheduled review planned in four steps, and an instant meeting composed and launched in one."
        actions={
          canPlan ? (
            <Link className="btn-primary" href="/meetings/new">
              New meeting
            </Link>
          ) : null
        }
      />

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            aria-pressed={view === v.key}
            className={`rounded-[9px] border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              view === v.key
                ? 'border-navy bg-navy text-white'
                : 'border-line bg-white text-navy hover:border-steel'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="grid gap-2.5 px-[17px] py-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="i"
            placeholder="Search title, reference or venue"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search meetings"
          />
          <select className="i" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">Any type</option>
            <option value="SCHEDULED">{MEETING_TYPE_LABEL.SCHEDULED}</option>
            <option value="INSTANT">{MEETING_TYPE_LABEL.INSTANT}</option>
          </select>
          <select
            className="i"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
          >
            <option value="">Any category</option>
            {(Object.keys(MEETING_CATEGORY_LABEL) as MeetingCategory[]).map((c) => (
              <option key={c} value={c}>
                {MEETING_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <select
            className="i"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Project"
          >
            <option value="">{projectsLoading ? 'Loading projects…' : 'Every project'}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>

        {/*
          * The API has taken `from`/`to` since Phase 3 and nothing offered
          * them, so "what did we hold last quarter" meant scrolling. Dates
          * are their own row because they are a pair — half a range is a
          * common way to get a confusing result, so each says which end it
          * is.
          */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-[17px] py-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            From
            <input
              type="date"
              className="i w-auto"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            To
            <input
              type="date"
              className="i w-auto"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          <span className="ml-auto flex items-center gap-2.5">
            {rows && (
              <span className="text-[12px] text-muted">
                {rows.length} meeting{rows.length === 1 ? '' : 's'}
                {activeFilters > 0 &&
                  ` · ${activeFilters} filter${activeFilters === 1 ? '' : 's'}`}
              </span>
            )}
            {/*
              * Only when something is set. A Clear that is always there gets
              * read as "nothing is filtered", which is the opposite of what
              * it means.
              */}
            {activeFilters > 0 && (
              <button type="button" className="btn-ghost" onClick={clearFilters}>
                Clear
              </button>
            )}
            {/*
              * Downloads what is on screen, filters and all. CSV opens in
              * Excel — it carries a byte-order mark so Windows reads it as
              * UTF-8 rather than the ANSI codepage.
              */}
            <a className="btn-ghost" href={exportHref('csv')}>
              CSV
            </a>
            <a className="btn-ghost" href={exportHref('pdf')} target="_blank" rel="noreferrer">
              PDF
            </a>
          </span>
        </div>
      </Card>

      <div className="mt-4">
        <Card
          title="Meetings"
          tag={
            counts
              ? `${counts.total} shown${counts.instant > 0 ? ` · ${counts.instant} instant` : ''}`
              : undefined
          }
        >
          {!rows ? (
            <Empty>Loading…</Empty>
          ) : rows.length === 0 ? (
            <Empty>
              No meetings match that. {canPlan ? 'Start one with “New meeting”.' : ''}
            </Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Meeting</th>
                    <th>Date</th>
                    <th>Projects</th>
                    <th>Stage</th>
                    {/*
                      * Three counts, already on the list response — no extra
                      * query. Abbreviated headers with the full wording on
                      * hover: spelled out they are wider than the numbers
                      * under them, and this table is read by scanning down a
                      * column rather than across a row.
                      */}
                    <th className="text-right" title="Agenda points">
                      Agenda
                    </th>
                    <th className="text-right" title="Invitees">
                      Invited
                    </th>
                    <th className="text-right" title="Actions &amp; clarifications arising">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/meetings/${m.id}`} className="font-mono text-[11.5px] font-semibold">
                          {m.code}
                        </Link>
                        {m.type === 'INSTANT' && (
                          <small className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-accent">
                            Instant
                          </small>
                        )}
                      </td>
                      <td>
                        <Link href={`/meetings/${m.id}`} className="block text-[12.5px] font-bold text-navy hover:text-blue">
                          {m.title}
                        </Link>
                        <small className="text-[11px] text-muted">
                          {MEETING_CATEGORY_LABEL[m.category]} · {m.venue}
                        </small>
                      </td>
                      <td className="whitespace-nowrap">
                        {formatDate(m.meetingDate)}
                        <small className="mt-0.5 block text-[11px] text-muted">{timeRange(m)}</small>
                      </td>
                      <td>
                        {/*
                          * The full name, not the code. A reader who does not
                          * already know that EAP02 is the Eastern Area
                          * Programme learns nothing from the chip, and this is
                          * the list people are sent. The code stays on the
                          * tag's colour, which is what makes a row scannable
                          * once you do know them.
                          */}
                        <span className="flex flex-wrap items-center gap-1.5">
                          {m.projects.map((p) => (
                            <span key={p.project.id} className="flex items-center gap-1">
                              <ProjectTag code={p.project.code} />
                              <span className="text-[11.5px] text-ink">{p.project.name}</span>
                            </span>
                          ))}
                        </span>
                      </td>
                      <td>
                        <StageChip stage={m.stage} />
                      </td>
                      <td className="text-right tabular-nums">{m._count.agenda}</td>
                      <td className="text-right tabular-nums">{m._count.invitees}</td>
                      {/*
                        * A dash, not a nought. A meeting that produced nothing
                        * and one that produced nothing *yet* look identical as
                        * "0", and the eye stops on a dash in a column of
                        * figures — which is the point of having the column.
                        */}
                      <td className="text-right tabular-nums">
                        {m._count.items > 0 ? (
                          <b className="text-navy">{m._count.items}</b>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
