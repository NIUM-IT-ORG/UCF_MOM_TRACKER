'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DOCUMENT_TYPE_LABEL, type DocumentType, type ProjectStatus } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSetCrumbTail } from '@/lib/crumb';
import { drawnPercent, formatBytes, formatCrore, formatDate } from '@/lib/format';
import {
  Avatar,
  Card,
  Empty,
  Notice,
  PageHead,
  ProjectTag,
  StatusChip,
  TableWrap,
  Tabs,
} from '@/components/ui';
import { DocumentUpload } from '@/components/DocumentUpload';

interface Ulb {
  id: string;
  code: string;
  name: string;
  wards: number | null;
  nodalName: string | null;
  contact: string | null;
  isLead: boolean;
}

interface Member {
  roleOnProject: string;
  user: {
    id: string;
    name: string;
    initials: string;
    email: string;
    mobile: string;
    accountState: string;
    designation: { code: string; name: string };
    department: { name: string };
  };
}

export interface ProjectDoc {
  id: string;
  name: string;
  type: DocumentType;
  remarks: string | null;
  createdAt: string;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number | null };
  uploadedBy: { id: string; name: string; initials: string };
}

interface Project {
  id: string;
  code: string;
  name: string;
  fullName: string;
  description: string | null;
  status: ProjectStatus;
  implementingAgency: string | null;
  costCr: string;
  debtSanctionedCr: string;
  debtDrawnCr: string;
  startDate: string | null;
  targetEndDate: string | null;
  ulbs: Ulb[];
  members: Member[];
  _count: { ulbs: number; members: number; documents: number };
}

const TABS = ['info', 'officers', 'ulb', 'documents'] as const;
type TabKey = (typeof TABS)[number];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { caps } = useSession();

  // Tab state lives in the URL, so a link to a tab is a link to that tab.
  const requested = params.get('tab');
  const tab: TabKey = (TABS as readonly string[]).includes(requested ?? '')
    ? (requested as TabKey)
    : 'info';

  const [project, setProject] = useState<Project | null>(null);
  const [docs, setDocs] = useState<ProjectDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([
        api<Project>(`/projects/${id}`),
        api<ProjectDoc[]>(`/projects/${id}/documents`),
      ]);
      setProject(p);
      setDocs(d);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'NOT_FOUND'
            ? 'That project is not one you have access to.'
            : err.display
          : 'Could not load the project.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useSetCrumbTail(project?.name);

  function setTab(key: string) {
    router.replace(`/projects/${id}?tab=${key}`, { scroll: false });
  }

  if (error) {
    return (
      <>
        <PageHead eyebrow="Masters" title="Project" />
        <Card>
          <Empty>
            {error}
            <div className="mt-3">
              <Link href="/projects">Back to projects</Link>
            </div>
          </Empty>
        </Card>
      </>
    );
  }

  if (!project) {
    return (
      <Card>
        <Empty>Loading…</Empty>
      </Card>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Masters"
        title={project.name}
        lede={project.fullName}
        actions={
          <>
            <ProjectTag code={project.code} />
            <StatusChip status={project.status} />
          </>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'info', label: 'Project info' },
          { key: 'officers', label: 'Officers', count: project.members.length },
          { key: 'ulb', label: 'ULB info', count: project.ulbs.length },
          { key: 'documents', label: 'Documents', count: docs?.length ?? 0 },
        ]}
      />

      {tab === 'info' && <InfoTab project={project} />}
      {tab === 'officers' && <OfficersTab members={project.members} />}
      {tab === 'ulb' && <UlbTab ulbs={project.ulbs} />}
      {tab === 'documents' && (
        <DocumentsTab
          projectId={project.id}
          docs={docs ?? []}
          canUpload={caps.includes('manage_project_docs')}
          onUploaded={() => void load()}
        />
      )}
    </>
  );
}

