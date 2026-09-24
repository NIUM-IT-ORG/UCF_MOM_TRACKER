'use client';

import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, Notice } from '@/components/ui';

/**
 * An administrator setting somebody's password.
 *
 * There is no "forgotten password" link and there cannot be one yet: that
 * needs a mail provider and Phase 5 has not been built. So this is the only
 * way an officer who cannot sign in ever gets back in, and the only way an
 * account created without a password becomes usable at all.
 *
 * The new password is shown rather than hidden. An administrator has to read
 * it out or write it down to hand over, and a masked field they cannot check
 * is how somebody ends up passing on a password with a typo in it — to a
 * person who then cannot sign in and has to ask again.
 */
export function SetPassword({
  person,
  onClose,
  onDone,
}: {
  person: { id: string; name: string; email: string | null; accountState: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ activated: boolean; sessionsRevoked: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const tooShort = password.trim().length > 0 && password.trim().length < PASSWORD_MIN_LENGTH;
  const ready = password.trim().length >= PASSWORD_MIN_LENGTH;

  /**
   * A suggestion, so the usual case is one click and not one invention.
   *
   * Three words and a number. Well past the minimum on purpose: the rule is
   * the floor, not the target, and this is read down a telephone rather than
   * typed from a password manager.
   */
  function suggest() {
    const words = [
      'harbour', 'lantern', 'marigold', 'compass', 'thicket', 'quarry',
      'brindle', 'saffron', 'kestrel', 'juniper', 'cobalt', 'meadow',
    ];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(Math.random() * 90) + 10;
    setPassword(`${pick()}-${pick()}-${pick()}-${n}`);
    setError(null);
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ activated: boolean; sessionsRevoked: number }>(
        `/users/${person.id}/password`,
        { method: 'POST', body: JSON.stringify({ newPassword: password.trim() }) },
      );
      setDone(result);
      onDone();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.display : 'The password could not be set.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused, or an insecure origin. The password is on screen
      // in a plain field, so it can still be selected and copied by hand.
    }
  }

  if (done) {
    return (
      <Modal title="Password set" onClose={onClose} width={560}>
        <div className="grid gap-3 p-[18px]">
          <Notice tone="green">
            <b>{person.name}</b> can sign in with this password.
            {done.activated && ' Their account has been activated.'}
            {done.sessionsRevoked > 0 &&
              ` ${done.sessionsRevoked} existing session${
                done.sessionsRevoked === 1 ? ' was' : 's were'
              } signed out.`}
          </Notice>
          <Field label="Hand this over" hint="It is not stored anywhere you can read it again.">
            <div className="flex gap-2">
              <input className="i flex-1 font-mono text-[13px]" readOnly value={password.trim()} />
              <button type="button" className="btn-ghost flex-none" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </Field>
          <p className="mb-0 text-[11.5px] text-muted">
            Close this and it is gone — only the hash is kept, so nobody, including an
            administrator, can read it back. Setting a new one is the only way if it is lost.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-[18px] py-3">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Set a password for ${person.name}`}
      lede={person.email ?? 'This person has no email address, so they cannot sign in.'}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex items-center gap-2.5">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Setting…' : 'Set the password'}
          </button>
        </div>
      }
    >
      <div className="grid gap-3.5 p-[18px]">
        {error && <Notice tone="red">{error}</Notice>}

        <Notice tone="amber">
          This signs {person.name} out everywhere and clears any lockout.
          {person.accountState === 'INVITE_ONLY' &&
            ' It also activates their account, which has been waiting for a password.'}
        </Notice>

        <Field
          label="New password"
          required
          error={tooShort ? `At least ${PASSWORD_MIN_LENGTH} characters.` : null}
          hint="Shown, not hidden — you have to read it out to hand it over."
        >
          <div className="flex gap-2">
            <input
              className="i flex-1 font-mono text-[13px]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn-ghost flex-none" onClick={suggest}>
              Suggest
            </button>
          </div>
        </Field>

        <p className="mb-0 text-[11.5px] text-muted">
          There is no “forgotten password” email yet — that needs the notification work in Phase
          5 — so this is how somebody who cannot sign in gets back in.
        </p>
      </div>
    </Modal>
  );
}
