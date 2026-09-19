'use client';

import { useState } from 'react';
import { PROJECT_STATUS_LABEL, type ProjectStatus } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { Card, Field, Notice } from '@/components/ui';

/**
 * Adding a project, and editing one.
 *
 * One form for both, because the fields are the same and the only real
 * difference is the code: it goes into every meeting reference — UCF/P1/RM-06
 * — so it is set once at creation and never editable afterwards. A project
 * whose code changed would orphan every MoM that quotes it.
 *
 * The money figures are decimals as strings all the way to the database.
 * Parsing them into JavaScript numbers anywhere in the path is how a crore
 * figure quietly becomes 12.340000000000002.
 */
export interface ProjectValues {
  code: string;
  name: string;
  fullName: string;
  description: string;
  status: ProjectStatus;
  implementingAgency: string;
  costCr: string;
  debtSanctionedCr: string;
  debtDrawnCr: string;
  startDate: string;
  targetEndDate: string;
}

const EMPTY: ProjectValues = {
  code: '',
  name: '',
  fullName: '',
  description: '',
  status: 'PLANNING',
  implementingAgency: '',
  costCr: '',
  debtSanctionedCr: '',
  debtDrawnCr: '',
  startDate: '',
  targetEndDate: '',
};

const STATUSES: ProjectStatus[] = [
  'PLANNING',
  'PROCUREMENT',
  'UNDER_EXECUTION',
  'COMPLETED',
  'ON_HOLD',
];

export function ProjectForm({
  projectId,
  initial,
  onSaved,
  onCancel,
}: {
  /** Absent when creating. */
  projectId?: string;
  initial?: Partial<ProjectValues>;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const editing = Boolean(projectId);
  const [v, setV] = useState<ProjectValues>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (key: keyof ProjectValues) => (value: string) =>
    setV((cur) => ({ ...cur, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    // Empty optional text is omitted rather than sent as "", which the DTOs
    // would read as a deliberate blanking.
    const body: Record<string, unknown> = {
      name: v.name.trim(),
      fullName: v.fullName.trim(),
      status: v.status,
      costCr: v.costCr || '0',
      debtSanctionedCr: v.debtSanctionedCr || '0',
      debtDrawnCr: v.debtDrawnCr || '0',
    };
    if (!editing) body.code = v.code.trim().toUpperCase();
    if (v.description.trim()) body.description = v.description.trim();
    if (v.implementingAgency.trim()) body.implementingAgency = v.implementingAgency.trim();
    if (v.startDate) body.startDate = v.startDate;
    if (v.targetEndDate) body.targetEndDate = v.targetEndDate;

    try {
      const saved = await api<{ id: string }>(editing ? `/projects/${projectId}` : '/projects', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved(saved.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        // The API names the fields; putting them back on the inputs is the
        // difference between "fix the form" and "read the form again".
        const details = err.details as { path?: string; message?: string }[] | undefined;
        if (Array.isArray(details)) {
          setFieldErrors(
            Object.fromEntries(details.map((d) => [d.path ?? '', d.message ?? 'Not accepted.'])),
          );
        }
      }
      setError(err instanceof ApiError ? err.display : 'Could not save the project.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={editing ? 'Edit the project' : 'New project'}
      tag={editing ? 'The code cannot change' : 'The code goes into every meeting reference'}
    >
      <div className="grid gap-3.5 px-[17px] py-4">
        {error && <Notice tone="red">{error}</Notice>}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label="Code"
            required={!editing}
            fixed={editing}
            error={fieldErrors.code}
            hint={editing ? 'Fixed — every meeting reference quotes it.' : 'Short, like P4 or UCF-04.'}
          >
            <input
              className="i"
              value={v.code}
              disabled={editing}
              onChange={(e) => set('code')(e.target.value)}
              placeholder="P4"
            />
          </Field>

          <Field label="Status" required>
            <select
              className="i"
              value={v.status}
              onChange={(e) => setV((cur) => ({ ...cur, status: e.target.value as ProjectStatus }))}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Short name" required error={fieldErrors.name} hint="What people call it in a meeting.">
          <input className="i" value={v.name} onChange={(e) => set('name')(e.target.value)} placeholder="Project 4" />
        </Field>

        <Field
          label="Full name"
          required
          error={fieldErrors.fullName}
          hint="As it appears in the sanction order."
        >
          <input
            className="i"
            value={v.fullName}
            onChange={(e) => set('fullName')(e.target.value)}
            placeholder="Integrated Storm Water Drainage — City 4"
          />
        </Field>

        <Field label="Description" error={fieldErrors.description}>
          <textarea
            className="i min-h-[64px]"
            value={v.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </Field>

        <Field label="Implementing agency" error={fieldErrors.implementingAgency}>
          <input
            className="i"
            value={v.implementingAgency}
            onChange={(e) => set('implementingAgency')(e.target.value)}
            placeholder="Agency 4"
          />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="Project cost (₹ cr)" required error={fieldErrors.costCr}>
            <input
              className="i"
              inputMode="decimal"
              value={v.costCr}
              onChange={(e) => set('costCr')(e.target.value)}
              placeholder="120.00"
            />
          </Field>
          <Field label="Debt sanctioned (₹ cr)" required error={fieldErrors.debtSanctionedCr}>
            <input
              className="i"
              inputMode="decimal"
              value={v.debtSanctionedCr}
              onChange={(e) => set('debtSanctionedCr')(e.target.value)}
              placeholder="90.00"
            />
          </Field>
          <Field
            label="Debt drawn (₹ cr)"
            required
            error={fieldErrors.debtDrawnCr}
            hint="Cannot exceed sanctioned."
          >
            <input
              className="i"
              inputMode="decimal"
              value={v.debtDrawnCr}
              onChange={(e) => set('debtDrawnCr')(e.target.value)}
              placeholder="78.00"
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Start date" error={fieldErrors.startDate}>
            <input
              className="i"
              type="date"
              value={v.startDate}
              onChange={(e) => set('startDate')(e.target.value)}
            />
          </Field>
          <Field label="Target end date" error={fieldErrors.targetEndDate}>
            <input
              className="i"
              type="date"
              value={v.targetEndDate}
              onChange={(e) => set('targetEndDate')(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            className="btn-primary"
            type="button"
            disabled={busy || !v.name.trim() || !v.fullName.trim() || (!editing && !v.code.trim())}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : editing ? 'Save the changes' : 'Create the project'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Never mind
          </button>
        </div>
      </div>
    </Card>
  );
}
