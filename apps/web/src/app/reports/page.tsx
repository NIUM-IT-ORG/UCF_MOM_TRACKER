'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Card, Empty, Notice, PageHead, TableWrap } from '@/components/ui';

/**
 * The six reports.
 *
 * One screen rather than six: they differ in their columns, not in what you do
 * with them, and an officer who wants the action-taken report for a project
 * between two dates should not have to learn a different screen to get the
 * clarification log for the same period.
 *
 * Three formats from one set of figures — on screen, as a CSV, and as a
 * print-ready page the browser saves as PDF. They cannot disagree, because
 * they are the same table rendered three ways by the server.
 */
interface ReportMeta {
  key: string;
  title: string;
  lede: string;
}

interface ReportTable extends ReportMeta {
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  summary: { label: string; value: string | number }[];
  generatedAt: string;
}

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [active, setActive] = useState<string>('action-taken');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [table, setTable] = useState<ReportTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<ReportMeta[]>('/reports')
      .then(setReports)
      .catch(() => setReports([]));
    api<ProjectOption[]>('/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const params = useCallback(
    (format?: string) => {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (projectId) p.set('projectId', projectId);
      if (format) p.set('format', format);
      const s = p.toString();
      return s ? `?${s}` : '';
    },
    [from, to, projectId],
  );

  const load = useCallback(() => {
    setLoading(true);
    api<ReportTable>(`/reports/${active}${params()}`)
      .then((t) => {
        setTable(t);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.display : 'Could not run that report.'),
      )
      .finally(() => setLoading(false));
  }, [active, params]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHead
        eyebrow="Tracking"
        title="Reports"
        lede="Six standing reports, each scoped to the projects you can see. On screen, as a spreadsheet, or print-ready for a file."
        actions={
          table && (
            <>
              <a className="btn-ghost" href={`/api/v1/reports/${active}${params('csv')}`}>
                Download CSV
              </a>
              <a
                className="btn-primary"
                href={`/api/v1/reports/${active}${params('html')}`}
                target="_blank"
                rel="noreferrer"
              >
                Print / Save as PDF
              </a>
            </>
          )
        }
      />

      {error && <Notice tone="red">{error}</Notice>}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setActive(r.key)}
            aria-pressed={active === r.key}
            className={`rounded-[12px] border px-4 py-3 text-left transition-shadow ${
              active === r.key
                ? 'border-navy bg-navy text-white'
                : 'border-line bg-white hover:shadow-[0_6px_20px_rgba(29,53,87,.10)]'
            }`}
          >
            <b className={`block text-[13px] ${active === r.key ? 'text-white' : 'text-navy'}`}>
              {r.title}
            </b>
            <small
              className={`mt-0.5 block text-[11.5px] ${
                active === r.key ? 'text-[#C9D6E6]' : 'text-muted'
              }`}
            >
              {r.lede}
            </small>
          </button>
        ))}
      </div>

      <Card title="Filters" tag="Applied by the server, inside your project scope">
        <div className="grid gap-3 px-[17px] py-3.5 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">From</span>
            <input className="i" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-navy">To</span>
            <input className="i" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
        </div>
      </Card>

      <div className="mt-4">
        {!table ? (
          <Card>
            <Empty>{loading ? 'Running the report…' : 'Choose a report.'}</Empty>
          </Card>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {table.summary.map((s) => (
                <div key={s.label} className="rounded-[12px] border border-line bg-white px-4 py-3">
                  <div className="text-[24px] font-extrabold leading-none tabular-nums text-navy">
                    {s.value}
                  </div>
                  <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[1.1px] text-muted">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            <Card
              title={table.title}
              tag={`${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`}
            >
              {table.rows.length === 0 ? (
                <Empty>
                  Nothing matches these filters. Remember that only items carried by a circulated
                  MoM are counted — before that they are not live.
                </Empty>
              ) : (
                <TableWrap>
                  <table>
                    <thead>
                      <tr>
                        {table.columns.map((c) => (
                          <th key={c.key} className={c.numeric ? 'text-right' : undefined}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, n) => (
                        <tr key={n}>
                          {table.columns.map((c) => (
                            <td
                              key={c.key}
                              className={c.numeric ? 'text-right tabular-nums' : undefined}
                            >
                              {row[c.key] ?? '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>

            <p className="mt-3 text-[11.5px] text-muted">
              Generated {new Date(table.generatedAt).toLocaleString()} · the CSV and the printed
              page come from these same figures, so they cannot disagree.
            </p>
          </>
        )}
      </div>
    </>
  );
}
