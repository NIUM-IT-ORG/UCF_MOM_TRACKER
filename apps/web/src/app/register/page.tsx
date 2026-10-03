'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ACTION_STATUS_LABEL,
  ACTION_STATUS_OPEN_FILTER,
  ACTION_STATUS_ORDER,
  CLARIFICATION_STATUS_LABEL,
  CLARIFICATION_STATUS_ORDER,
  CLARIFICATION_STATUS_UNCLOSED_FILTER,
  PRIORITY_LABEL,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { ItemRow } from '@/lib/meetings';
import {
  Avatar,
  Card,
  Empty,
  ItemStatusChip,
  Notice,
  PageHead,
  ProjectTag,
  TableWrap,
} from '@/components/ui';
import { ItemDrawer } from '@/components/ItemDrawer';
import { ageing } from './ageing';

/**
 * Everything raised in any meeting, in one list.
 *
 * Two vocabularies in one register, on purpose: an action runs In Progress →
 * Under Review → Completed, a clarification runs Open → Responded → Closed.
 * They sit together because a clarification is tracked work too, and a second
 * backlog somewhere else is exactly how one quietly dies.
 *
 * The filtering is done by the server — every filter here is a query parameter
 * the API already applies inside the project scope, so this screen cannot show
 * a row the officer is not entitled to see, whatever it asks for.
 */
/*
 * From shared, not declared here.
 *
 * Both this screen and the dashboard kept their own copy of these lists -
 * identical, and free to drift the moment a status is added to one of them.
 * The shared constant is documented as "the order the donut and the register
 * filters use", which was true of neither.
 */
const ACTION_STATUSES = ACTION_STATUS_ORDER;
const CLARIFICATION_STATUSES = CLARIFICATION_STATUS_ORDER;

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

