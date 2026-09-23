'use client';

import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Avatar, Card, Empty, Notice } from '@/components/ui';

/**
 * Who is on this project.
 *
 * This mapping is the data scope, and it is the answer to "why can't they see
 * the meeting" more often than anything else: an officer who is not on the
 * project does not merely have the project hidden — as far as every query in
 * the application is concerned, it is not there.
 *
 * It grants no capability. What an officer may *do* comes from the
 * designation, always, and the note at the bottom says so where somebody is
 * about to assume otherwise.
 *
 * Officers who see every project are listed separately and cannot be added:
 * they are already on it, by a different rule, and putting them in the list
 * would suggest removing them would take the project away from them.
 */
interface Person {
  id: string;
  name: string;
  initials: string;
  accountState: string;
  seesAllProjects: boolean;
  designation: { code: string; name: string };
  department: { id: string; name: string };
}

export function MembersForm({
  projectId,
  current,
  onSaved,
  onCancel,
}: {
  projectId: string;
  current: { roleOnProject: string; user: { id: string; name: string } }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [rows, setRows] = useState<Record<string, string>>(() =>
    Object.fromEntries(current.map((m) => [m.user.id, m.roleOnProject])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * A search box, because this list is every officer on the system and it
   * only grows. Scrolling a few hundred rows to find one engineer is the
   * kind of thing that gets done wrong once and then avoided.
   */
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<Person[]>('/users')
      .then(setPeople)
      .catch((err) =>
        setError(err instanceof ApiError ? err.display : 'Could not load the officers.'),
      );
  }, []);

  function toggle(person: Person) {
    setRows((cur) => {
      if (person.id in cur) {
        const { [person.id]: _removed, ...rest } = cur;
        return rest;
      }
      // The designation is the honest default for "what do they do here".
      return { ...cur, [person.id]: person.designation.name };
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${projectId}/members`, {
        method: 'PUT',
        body: JSON.stringify({
          members: Object.entries(rows).map(([userId, roleOnProject]) => ({
            userId,
            roleOnProject: roleOnProject.trim() || 'Member',
          })),
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not save the officers.');
    } finally {
      setBusy(false);
    }
  }

  const mappable = (people ?? []).filter((p) => !p.seesAllProjects);
  const everywhere = (people ?? []).filter((p) => p.seesAllProjects);

  /*
   * Name, designation or department — the three things somebody actually
   * knows about a person they are looking for.
   *
   * Anyone already ticked stays visible whatever is typed. Filtering a
   * selected officer out of sight makes the count at the bottom disagree
   * with the list above it, and the officer gets un-ticked by somebody who
   * thinks it is a bug.
   */
  const q = query.trim().toLowerCase();
  const shown = q
    ? mappable.filter(
        (p) =>
          p.id in rows ||
          p.name.toLowerCase().includes(q) ||
          p.designation.name.toLowerCase().includes(q) ||
          p.department.name.toLowerCase().includes(q),
      )
    : mappable;

  return (
    <Card title="Officers on this project" tag="Ticking one gives them sight of it">
      <div className="grid gap-3.5 px-[17px] py-4">
        {error && <Notice tone="red">{error}</Notice>}

        {!people ? (
          <Empty>Loading the officers…</Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                className="i max-w-[320px]"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, designation or department"
                aria-label="Search officers"
              />
              <span className="text-[11.5px] text-muted">
                {Object.keys(rows).length} selected
                {q ? ` · ${shown.length} of ${mappable.length} shown` : ''}
              </span>
            </div>

            <div className="grid gap-1.5">
              {shown.length === 0 && (
                <Empty>Nobody matches that. Clear the search to see everyone.</Empty>
              )}
              {shown.map((p) => {
                const on = p.id in rows;
                return (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center gap-2.5 rounded-[10px] border px-3 py-2 ${
                      on ? 'border-blue bg-ice' : 'border-line bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p)}
                      aria-label={`${p.name} on this project`}
                    />
                    <Avatar initials={p.initials} size={26} />
                    <div className="min-w-[180px]">
                      <b className="block text-[12.5px] text-navy">{p.name}</b>
                      <small className="text-[11px] text-muted">
                        {p.designation.name} · {p.department.name}
                        {p.accountState !== 'ACTIVE' &&
                          (p.accountState === 'INVITE_ONLY'
                            ? ' · no sign-in'
                            : ' · suspended')}
                      </small>
                    </div>
                    <div className="ml-auto min-w-[220px]">
                      <input
                        className="i"
                        disabled={!on}
                        value={rows[p.id] ?? ''}
                        onChange={(e) => setRows((cur) => ({ ...cur, [p.id]: e.target.value }))}
                        placeholder="Role on this project"
                        aria-label={`${p.name}'s role on this project`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {everywhere.length > 0 && (
              <p className="mb-0 text-[11.5px] text-muted">
                Already on every project, by their designation:{' '}
                {everywhere.map((p) => p.name).join(', ')}. They see this one without being
                mapped to it.
              </p>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2.5">
          <button className="btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : `Save ${Object.keys(rows).length} officer(s)`}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Never mind
          </button>
        </div>

        <p className="mb-0 text-[11.5px] text-muted">
          This decides what they can <b>see</b>. What they may <b>do</b> comes from their
          designation and nothing else — change that on the People screen.
        </p>
      </div>
    </Card>
  );
}
