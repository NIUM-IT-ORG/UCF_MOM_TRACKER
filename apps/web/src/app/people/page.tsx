'use client';

import { useEffect, useState } from 'react';
import { CAPABILITIES, type Capability } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Avatar, Card, Empty, PageHead, ProjectTag, TableWrap, Tabs } from '@/components/ui';

interface Person {
  id: string;
  name: string;
  initials: string;
  email: string;
  mobile: string;
  accountState: string;
  seesAllProjects: boolean;
  lastLoginAt: string | null;
  designation: { code: string; name: string; band: string };
  department: { id: string; name: string };
  projects: { project: { id: string; code: string; name: string } }[];
}

interface Designation {
  id: string;
  code: string;
  name: string;
  band: string;
  caps: string[];
  isSystem: boolean;
  _count: { users: number };
}

interface Department {
  id: string;
  name: string;
  _count: { users: number };
}

interface Effective {
  user: { id: string; name: string; email: string; accountState: string };
  designation: { code: string; name: string; band: string };
  capabilities: { key: Capability; label: string; held: boolean }[];
  seesAllProjects: boolean;
  projects: { id: string; code: string; name: string; roleOnProject: string | null }[];
  summary: string;
}

export default function PeoplePage() {
  const [tab, setTab] = useState('people');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [designations, setDesignations] = useState<Designation[] | null>(null);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [checking, setChecking] = useState<Effective | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  useEffect(() => {
    // Each list is fetched on its own. With Promise.all a single failing call
    // empties all three tabs and the officer cannot tell which one broke; here
    // the two that worked still render and only the third says so.
    const load = <T,>(path: string, key: string, set: (v: T[]) => void) =>
      api<T[]>(path)
        .then(set)
        .catch((err) => {
          set([]);
          setFailed((f) => ({
            ...f,
            [key]: err instanceof ApiError ? err.display : 'That list could not be loaded.',
          }));
        });

    void Promise.all([
      load<Person>('/users', 'people', setPeople),
      load<Designation>('/designations', 'designations', setDesignations),
      load<Department>('/departments', 'departments', setDepartments),
    ]);
  }, []);

  async function check(userId: string) {
    try {
      setChecking(await api<Effective>(`/access/effective/${userId}`));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'FORBIDDEN_CAPABILITY'
          ? 'Checking another officer’s access needs the Manage access control capability.'
          : 'Could not check that officer’s access.',
      );
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Masters"
        title="People & designations"
        lede="Officers on your projects, plus everyone who sees every project. What each of them may do comes from their designation — never from anything set on the person."
      />

      {error && (
        <Card>
          <Empty>{error}</Empty>
        </Card>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'people', label: 'People', count: people?.length },
          { key: 'designations', label: 'Designations', count: designations?.length },
          { key: 'departments', label: 'Departments', count: departments?.length },
        ]}
      />

      {tab === 'people' && (
        <Card title="Officers" tag="Scoped to what you can see">
          {failed.people ? (
            <Empty>{failed.people}</Empty>
          ) : !people ? (
            <Empty>Loading…</Empty>
          ) : people.length === 0 ? (
            <Empty>Nobody is visible to you — you are not mapped to any project yet.</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Officer</th>
                    <th>Designation</th>
                    <th>Department</th>
                    <th>Projects</th>
                    <th>Last signed in</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={p.initials} size={28} />
                          <div>
                            <b className="block text-[12.5px] text-navy">{p.name}</b>
                            <small className="text-[11px] text-muted">{p.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {p.designation.name}
                        {p.accountState !== 'ACTIVE' && (
                          <small className="mt-0.5 block text-[10.5px] text-muted">
                            {p.accountState === 'INVITE_ONLY'
                              ? 'No sign-in — notifications only'
                              : 'Suspended'}
                          </small>
                        )}
                      </td>
                      <td>{p.department.name}</td>
                      <td>
                        {p.seesAllProjects ? (
                          <span className="text-[11.5px] font-semibold text-navy">All projects</span>
                        ) : p.projects.length === 0 ? (
                          <span className="text-[11.5px] text-muted">None</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {p.projects.map((m) => (
                              <ProjectTag key={m.project.id} code={m.project.code} />
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{formatDate(p.lastLoginAt)}</td>
                      <td>
                        <button className="btn-ghost" type="button" onClick={() => void check(p.id)}>
                          Check access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === 'designations' && (
        <Card title="Designations" tag="Capability comes from here, and only from here">
          {failed.designations ? (
            <Empty>{failed.designations}</Empty>
          ) : !designations ? (
            <Empty>Loading…</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Designation</th>
                    <th>Band</th>
                    <th>Capabilities</th>
                    <th>Officers</th>
                  </tr>
                </thead>
                <tbody>
                  {designations.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap font-mono text-[11.5px] text-muted">
                        {d.code}
                      </td>
                      <td>
                        <b className="text-navy">{d.name}</b>
                      </td>
                      <td>{d.band}</td>
                      <td className="tabular-nums">
                        {d.caps.length === 0 ? (
                          <span className="text-muted">None — receives notifications only</span>
                        ) : (
                          `${d.caps.length} of ${Object.keys(CAPABILITIES).length}`
                        )}
                      </td>
                      <td className="tabular-nums">{d._count.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === 'departments' && (
        <Card title="Departments" tag="Retired, never deleted">
          {failed.departments ? (
            <Empty>{failed.departments}</Empty>
          ) : !departments ? (
            <Empty>Loading…</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Officers</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <b className="text-navy">{d.name}</b>
                      </td>
                      <td className="tabular-nums">{d._count.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {checking && <EffectiveAccess effective={checking} onClose={() => setChecking(null)} />}
    </>
  );
}

/**
 * The effective-access checker from docs/04-RBAC.md §7.
 *
 * It answers "why can't this officer see X", which is the question support gets
 * asked most. Showing the capabilities the officer does *not* hold matters as
 * much as the ones they do — the absent one is usually the answer.
 */
function EffectiveAccess({ effective, onClose }: { effective: Effective; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(19,35,61,.5)] px-5 pb-5 pt-14"
      role="dialog"
      aria-modal="true"
      aria-label="Effective access"
      onClick={onClose}
    >
      <div
        className="mb-10 w-full max-w-[720px] rounded-[14px] bg-white shadow-[0_24px_60px_rgba(13,30,56,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <h3 className="m-0 text-[15px] font-bold text-navy">
            What {effective.user.name} can actually do
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto border-0 bg-transparent text-[22px] leading-none text-muted"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mt-0 rounded-lg bg-ice px-3 py-2.5 text-[12.5px] text-navy">
            {effective.summary}
          </p>

          <h4 className="mb-2 mt-4 text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-muted">
            Projects
          </h4>
          {effective.projects.length === 0 ? (
            <p className="m-0 text-[12.5px] text-danger">
              None. Every list will be empty for this officer until a project is mapped.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0 text-[12.5px]">
              {effective.projects.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <ProjectTag code={p.code} />
                  <span className="text-navy">{p.name}</span>
                  {p.roleOnProject && <span className="text-muted">· {p.roleOnProject}</span>}
                </li>
              ))}
            </ul>
          )}

          <h4 className="mb-2 mt-4 text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-muted">
            Capabilities
          </h4>
          <div className="grid gap-x-5 sm:grid-cols-2">
            {effective.capabilities.map((c) => (
              <div key={c.key} className="flex items-baseline gap-2 border-b border-line py-1.5">
                <span
                  aria-hidden="true"
                  className="text-[13px] font-bold"
                  style={{ color: c.held ? 'var(--ok)' : '#C3CCD8' }}
                >
                  {c.held ? '✓' : '·'}
                </span>
                <span
                  className={
                    c.held ? 'text-[12.5px] text-ink' : 'text-[12.5px] text-muted opacity-60'
                  }
                >
                  {c.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t border-line px-5 py-3.5">
          <button className="btn-ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
