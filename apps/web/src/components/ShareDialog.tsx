'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SubjectType } from '@mom/shared';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { OfficerPicker, type PickableOfficer } from '@/components/OfficerPicker';
import { Field, Notice } from '@/components/ui';

/**
 * Sharing something with somebody — `docs/01-PRD.md` §10, ticket P5-11.
 *
 * One dialog for all eight share surfaces, because the decision is the same
 * everywhere: who, on what channel, with what covering note.
 *
 * **It does not send anything yet, and it says so.** The dispatch worker and
 * the e-mail and WhatsApp adapters are P5-01 and P5-02. Until they land the
 * server records the share against the subject and in the audit trail, and
 * this dialog hands back a link and the PDF so the officer can send it
 * themselves. Telling somebody their message went out when it did not is the
 * one outcome worth designing against: they would not follow it up, and the
 * commitment would go unread.
 */

const CHANNELS = [
  { key: 'EMAIL', label: 'Email' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'IN_APP', label: 'In-app' },
] as const;

type Channel = (typeof CHANNELS)[number]['key'];

export interface ShareAttachment {
  label: string;
  href: string;
}

export function ShareDialog({
  subjectType,
  subjectId,
  subjectRef,
  defaultSubject,
  /** A page in the tracker the recipient can open — the meeting, the register row. */
  link,
  /** Documents worth sending with it: the agenda PDF, the minutes. */
  attachments = [],
  onClose,
}: {
  subjectType: SubjectType;
  subjectId: string;
  subjectRef: string;
  defaultSubject: string;
  link?: string;
  attachments?: ShareAttachment[];
  onClose: () => void;
}) {
  const [people, setPeople] = useState<PickableOfficer[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [channels, setChannels] = useState<Channel[]>(['EMAIL']);
  const [subject, setSubject] = useState(defaultSubject);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ recipients: string[]; note: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    // The picker draws from the scoped people list, so it can only ever offer
    // officers this user may share with. The server checks again regardless.
    api<PickableOfficer[]>('/masters/users')
      .then((rows) => live && setPeople(rows))
      .catch((e: unknown) => live && setError(e instanceof ApiError ? e.display : String(e)));
    return () => {
      live = false;
    };
  }, []);

  const absoluteLink = useMemo(() => {
    if (!link) return null;
    return typeof window === 'undefined' ? link : new URL(link, window.location.origin).toString();
  }, [link]);

  const toggleChannel = (key: Channel) =>
    setChannels((cur) => (cur.includes(key) ? cur.filter((c) => c !== key) : [...cur, key]));

  /*
   * The same three rules the DTO enforces, checked here so the officer is
   * told before the round trip rather than after it. The server is still the
   * guard — this is only courtesy.
   */
  const problem =
    selected.length === 0
      ? 'Choose at least one recipient.'
      : channels.length === 0
        ? 'Choose at least one channel.'
        : subject.trim().length < 3
          ? 'Give the message a subject.'
          : null;

  async function submit() {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ recipients: { name: string }[]; deliveryNote: string }>('/share', {
        method: 'POST',
        body: JSON.stringify({
          subjectType,
          subjectId,
          recipientIds: selected,
          channels,
          attachmentFileIds: [],
          subject: subject.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
          // WhatsApp goes out as a pre-approved template; the DTO refuses the
          // channel without one.
          ...(channels.includes('WHATSAPP') ? { templateKey: 'ucf_generic_share' } : {}),
        }),
      });
      setDone({
        recipients: result.recipients.map((r) => r.name),
        note: result.deliveryNote,
      });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.display : 'The share could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!absoluteLink) return;
    try {
      await navigator.clipboard.writeText(absoluteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission refused, or an insecure origin. The link is in a
      // readonly input beside the button, so it can still be selected.
    }
  }

  if (done) {
    return (
      <Modal title="Shared" onClose={onClose} width={620}>
        <div className="grid gap-3.5 p-[18px]">
          <Notice tone="green">
            Recorded against <b>{subjectRef}</b> for {done.recipients.length} recipient
            {done.recipients.length === 1 ? '' : 's'}: {done.recipients.join(', ')}.
          </Notice>
          <Notice>{done.note}</Notice>
          {absoluteLink && <LinkRow link={absoluteLink} copied={copied} onCopy={copyLink} />}
          {attachments.length > 0 && (
            <div className="grid gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Send these with it
              </span>
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <a
                    key={a.href}
                    className="btn-ghost"
                    href={a.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {a.label}
                  </a>
                ))}
              </div>
            </div>
          )}
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
      title={`Share ${subjectRef}`}
      lede="Recipients are limited to the people you can see. Nothing is sent automatically yet."
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2.5">
          {problem && <span className="mr-auto text-[12px] text-muted">{problem}</span>}
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!!problem || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Recording…' : 'Share'}
          </button>
        </div>
      }
    >
      <div className="grid gap-3.5 p-[18px]">
        {error && <Notice tone="red">{error}</Notice>}

        <Notice>
          Automatic delivery over e-mail and WhatsApp arrives with Phase 5. For now this records
          the share against the subject and in the audit trail — use the link and the documents
          below to send it yourself.
        </Notice>

        {/*
          * Not a `Field`: that renders a <label>, and wrapping the picker's
          * own search box or a row of toggle buttons in one makes a click
          * land on the wrong control.
          */}
        <Group label="Recipients" hint="Officers on the projects you can see.">
          {people === null ? (
            <p className="m-0 text-[12.5px] text-muted">Loading the people you can share with…</p>
          ) : (
            <OfficerPicker people={people} selected={selected} onChange={setSelected} multiple />
          )}
        </Group>

        <Group label="Channels" hint="Recorded against the share; delivery follows in Phase 5.">
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const on = channels.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleChannel(c.key)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium ${
                    on
                      ? 'border-navy bg-navy text-white'
                      : 'border-line bg-white text-ink hover:border-navy'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </Group>

        <Field label="Subject" required>
          <input
            className="i"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />
        </Field>

        <Field label="Note" hint="Email only — WhatsApp goes out as a pre-approved template.">
          <textarea
            className="i min-h-[84px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the recipient should know before they open it."
          />
        </Field>

        {absoluteLink && <LinkRow link={absoluteLink} copied={copied} onCopy={copyLink} />}
      </div>
    </Modal>
  );
}

/**
 * A labelled group that is not a `<label>`.
 *
 * `Field` wraps its children in one, which is right for a single input and
 * wrong for anything containing several controls: a click on a channel toggle
 * would also be delivered to the group's first control.
 */
function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <span className="mb-1.5 block text-[11.5px] font-bold text-navy">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

/**
 * The link, in a field that can be selected as well as copied.
 *
 * `navigator.clipboard` is unavailable on an insecure origin, which is exactly
 * how this will be reached on an office LAN before a certificate is put in
 * front of it. Showing the link means the button failing is an inconvenience
 * rather than a dead end.
 */
function LinkRow({
  link,
  copied,
  onCopy,
}: {
  link: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Link</span>
      <div className="flex gap-2">
        <input className="i flex-1 font-mono text-[12px]" readOnly value={link} />
        <button type="button" className="btn-ghost flex-none" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
