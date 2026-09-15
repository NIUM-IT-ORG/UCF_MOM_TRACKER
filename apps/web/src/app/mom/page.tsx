'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MOM_STATE_LABEL, type MomState } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { MomRow } from '@/lib/meetings';
import { Card, Empty, MomChip, PageHead, ProjectTag, TableWrap, Tabs } from '@/components/ui';
import { MomConsole } from './MomConsole';

const VIEWS: { key: string; label: string; states: string }[] = [
  { key: 'all', label: 'All', states: '' },
  { key: 'mine', label: 'Needs work', states: 'DRAFT,RETURNED' },
  { key: 'approval', label: 'Awaiting approval', states: 'SUBMITTED' },
  { key: 'signing', label: 'Awaiting signature', states: 'APPROVED' },
  { key: 'circulated', label: 'Circulated', states: 'SIGNED' },
];

export default function MomRegisterPage() {
  const params = useSearchParams();
  const focusMeeting = params.get('meeting');
  const { caps } = useSession();

  const [view, setView] = useState('all');
  const [rows, setRows] = useState<MomRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const states = VIEWS.find((v) => v.key === view)?.states ?? '';

  const load = useCallback(async () => {
    try {
      setRows(await api<MomRow[]>(`/mom${states ? `?state=${states}` : ''}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not load the register.');
    }
  }, [states]);

  useEffect(() => {
    void load();
  }, [load]);

  const focused = focusMeeting ? rows?.find((r) => r.meeting.id === focusMeeting) : undefined;

  return (
    <>
      <PageHead
        eyebrow="Meetings"
        title="MoM register"
        lede="Generate, submit, approve, sign, circulate. Circulation is the hinge — it is the moment every action in the document becomes live."
      />

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      {focusMeeting && (
        <div className="mb-4">
          {focused ? (
            <MomConsole mom={focused} onDone={() => void load()} />
          ) : (
            <Card>
              <Empty>
                That meeting’s MoM is not in this view.{' '}
                <button className="btn-ghost" type="button" onClick={() => setView('all')}>
                  Show all
                </button>
              </Empty>
            </Card>
          )}
        </div>
      )}

      <Tabs
        active={view}
        onChange={setView}
        tabs={VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          count: rows && v.states === states ? rows.length : undefined,
        }))}
      />

      <Card title="Minutes of meeting" tag={rows ? `${rows.length} shown` : undefined}>
        {!rows ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            Nothing here.{' '}
            {view === 'approval' && caps.includes('approve_mom')
              ? 'No MoM is waiting on you.'
              : 'A MoM appears once it has been generated from a meeting’s minutes.'}
          </Empty>
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Meeting</th>
                  <th>Projects</th>
                  <th>Version</th>
                  <th>State</th>
                  <th>Last moved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/meetings/${m.meeting.id}`} className="font-mono text-[11.5px] font-semibold">
                        {m.meeting.code}
                      </Link>
                      {m.correctsMomId && (
                        <small className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-accent">
                          Corrigendum
                        </small>
                      )}
                    </td>
                    <td>
                      <b className="block text-[12.5px] text-navy">{m.meeting.title}</b>
                      <small className="text-[11px] text-muted">{formatDate(m.meeting.meetingDate)}</small>
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {m.meeting.projects.map((p) => (
                          <ProjectTag key={p.project.id} code={p.project.code} />
                        ))}
                      </span>
                    </td>
                    <td className="tabular-nums">v{m.version}</td>
                    <td>
                      <MomChip state={m.state} />
                    </td>
                    <td className="whitespace-nowrap">
                      {formatDate(m.circulatedAt ?? m.decidedAt ?? m.submittedAt)}
                    </td>
                    <td>
                      <Link className="btn-ghost" href={`/mom?meeting=${m.meeting.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <p className="mt-3 text-[11.5px] text-muted">
        States: {(Object.keys(MOM_STATE_LABEL) as MomState[]).map((s) => MOM_STATE_LABEL[s]).join(' · ')}
      </p>
    </>
  );
}
