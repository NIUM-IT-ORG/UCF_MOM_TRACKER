'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Card, Field, Notice } from '@/components/ui';

/**
 * Adding an officer, and editing one.
 *
 * Nothing here grants a capability. The designation does that, which is why
 * changing the designation is the consequential field on this form and says
 * so — a transfer changes what somebody may do, and the officer making the
 * change should see that stated rather than infer it.
 *
 * An officer with no password cannot sign in. That is deliberate and is how
 * external invitees exist: they are named in attendance and receive
 * notifications without ever holding an account.
 */
export interface PersonValues {
  name: string;
  initials: string;
  email: string;
  mobile: string;
  designationCode: string;
  departmentId: string;
  seesAllProjects: boolean;
  password: string;
}

const EMPTY: PersonValues = {
  name: '',
  initials: '',
  email: '',
  mobile: '',
  designationCode: '',
  departmentId: '',
  seesAllProjects: false,
  password: '',
};

export function PersonForm({
  personId,
  initial,
  designations,
  departments,
  onSaved,
  onCancel,
}: {
  /** Absent when creating. */
  personId?: string;
  initial?: Partial<PersonValues>;
  designations: { code: string; name: string }[];
  departments: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(personId);
  const [v, setV] = useState<PersonValues>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (key: keyof PersonValues) => (value: string | boolean) =>
    setV((cur) => ({ ...cur, [key]: value }));

  // Initials are what the avatar shows; deriving them saves a field nobody
  // wants to fill, and it stays editable because "Officer A" is not "OA" to
  // everybody.
  function suggestInitials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const body: Record<string, unknown> = {
      name: v.name.trim(),
      initials: (v.initials || suggestInitials(v.name)).toUpperCase(),
      // Sent only when given. An external invitee may have neither, and the
      // server takes an address or nothing - "" is neither.
      ...(v.email.trim() ? { email: v.email.trim().toLowerCase() } : {}),
      ...(v.mobile.trim() ? { mobile: v.mobile.trim() } : {}),
      designationCode: v.designationCode,
      departmentId: v.departmentId,
      seesAllProjects: v.seesAllProjects,
    };
    // A password is only ever set at creation, and only when they are meant to
    // sign in. Changing one is the officer's own business, not an editor's.
    if (!editing && v.password) body.password = v.password;

    try {
      await api(editing ? `/users/${personId}` : '/users', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const details = err.details as { path?: string; message?: string }[] | undefined;
        if (Array.isArray(details)) {
          setFieldErrors(
            Object.fromEntries(details.map((d) => [d.path ?? '', d.message ?? 'Not accepted.'])),
          );
        }
      }
      setError(err instanceof ApiError ? err.display : 'Could not save the officer.');
    } finally {
      setBusy(false);
    }
  }

  /*
   * Contact details are required of anyone who signs in, and optional for
   * anyone who does not.
   *
   * Email IS the login identifier, so an officer saved without one would be
   * accepted and then locked out at the door with nothing on screen to
   * explain it. External invitees are the exception the PRD names - "No
   * login" - and on the day they are added their number is frequently not
   * known. The server enforces exactly this rule; the form only says so
   * earlier.
   */
  const signsIn = v.designationCode !== 'EXT';
  const ready =
    v.name.trim().length > 1 &&
    (!signsIn || (v.email.trim().length > 3 && v.mobile.trim().length > 7)) &&
    v.designationCode &&
    v.departmentId;

  return (
    <Card
      title={editing ? 'Edit the officer' : 'Add an officer'}
      tag="Capability comes from the designation"
    >
      <div className="grid gap-3.5 px-[17px] py-4">
        {error && <Notice tone="red">{error}</Notice>}

        <div className="grid gap-3.5 sm:grid-cols-[2fr_1fr]">
          <Field label="Name" required error={fieldErrors.name}>
            <input
              className="i"
              value={v.name}
              onChange={(e) => set('name')(e.target.value)}
              placeholder="Officer G"
            />
          </Field>
          <Field label="Initials" error={fieldErrors.initials} hint="For the avatar. Two letters.">
            <input
              className="i"
              maxLength={3}
              value={v.initials}
              onChange={(e) => set('initials')(e.target.value.toUpperCase())}
              placeholder={suggestInitials(v.name) || 'OG'}
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label="Email"
            required={signsIn}
            error={fieldErrors.email}
            hint={
              signsIn
                ? 'This is the sign-in identity.'
                : 'Optional - an external invitee does not sign in. Without one, nothing can be emailed to them.'
            }
          >
            <input
              className="i"
              type="email"
              value={v.email}
              onChange={(e) => set('email')(e.target.value)}
              placeholder="officer.g@example.gov"
            />
          </Field>
          <Field
            label="Mobile"
            required={signsIn}
            error={fieldErrors.mobile}
            hint={
              signsIn
                ? 'Where WhatsApp and SMS go.'
                : 'Optional. Without one, no WhatsApp or SMS can reach them.'
            }
          >
            <input
              className="i"
              value={v.mobile}
              onChange={(e) => set('mobile')(e.target.value)}
              placeholder="+91 9XXXXXXXXX"
            />
          </Field>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label="Designation"
            required
            error={fieldErrors.designationCode}
            hint="This alone decides what they may do."
          >
            <select
              className="i"
              value={v.designationCode}
              onChange={(e) => set('designationCode')(e.target.value)}
            >
              <option value="">Choose one…</option>
              {designations.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Department" required error={fieldErrors.departmentId}>
            <select
              className="i"
              value={v.departmentId}
              onChange={(e) => set('departmentId')(e.target.value)}
            >
              <option value="">Choose one…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
          <input
            type="checkbox"
            className="mt-[3px]"
            checked={v.seesAllProjects}
            onChange={(e) => set('seesAllProjects')(e.target.checked)}
          />
          <span>
            <b className="text-navy">Sees every project</b> — for head-office officers. Everyone
            else sees only the projects they are mapped to, and that mapping is set from the
            officer&apos;s row on this screen.
          </span>
        </label>

        {!editing && (
          <Field
            label="Password"
            error={fieldErrors.password}
            hint="Leave it empty for someone who should never sign in — an external invitee who only needs notifications. At least 12 characters otherwise."
          >
            <input
              className="i"
              type="password"
              autoComplete="new-password"
              value={v.password}
              onChange={(e) => set('password')(e.target.value)}
            />
          </Field>
        )}

        <div className="flex flex-wrap gap-2.5">
          <button
            className="btn-primary"
            type="button"
            disabled={busy || !ready}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : editing ? 'Save the changes' : 'Add the officer'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            Never mind
          </button>
        </div>
      </div>
    </Card>
  );
}
