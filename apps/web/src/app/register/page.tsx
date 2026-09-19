'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ACTION_STATUS_LABEL,
  CLARIFICATION_STATUS_LABEL,
  PRIORITY_LABEL,
  type ActionStatus,
  type ClarificationStatus,
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
import { ItemDrawer } from './ItemDrawer';
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
const ACTION_STATUSES: ActionStatus[] = ['IN_PROGRESS', 'DELAYED', 'UNDER_REVIEW', 'COMPLETED'];
const CLARIFICATION_STATUSES: ClarificationStatus[] = ['OPEN', 'RESPONDED', 'CLOSED'];

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

export default function RegisterPage() {
  const { user } = useSession();
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    if (projectId) p.set('projectId', projectId);
    if (q.trim()) p.set('q', q.trim());
    if (overdue) p.set('overdue', 'true');
    if (mine && user) p.set('ownerId', user.id);
    return p.toString();
  }, [type, status, projectId, q, overdue, mine, user]);

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
    api<ProjectOption[]>('/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const actions = (items ?? []).filter((i) => i.type === 'ACTION');
  const clarifications = (items ?? []).filter((i) => i.type === 'CLARIFICATION');

  function exportCsv() {
    const rows = items ?? [];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Quote everything: a description with a comma in it is the common case,
      // and a spreadsheet that splits one row into two is worse than no export.
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [
      [
        'Ref',
        'Type',
        'Description',
        'Project',
        'Raised in',
        'Responsible / responded',
        'Due',
        'Priority',
        'Status',
        'Ageing',
        'Live',
        'Remarks',
      ].join(','),
      ...rows.map((i) =>
        [
          i.ref,
          i.type === 'ACTION' ? 'Action' : 'Clarification',
          i.description,
          `${i.project.code} — ${i.project.name}`,
          i.meeting.code,
          i.type === 'ACTION'
            ? i.owners.map((o) => o.user.name).join('; ')
            : (i.respondedBy?.name ?? ''),
          i.dueDate ? i.dueDate.slice(0, 10) : '',
          i.priority ? PRIORITY_LABEL[i.priority] : '',
          i.type === 'ACTION'
            ? i.actionStatus
              ? ACTION_STATUS_LABEL[i.actionStatus]
              : ''
            : i.clarificationStatus
              ? CLARIFICATION_STATUS_LABEL[i.clarificationStatus]
              : '',
          ageing(i),
          i.isActive ? 'yes' : 'not yet circulated',
          i.remarks ?? '',
        ]
          .map(cell)
          .join(','),
      ),
    ].join('\r\n');

    // A BOM, because Excel on Windows reads a UTF-8 CSV as the ANSI codepage
    // otherwise and turns ₹ and the en dashes into mojibake.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ucf-register-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHead
        eyebrow="Tracking"
        title="Action & clarification register"
        lede="Everything raised in any meeting, in one list. Actions run In Progress → Under Review → Completed; clarifications run Open → Responded → Closed."
        actions={
          <button
            className="btn-ghost"
            type="button"
            disabled={!items || items.length === 0}
            onClick={exportCsv}
          >
            Export CSV
          </button>
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
        <div className="grid gap-3 px-[17px] py-3.5 sm:grid-cols-2 lg:grid-cols-5">
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
                {ACTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ACTION_STATUS_LABEL[s]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Clarifications">
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
              onClick={() => setMine((v) => !v)}
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
