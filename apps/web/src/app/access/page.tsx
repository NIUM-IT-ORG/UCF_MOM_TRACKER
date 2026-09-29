'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Card, Empty, Notice, PageHead, TableWrap } from '@/components/ui';

interface MatrixRow {
  code: string;
  name: string;
  band: string;
  caps: string[];
}

interface Matrix {
  capabilities: { key: string; label: string }[];
  designations: MatrixRow[];
}

/**
 * The designation × capability matrix, editable.
 *
 * `docs/04-RBAC.md` has always said "after go-live the matrix is editable at
 * runtime", and the route to do it has existed since Phase 1 — but nothing
 * was built on top of it, so `manage_access` gated a screen that did not
 * exist. The practical consequence was that a capability added in code could
 * never reach a running system: grants live in `designations.caps`, the seed
 * only ever INSERTs, and the only remaining way in was SQL typed into a
 * production console. This is that screen.
 *
 * It is the whole matrix on one page rather than a designation at a time,
 * because the question people actually arrive with is comparative — "who can
 * approve a MoM?" — and reading that off nine separate pages is how somebody
 * grants a capability to the wrong row.
 *
 * Changes save per designation, not globally: a row is an access decision and
 * ought to be made, and audited, on its own.
 */
export default function AccessControlPage() {
  const { caps } = useSession();
  const canEdit = caps.includes('manage_access');

  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Matrix>('/access/matrix');
      setMatrix(m);
      setDraft(Object.fromEntries(m.designations.map((d) => [d.code, new Set(d.caps)])));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not load the matrix.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(code: string, cap: string) {
    setDraft((cur) => {
      const next = new Set(cur[code] ?? []);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return { ...cur, [code]: next };
    });
    setSaved(null);
  }

  /** Whether this row differs from what the server last told us. */
  function dirty(row: MatrixRow): boolean {
    const now = draft[row.code] ?? new Set<string>();
    if (now.size !== row.caps.length) return true;
    return row.caps.some((c) => !now.has(c));
  }

  async function save(row: MatrixRow) {
    setSaving(row.code);
    setError(null);
    setSaved(null);
    try {
      await api(`/access/matrix/${row.code}`, {
        method: 'PUT',
        body: JSON.stringify({ caps: [...(draft[row.code] ?? [])] }),
      });
      await load();
      setSaved(row.code);
    } catch (err) {
      /*
       * The server refuses a change that would leave nobody able to manage
       * access — locking every administrator out of the box that unlocks
       * them. Its message names the problem, so it is shown as it comes.
       */
      setError(err instanceof ApiError ? err.display : 'That change was not saved.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="System · Access control"
        title="Designation × capability"
        lede="Capability comes from the designation and nothing else. Change a row and every officer holding that designation is affected on their next request — no sign-out needed."
      />

      {error && <Notice tone="red">{error}</Notice>}

      {!canEdit && (
        <Notice>
          You can read this matrix, but changing it needs the <b>Manage access control</b>{' '}
          capability.
        </Notice>
      )}

      {!matrix ? (
        <Card>
          <Empty>Loading the matrix…</Empty>
        </Card>
      ) : (
        <Card title="Who can do what" tag={`${matrix.capabilities.length} capabilities`}>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Capability</th>
                  {matrix.designations.map((d) => (
                    <th key={d.code} className="whitespace-nowrap text-center" title={d.name}>
                      {d.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.capabilities.map((c) => (
                  <tr key={c.key}>
                    <td className="min-w-[260px]">
                      <b className="text-[12.5px] text-navy">{c.label}</b>
                      <small className="mt-0.5 block font-mono text-[10.5px] text-muted">
                        {c.key}
                      </small>
                    </td>
                    {matrix.designations.map((d) => (
                      <td key={d.code} className="text-center">
                        <input
                          type="checkbox"
                          checked={draft[d.code]?.has(c.key) ?? false}
                          disabled={!canEdit || saving !== null}
                          aria-label={`${c.label} for ${d.name}`}
                          onChange={() => toggle(d.code, c.key)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>

          {canEdit && (
            <div className="flex flex-wrap gap-2 border-t border-line px-[17px] py-3.5">
              {matrix.designations.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  className={dirty(d) ? 'btn-primary' : 'btn-ghost'}
                  disabled={!dirty(d) || saving !== null}
                  onClick={() => void save(d)}
                >
                  {saving === d.code
                    ? `Saving ${d.code}…`
                    : dirty(d)
                      ? `Save ${d.code}`
                      : saved === d.code
                        ? `${d.code} saved`
                        : d.code}
                </button>
              ))}
            </div>
          )}

          <p className="mb-0 px-[17px] pb-3.5 text-[11.5px] text-muted">
            Each designation saves on its own, so one access decision is one action in the audit
            trail. A change that would leave nobody able to manage access is refused.
          </p>
        </Card>
      )}
    </>
  );
}