/**
 * The register is linked to, not only navigated to.
 *
 * Every figure on the dashboard is a link into this screen - "9 actions past
 * their date", a donut slice, "Delayed →" - and none of them worked, because
 * this page built its filters from empty state and never read the query
 * string. Clicking a card that said 9 produced the whole register, so the
 * dashboard and the list it points at disagreed on every number.
 *
 * `useSearchParams` needs a Suspense boundary, which is what the wrapper is
 * for.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <Register />
    </Suspense>
  );
}

function Register() {
  const { user } = useSession();
  const params = useSearchParams();
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * "Needs your attention" on the dashboard links to `/register?item=<id>`
   * to open one item's drawer. That was read by nothing, so every one of
   * those rows dropped the officer into the unfiltered register and left
   * them to find the item themselves.
   */
  const [openItem, setOpenItem] = useState<string | null>(() => params.get('item'));

  /*
   * Opened from the URL, then owned by this screen.
   *
   * Lazy initialisers, so what arrives in the link seeds the filters once and
   * the officer's own changes are never overwritten by a later render.
   */
  const [type, setType] = useState(() => params.get('type') ?? '');
  const [status, setStatus] = useState(() => params.get('status') ?? '');
  const [projectId, setProjectId] = useState(() => params.get('projectId') ?? '');
  const [q, setQ] = useState(() => params.get('q') ?? '');
  /*
   * Who is responsible, as a filter.
   *
   * The server has taken `ownerId` since Phase 4 — "Only mine" was that
   * filter pinned to the signed-in officer — so this is the same query
   * opened up to anybody. "Who still owes me something" is the question a
   * coordinator arrives at this register with, and it could only be answered
   * about oneself.
   */
  const [ownerId, setOwnerId] = useState(() => params.get('ownerId') ?? '');
  const [people, setPeople] = useState<{ id: string; name: string; designation: { name: string } }[]>([]);
  const [raisedById, setRaisedById] = useState(() => params.get('raisedById') ?? '');
  const [mine, setMine] = useState(() => params.get('mine') === 'true');
  const [overdue, setOverdue] = useState(() => params.get('overdue') === 'true');
  /*
   * Live only - the set the dashboard counts.
   *
   * It is a control and not a hidden default on purpose. The register's job
   * is to show everything raised, including what is still sitting in an
   * uncirculated MoM; the dashboard's job is to count what people have
   * actually been told about. Arriving here from a dashboard figure turns
   * this on, and the officer can see that is what happened and switch it off.
   */
  const [live, setLive] = useState(() => params.get('live') === 'true');

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    if (projectId) p.set('projectId', projectId);
    if (q.trim()) p.set('q', q.trim());
    if (overdue) p.set('overdue', 'true');
    if (live) p.set('live', 'true');
    // An explicit choice wins over the shortcut: picking somebody else while
    // "Only mine" is still pressed otherwise silently returns your own items.
    if (ownerId) p.set('ownerId', ownerId);
    else if (mine && user) p.set('ownerId', user.id);
    if (raisedById) p.set('raisedById', raisedById);
    return p.toString();
  }, [type, status, projectId, q, overdue, live, mine, ownerId, raisedById, user]);

  /*
   * Keep the address bar on the filters, so a filtered register can be sent
   * to somebody and the back button returns to what you were looking at.
   *
   * Written from the raw state rather than from `query`: "Only mine" is a
   * shortcut, and resolving it into the signed-in officer's id would put that
   * id in a link they then paste to a colleague, where it would silently
   * filter to the wrong person.
   */
  useEffect(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    if (projectId) p.set('projectId', projectId);
    if (q.trim()) p.set('q', q.trim());
    if (overdue) p.set('overdue', 'true');
    if (live) p.set('live', 'true');
    if (ownerId) p.set('ownerId', ownerId);
    else if (mine) p.set('mine', 'true');
    if (raisedById) p.set('raisedById', raisedById);
    const search = p.toString();
    window.history.replaceState(null, '', search ? `/register?${search}` : '/register');
  }, [type, status, projectId, q, overdue, live, mine, ownerId, raisedById]);

  const load = useCallback(() => {
    api<ItemRow[]>(`/items${query ? `?${query}` : ''}`)
      .then((rows) => {
        setItems(rows);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.display : 'Could not load the register.'),
      );
  }, [query]);

  useEffect(() => {
    // Typing in the search box should not fire a request per keystroke.
    const t = setTimeout(load, 180);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api<{ id: string; name: string; designation: { name: string } }[]>('/users')
      .then(setPeople)
      .catch(() => setPeople([]));
    api<ProjectOption[]>('/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const actions = (items ?? []).filter((i) => i.type === 'ACTION');
  const clarifications = (items ?? []).filter((i) => i.type === 'CLARIFICATION');

  /**
   * Export whatever is filtered, from the server.
   *
   * This was a second CSV builder living in this page, with its own quoting,
   * its own BOM and its own column list — a column added to one and not the
   * other was only a matter of time. The rows now come from the same `list`
   * the screen calls, rendered by the same `toCsv`/`toHtml` the reports use,
   * which is also what makes a PDF possible at all.
   *
   * Plain links: the browser handles the download, the Content-Disposition
   * names the file, and a PDF opens in the viewer.
   */
  function exportHref(format: 'csv' | 'pdf'): string {
    return `/api/v1/items/export?${query ? `${query}&` : ''}format=${format}`;
  }

  return (
    <>
      <PageHead
        eyebrow="Tracking"
        title="Action & clarification register"
        lede="Everything raised in any meeting, in one list. Actions run In Progress → Under Review → Completed; clarifications run Open → Responded → Closed."
        actions={
          <>
            <a className="btn-ghost" href={exportHref('csv')}>
              Export CSV
            </a>
            <a
              className="btn-ghost"
              href={exportHref('pdf')}
              target="_blank"
              rel="noreferrer"
            >
              Export PDF
            </a>
          </>
        }
      />

      {error && <Notice tone="red">{error}</Notice>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi value={actions.length} label="Actions in view" />
        <Kpi
          value={actions.filter((a) => a.actionStatus === 'IN_PROGRESS').length}
          label="In progress"
        />
        <Kpi
          value={actions.filter((a) => a.actionStatus === 'DELAYED').length}
          label="Delayed"
          tone="red"
        />
        <Kpi
          value={clarifications.filter((c) => c.clarificationStatus !== 'CLOSED').length}
          label="Clarifications still open"
          tone="amber"
        />
      </div>

      <Card title="Filters" tag="Applied by the server, inside your project scope">
        <div className="grid gap-3 px-[17px] py-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">Type</span>
            <select className="i" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Actions and clarifications</option>
              <option value="ACTION">Actions only</option>
              <option value="CLARIFICATION">Clarifications only</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">Status</span>
            <select className="i" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <optgroup label="Actions">
                {/*
                  The combined set first, because it is the one the dashboard
                  counts as "open action items". Without an option carrying
                  this value, arriving from that card left the control reading
                  "Any status" above a list filtered to three of them - the
                  screen contradicting itself about what it was showing.
                */}
                <option value={ACTION_STATUS_OPEN_FILTER}>Open — not yet completed</option>
                {ACTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ACTION_STATUS_LABEL[s]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Clarifications">
                <option value={CLARIFICATION_STATUS_UNCLOSED_FILTER}>Not yet closed</option>
                {CLARIFICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CLARIFICATION_STATUS_LABEL[s]}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">Project</span>
            <select className="i" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All my projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">Responsible</span>
            <select
              className="i"
              value={ownerId}
              onChange={(e) => {
                setOwnerId(e.target.value);
                // The shortcut and the picker are the same filter, so leaving
                // "Only mine" lit while somebody else is chosen would be a lie.
                if (e.target.value) setMine(false);
              }}
            >
              <option value="">Anybody</option>
              {people.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.designation.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">Raised by</span>
            <select
              className="i"
              value={raisedById}
              onChange={(e) => setRaisedById(e.target.value)}
            >
              <option value="">Anybody</option>
              {people.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.designation.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">Search</span>
            <input
              className="i"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Reference or text…"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              aria-pressed={mine}
              className={mine ? 'btn-primary' : 'btn-ghost'}
              onClick={() => {
                // Clears the picker, for the same reason the picker clears
                // this: one filter, one answer on screen.
                setMine((v) => !v);
                setOwnerId('');
              }}
            >
              Only mine
            </button>
            <button
              type="button"
              aria-pressed={overdue}
              className={overdue ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setOverdue((v) => !v)}
            >
              Overdue
            </button>
            <button
              type="button"
              aria-pressed={live}
              className={live ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setLive((v) => !v)}
              title="Only items a circulated MoM has made live — what the dashboard counts"
            >
              Live only
            </button>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Card title="The register" tag={items ? `${items.length} shown` : 'Loading…'}>
          {!items ? (
            <Empty>Loading…</Empty>
          ) : items.length === 0 ? (
            <Empty>
              Nothing matches these filters. Items appear here once the MoM that carries them has
              been circulated — before that they exist, but they are not live.
            </Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Description</th>
                    <th>Responsible / responded</th>
                    <th>Due</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Ageing</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      className="cursor-pointer"
                      onClick={() => setOpenItem(i.id)}
                      aria-label={`Open ${i.ref}`}
                    >
                      <td className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-navy">
                        {i.ref}
                      </td>
                      <td>
                        <b className="text-navy">{i.description}</b>
                        <small className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          <ProjectTag code={i.project.code} /> from {i.meeting.code}
                          {!i.isActive && (
                            <span className="rounded-md bg-[#FFF2E0] px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#A66A12]">
                              not yet live
                            </span>
                          )}
                        </small>
                      </td>
                      <td>
                        {i.type === 'ACTION' ? (
                          i.owners.length === 0 ? (
                            <span className="text-muted">nobody named</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {i.owners.map((o) => (
                                <span key={o.user.id} className="flex items-center gap-1.5">
                                  <Avatar initials={o.user.initials} size={22} />
                                  <small className="text-[11.5px] text-ink">{o.user.name}</small>
                                </span>
                              ))}
                            </span>
                          )
                        ) : i.respondedBy ? (
                          <span className="flex items-center gap-1.5">
                            <Avatar initials={i.respondedBy.initials} size={22} />
                            <small className="text-[11.5px] text-ink">{i.respondedBy.name}</small>
                          </span>
                        ) : (
                          <span className="text-muted">unanswered</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {i.type === 'ACTION' ? formatDate(i.dueDate) : <span className="text-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {i.priority ? PRIORITY_LABEL[i.priority] : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <ItemStatusChip
                          type={i.type}
                          status={(i.actionStatus ?? i.clarificationStatus) as never}
                          isActive={i.isActive}
                        />
                      </td>
                      <td className="whitespace-nowrap text-[11.5px] text-muted">{ageing(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <p className="mt-3 text-[11.5px] text-muted">
        An action awaiting confirmation past its date is overdue on the confirmer, not on the work
        — it is marked as such rather than called delayed. Nothing here is live until the MoM
        carrying it has been circulated; see the{' '}
        <Link href="/mom">MoM register</Link>.
      </p>

      {openItem && (
        <ItemDrawer
          itemId={openItem}
          onClose={() => setOpenItem(null)}
          onChanged={() => load()}
        />
      )}
    </>
  );
}


function Kpi({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'red' | 'amber';
}) {
  const colour =
    tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-[#A66A12]' : 'text-navy';
  return (
    <div className="rounded-[12px] border border-line bg-white px-4 py-3">
      <div className={`text-[26px] font-extrabold leading-none tabular-nums ${colour}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[1.1px] text-muted">
        {label}
      </div>
    </div>
  );
}
