'use client';

import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui';

export interface PickableOfficer {
  id: string;
  name: string;
  initials: string;
  designation: { code: string; name: string };
  department?: { name: string } | null;
  /** Head-office designations see everything; the rest see what they are mapped to. */
  seesAllProjects?: boolean;
  projects?: { project: { id: string; code: string; name: string } }[];
  /** Was this officer actually in the room? Those come first. */
  attended?: boolean;
}

/**
 * Choosing who is accountable.
 *
 * Every row carries the officer's name, their designation, their department and
 * **which projects they can see** — because the failure this replaces is
 * silent: an action given to an officer who is not mapped to the project. The
 * system will accept it, the register will show it, and that officer will never
 * see it on their dashboard. A three-letter designation code in a dropdown
 * cannot warn anybody about that; a scope chip beside the name can.
 *
 * People who attended the meeting are listed first and marked, because an
 * action is nearly always given to somebody who was in the room.
 */
export function OfficerPicker({
  people,
  selected,
  onChange,
  multiple = true,
  projectId,
  invalid = false,
}: {
  people: PickableOfficer[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Actions take several officers; a clarification has one responder. */
  multiple?: boolean;
  /** The project the item belongs to, so out-of-scope officers can be flagged. */
  projectId?: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (p: PickableOfficer) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.designation.name.toLowerCase().includes(q) ||
      (p.department?.name ?? '').toLowerCase().includes(q);
    return people.filter(matches);
  }, [people, query]);

  const chosen = people.filter((p) => selected.includes(p.id));

  const scope = (p: PickableOfficer) => {
    if (p.seesAllProjects) return { label: 'All projects', out: false };
    const list = p.projects ?? [];
    const only = list.length === 1 ? list[0] : undefined;
    if (list.length === 0) return { label: 'No project mapped', out: Boolean(projectId) };
    const out = Boolean(projectId) && !list.some((x) => x.project.id === projectId);
    return { label: only ? only.project.name : `${list.length} projects`, out };
  };

  const toggle = (id: string) => {
    if (!multiple) {
      onChange(selected.includes(id) ? [] : [id]);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div>
      {/*
        What is chosen, before the list — so the officer never has to scroll a
        list of fourteen names to find out who they have already ticked.
      */}
      <div
        className={`mb-2 flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-[10px] border px-2.5 py-2 ${
          invalid ? 'border-[#D98C7F] bg-[#FEF8F7]' : 'border-line bg-[#F9FBFD]'
        }`}
      >
        {chosen.length === 0 ? (
          <span className="text-[12.5px] text-muted">Nobody selected yet</span>
        ) : (
          chosen.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-ice2 bg-white py-1 pl-1.5 pr-1 text-[12px] font-semibold text-navy"
            >
              <Avatar initials={p.initials} size={18} />
              {p.name}
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                onClick={() => toggle(p.id)}
                className="rounded-full px-1 text-[13px] leading-none text-muted hover:text-danger"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      {people.length > 8 && (
        <input
          className="i mb-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, designation or department"
          aria-label="Search officers"
        />
      )}

      <div className="max-h-[228px] overflow-y-auto rounded-[10px] border border-line">
        {rows.length === 0 ? (
          <p className="m-0 px-3 py-4 text-[12.5px] text-muted">Nobody matches that.</p>
        ) : (
          rows.map((p, n) => {
            const on = selected.includes(p.id);
            const s = scope(p);
            return (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-2.5 px-2.5 py-2 ${
                  n > 0 ? 'border-t border-line' : ''
                } ${on ? 'bg-ice' : 'hover:bg-[#F6F9FC]'}`}
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  checked={on}
                  onChange={() => toggle(p.id)}
                  className="shrink-0"
                />
                <Avatar initials={p.initials} size={26} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] text-navy">
                    {p.name}
                    {p.attended && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-[.8px] text-[#1B7F44]">
                        was present
                      </span>
                    )}
                  </b>
                  <small className="block truncate text-[11.5px] text-muted">
                    {p.designation.name}
                    {p.department?.name ? ` · ${p.department.name}` : ''}
                  </small>
                </span>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-[10.5px] font-bold ${
                    s.out
                      ? 'border-[#F2C9C4] bg-[#FDECEC] text-[#8A2018]'
                      : 'border-ice2 bg-white text-muted'
                  }`}
                  title={
                    s.out
                      ? 'This officer is not mapped to the project this item belongs to, so it will not appear on their dashboard.'
                      : 'The projects this officer can see'
                  }
                >
                  {s.out ? 'Not on this project' : s.label}
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
