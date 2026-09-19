'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ProjectStatus } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ProjectForm } from './ProjectForm';
import { drawnPercent, formatCrore, formatDate } from '@/lib/format';
import { Card, Empty, PageHead, ProjectTag, StatusChip } from '@/components/ui';

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  fullName: string;
  status: ProjectStatus;
  implementingAgency: string | null;
  costCr: string;
  debtSanctionedCr: string;
  debtDrawnCr: string;
  startDate: string | null;
  targetEndDate: string | null;
  _count: { ulbs: number; members: number; documents: number };
}

export default function ProjectsPage() {
  const router = useRouter();
  const { caps } = useSession();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<ProjectRow[]>('/projects')
      .then(setProjects)
      .catch((err) => setError(err instanceof ApiError ? err.display : 'Could not load projects.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canManage = caps.includes('manage_masters');

  return (
    <>
      <PageHead
        eyebrow="Masters"
        title="Projects"
        lede="Only the projects you are mapped to. Everything else is not merely hidden — it is not there, as far as this application is concerned."
        actions={
          canManage && !adding ? (
            <button className="btn-primary" type="button" onClick={() => setAdding(true)}>
              New project
            </button>
          ) : null
        }
      />

      {adding && (
        <div className="mb-4">
          <ProjectForm
            onSaved={(id) => {
              setAdding(false);
              load();
              router.push(`/projects/${id}`);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      {!error && projects === null && (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      )}

      {projects?.length === 0 && (
        <Card>
          <Empty>
            You are not mapped to any project yet. A System Administrator adds the mapping on
            the People screen; until then every list here will be empty.
          </Empty>
        </Card>
      )}

      {projects && projects.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const pct = drawnPercent(project.debtSanctionedCr, project.debtDrawnCr);

  return (
    <Card className="transition-shadow hover:shadow-[0_6px_20px_rgba(29,53,87,.12)]">
      <div className="px-[17px] py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <ProjectTag code={project.code} />
          <StatusChip status={project.status} />
        </div>

        <h3 className="m-0 font-serif text-[17px] font-semibold text-navy">
          <Link href={`/projects/${project.id}`} className="text-navy hover:text-blue">
            {project.name}
          </Link>
        </h3>
        <p className="mb-3 mt-1 text-[12.5px] text-muted">{project.fullName}</p>

        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
          <Fact label="Project cost" value={formatCrore(project.costCr)} />
          <Fact label="Debt sanctioned" value={formatCrore(project.debtSanctionedCr)} />
          <Fact label="Drawn" value={formatCrore(project.debtDrawnCr)} />
          <Fact label="Target end" value={formatDate(project.targetEndDate)} />
        </dl>

        <div className="mb-1 flex items-center gap-2 text-[11.5px] text-muted">
          <span>Drawdown</span>
          <div className="h-[7px] flex-1 overflow-hidden rounded-md bg-[#EDF1F6]">
            <div
              className="h-full rounded-md bg-blue"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <b className="tabular-nums text-navy">{pct}%</b>
        </div>

        <p className="mb-0 mt-3 text-[11.5px] text-muted">
          {project._count.ulbs} ULB{project._count.ulbs === 1 ? '' : 's'} ·{' '}
          {project._count.members} officer{project._count.members === 1 ? '' : 's'} ·{' '}
          {project._count.documents} document{project._count.documents === 1 ? '' : 's'}
        </p>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9.5px] font-bold uppercase tracking-[1.2px] text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 font-semibold text-navy">{value}</dd>
    </div>
  );
}
