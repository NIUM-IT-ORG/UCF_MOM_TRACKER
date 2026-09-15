'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  MEETING_CATEGORY_LABEL,
  MEETING_TYPE_LABEL,
  type MeetingCategory,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { nextStep, timeRange, type MeetingRow } from '@/lib/meetings';
import {
  Card,
  Empty,
  MomChip,
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
  const { caps, user } = useSession();
  const [view, setView] = useState<string>('all');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stages = VIEWS.find((v) => v.key === view)?.stages ?? '';

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (stages) params.set('stage', stages);
    if (type) params.set('type', type);
    if (category) params.set('category', category);
    if (projectId) params.set('projectId', projectId);
    if (q.trim()) params.set('q', q.trim());
    try {
      setRows(await api<MeetingRow[]>(`/meetings?${params.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not load meetings.');
    }
  }, [stages, type, category, projectId, q]);

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
            <option value="">All my projects</option>
            {(user?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
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
                    <th>When</th>
                    <th>Projects</th>
                    <th>Stage</th>
                    <th>MoM</th>
                    <th>Next step</th>
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
                        <span className="flex flex-wrap gap-1">
                          {m.projects.map((p) => (
                            <ProjectTag key={p.project.id} code={p.project.code} />
                          ))}
                        </span>
                      </td>
                      <td>
                        <StageChip stage={m.stage} />
                      </td>
                      <td>{m.moms[0] ? <MomChip state={m.moms[0].state} /> : <span className="text-muted">—</span>}</td>
                      <td className="text-[12px] text-muted">{nextStep(m)}</td>
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