function InfoTab({ project }: { project: Project }) {
  const pct = drawnPercent(project.debtSanctionedCr, project.debtDrawnCr);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Project info">
        <div className="px-[17px] py-4">
          {project.description && (
            <p className="mt-0 text-[13.5px] leading-relaxed text-ink">{project.description}</p>
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Implementing agency" value={project.implementingAgency ?? '—'} />
            <Fact label="Status" value={<StatusChip status={project.status} />} />
            <Fact label="Start date" value={formatDate(project.startDate)} />
            <Fact label="Target end date" value={formatDate(project.targetEndDate)} />
          </dl>
        </div>
      </Card>

      <Card title="Financials">
        <div className="px-[17px] py-4">
          <dl className="grid gap-3">
            <Fact label="Project cost" value={formatCrore(project.costCr)} big />
            <Fact label="Debt sanctioned" value={formatCrore(project.debtSanctionedCr)} />
            <Fact label="Debt drawn" value={formatCrore(project.debtDrawnCr)} />
          </dl>
          <div className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
            <div className="h-[9px] flex-1 overflow-hidden rounded-md bg-[#EDF1F6]">
              <div className="h-full rounded-md bg-blue" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <b className="tabular-nums text-navy">{pct}% drawn</b>
          </div>
        </div>
      </Card>
    </div>
  );
}

function OfficersTab({ members }: { members: Member[] }) {
  if (members.length === 0) {
    return (
      <Card>
        <Empty>No officers are mapped to this project yet. Add them on the People screen.</Empty>
      </Card>
    );
  }
  return (
    <Card title="Officers on this project" tag="Their designation decides what they may do">
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th>Officer</th>
              <th>Designation</th>
              <th>Role here</th>
              <th>Department</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user.id}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={m.user.initials} size={28} />
                    <div>
                      <b className="block text-[12.5px] text-navy">{m.user.name}</b>
                      {m.user.accountState !== 'ACTIVE' && (
                        <small className="text-[10.5px] text-muted">
                          {m.user.accountState === 'INVITE_ONLY'
                            ? 'No sign-in — notifications only'
                            : 'Suspended'}
                        </small>
                      )}
                    </div>
                  </div>
                </td>
                <td>{m.user.designation.name}</td>
                <td>{m.roleOnProject}</td>
                <td>{m.user.department.name}</td>
                <td className="whitespace-nowrap">{m.user.mobile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function UlbTab({ ulbs }: { ulbs: Ulb[] }) {
  if (ulbs.length === 0) {
    return (
      <Card>
        <Empty>No ULBs recorded for this project yet.</Empty>
      </Card>
    );
  }
  return (
    <Card title="Urban local bodies" tag="Exactly one is the lead">
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>ULB</th>
              <th>Wards</th>
              <th>Nodal officer</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {ulbs.map((u) => (
              <tr key={u.id}>
                <td className="whitespace-nowrap font-mono text-[11.5px] text-muted">{u.code}</td>
                <td>
                  <b className="text-navy">{u.name}</b>
                  {u.isLead && (
                    <span className="ml-2 rounded-md bg-[#FFF2E0] px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#A66A12]">
                      Lead
                    </span>
                  )}
                </td>
                <td className="tabular-nums">{u.wards ?? '—'}</td>
                <td>{u.nodalName ?? '—'}</td>
                <td className="whitespace-nowrap">{u.contact ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function DocumentsTab({
  projectId,
  docs,
  canUpload,
  onUploaded,
}: {
  projectId: string;
  docs: ProjectDoc[];
  canUpload: boolean;
  onUploaded: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="grid gap-4">
      {!canUpload && (
        <Notice>
          You can read these, but adding a document needs the{' '}
          <b>Add project documents</b> capability. Your designation does not carry it.
        </Notice>
      )}

      {canUpload && !adding && (
        <div>
          <button className="btn-primary" onClick={() => setAdding(true)} type="button">
            Add a document
          </button>
        </div>
      )}

      {adding && (
        <DocumentUpload
          target={`projects/${projectId}`}
          onDone={() => {
            setAdding(false);
            onUploaded();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <Card title="Documents" tag={`${docs.length} on file`}>
        {docs.length === 0 ? (
          <Empty>
            Nothing filed against this project yet. Sanction orders, the DPR, agreements and
            progress reports all belong here.
          </Empty>
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>File</th>
                  <th>Added by</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <b className="text-navy">{d.name}</b>
                      {d.remarks && (
                        <small className="mt-0.5 block text-[11.5px] text-muted">{d.remarks}</small>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{DOCUMENT_TYPE_LABEL[d.type] ?? d.type}</td>
                    <td>
                      <a href={`/api/v1/files/${d.file.id}/content`} className="font-medium">
                        {d.file.fileName}
                      </a>
                      <small className="ml-1.5 text-[11px] text-muted">
                        {formatBytes(d.file.sizeBytes)}
                      </small>
                    </td>
                    <td className="whitespace-nowrap">{d.uploadedBy.name}</td>
                    <td className="whitespace-nowrap">{formatDate(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function Fact({
  label,
  value,
  big = false,
}: {
  label: string;
  value: React.ReactNode;
  big?: boolean;
}) {
  return (
    <div>
      <dt className="text-[9.5px] font-bold uppercase tracking-[1.2px] text-muted">{label}</dt>
      <dd className={`m-0 mt-1 font-semibold text-navy ${big ? 'text-[19px]' : 'text-[13px]'}`}>
        {value}
      </dd>
    </div>
  );
}
