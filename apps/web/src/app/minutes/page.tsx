'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { nextStep, timeRange, type MeetingRow } from '@/lib/meetings';
import { Card, Empty, MomChip, PageHead, ProjectTag, StageChip, TableWrap } from '@/components/ui';

/**
 * The minutes editor is per meeting, so this is the way in: the meetings that
 * have actually been held and still need writing up, oldest first.
 *
 * Oldest first is the point. A minute that is a fortnight late is the one that
 * matters, and a list sorted newest-first buries it.
 */
export default function MinutesIndex() {
  const [rows, setRows] = useState<MeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MeetingRow[]>('/meetings?stage=LIVE,HELD,MINUTED')
      .then((all) =>
        setRows(
          [...all].sort(
            (a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime(),
          ),
        ),
      )
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load meetings.'));
  }, []);

  const waiting = rows?.filter((m) => !m.moms[0] || m.moms[0].state === 'NOT_GENERATED') ?? [];

  return (
    <>
      <PageHead
        eyebrow="Meetings"
        title="Minutes editor"
        lede="Meetings that have been held and still need writing up. The editor opens on the meeting itself, with the entry form for actions and clarifications beside it."
      />

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      <Card
        title="Waiting to be minuted"
        tag={rows ? `${waiting.length} of ${rows.length} held` : undefined}
      >
        {!rows ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            No meeting has been held yet. <Link href="/meetings">Meetings</Link> is where they start.
          </Empty>
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Meeting</th>
                  <th>Held</th>
                  <th>Projects</th>
                  <th>Stage</th>
                  <th>MoM</th>
                  <th>Next step</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/meetings/${m.id}`} className="font-mono text-[11.5px] font-semibold">
                        {m.code}
                      </Link>
                    </td>
                    <td>
                      <b className="block text-[12.5px] text-navy">{m.title}</b>
                      <small className="text-[11px] text-muted">{m.venue}</small>
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
                    <td>
                      {m.moms[0] ? <MomChip state={m.moms[0].state} /> : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-[12px] text-muted">{nextStep(m)}</td>
                    <td>
                      <Link className="btn-ghost" href={`/meetings/${m.id}/minutes`}>
                        Write up
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
