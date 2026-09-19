'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ACTION_STATUS_LABEL,
  CLARIFICATION_STATUS_LABEL,
  PRIORITY_LABEL,
} from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { ItemRow } from '@/lib/meetings';
import { Avatar, Empty, Field, ItemStatusChip, Notice, ProjectTag } from '@/components/ui';
import { WhoCan } from '@/components/WhoCan';

/**
 * One item, and the moves available on it.
 *
 * The register is where an action is actually worked, so the buttons live
 * here rather than on a separate screen: an owner reports it complete, a
 * senior officer confirms it or sends it back, a clarification is answered
 * and then closed by whoever asked.
 *
 * Two rules from the brief are visible in the wording, because they surprise
 * people otherwise:
 *
 * - **Nobody confirms their own work.** Under Review exists for exactly that,
 *   and the guard is on the server; this screen only explains it.
 * - **Joint ownership is real.** Every named officer is equally accountable
 *   and any one of them may report it complete.
 */
interface ItemDetail extends ItemRow {
  updates: {
    id: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    createdAt: string;
    actor: { id: string; name: string; initials: string } | null;
  }[];
}

export function ItemDrawer({
  itemId,
  onClose,
  onChanged,
}: {
  itemId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user, caps } = useSession();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<'complete' | 'send-back' | 'respond' | 'update' | null>(null);
  const [text, setText] = useState('');

  const load = useCallback(() => {
    api<ItemDetail>(`/items/${itemId}`)
      .then((i) => {
        setItem(i);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.display : 'Could not load the item.'));
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes it — a drawer that traps you is worse than no drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(path: string, body?: unknown) {
    setBusy(path);
    setError(null);
    try {
      await api(`/items/${itemId}/${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setAsking(null);
      setText('');
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const isAction = item?.type === 'ACTION';
  const mine = Boolean(item?.owners.some((o) => o.user.id === user?.id));
  const iRaisedIt = item?.raisedBy.id === user?.id;
  const canConfirm = caps.includes('confirm_completion');
  const canRespond = caps.includes('respond_clarification');

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[rgba(16,31,48,.34)]"
      role="dialog"
      aria-modal="true"
      aria-label={item ? `${item.ref} — ${item.description}` : 'Item'}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="h-full w-full max-w-[640px] overflow-y-auto bg-[#F7F9FC] shadow-[-8px_0_28px_rgba(16,31,48,.18)]">
        <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-white px-[17px] py-3">
          <b className="font-mono text-[12.5px] text-navy">{item?.ref ?? '…'}</b>
          {item && (
            <ItemStatusChip
              type={item.type}
              status={(item.actionStatus ?? item.clarificationStatus) as never}
              isActive={item.isActive}
            />
          )}
          <button className="btn-ghost ml-auto" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid gap-4 p-[17px]">
          {error && <Notice tone="red">{error}</Notice>}

          {!item ? (
            <Empty>Loading…</Empty>
          ) : (
            <>
              <section className="rounded-[12px] border border-line bg-white px-[17px] py-4">
                <h3 className="m-0 font-serif text-[16px] font-semibold text-navy">
                  {item.description}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <ProjectTag code={item.project.code} />
                  <span>
                    raised in{' '}
                    <Link href={`/meetings/${item.meeting.id}`}>{item.meeting.code}</Link> by{' '}
                    {item.raisedBy.name}
                  </span>
                  {item.carryCount > 0 && (
                    <span className="rounded-md bg-[#FFF2E0] px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#A66A12]">
                      carried forward {item.carryCount}×
                    </span>
                  )}
                </div>

                {!item.isActive && (
                  <Notice tone="amber">
                    <b>Not live yet.</b> This was raised while minuting and becomes active — owners
                    told, clock running — when the signed MoM is circulated.
                  </Notice>
                )}

                <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {isAction ? (
                    <>
                      <Fact label="Due" value={formatDate(item.dueDate)} />
                      <Fact
                        label="Priority"
                        value={item.priority ? PRIORITY_LABEL[item.priority] : '—'}
                      />
                      <Fact
                        label="Status"
                        value={
                          item.actionStatus ? ACTION_STATUS_LABEL[item.actionStatus] : '—'
                        }
                      />
                      <Fact
                        label="Responsible"
                        value={
                          item.owners.length === 0 ? (
                            'nobody named'
                          ) : (
                            <span className="flex flex-wrap gap-2">
                              {item.owners.map((o) => (
                                <span key={o.user.id} className="flex items-center gap-1.5">
                                  <Avatar initials={o.user.initials} size={22} />
                                  <span className="text-[12.5px]">{o.user.name}</span>
                                </span>
                              ))}
                            </span>
                          )
                        }
                      />
                    </>
                  ) : (
                    <>
                      <Fact
                        label="Status"
                        value={
                          item.clarificationStatus
                            ? CLARIFICATION_STATUS_LABEL[item.clarificationStatus]
                            : '—'
                        }
                      />
                      <Fact
                        label="Responded by"
                        value={item.respondedBy?.name ?? 'nobody yet'}
                      />
                    </>
                  )}
                </dl>

                {item.remarks && (
                  <p className="mb-0 mt-3 rounded-[10px] bg-[#F4F7FB] px-3 py-2.5 text-[12.5px] text-ink">
                    {item.remarks}
                  </p>
                )}

                {item.owners.length > 1 && (
                  <p className="mb-0 mt-3 text-[11.5px] text-muted">
                    All named officers are jointly and equally accountable. Any one of them may
                    report it complete.
                  </p>
                )}
              </section>

              {/* ── what this officer can do now ──────────────────────── */}
              <section className="rounded-[12px] border border-line bg-white px-[17px] py-4">
                <h4 className="mb-2.5 mt-0 text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-muted">
                  What happens next
                </h4>

                {asking === null && (
                  <div className="flex flex-wrap gap-2.5">
                    {isAction &&
                      item.isActive &&
                      mine &&
                      ['IN_PROGRESS', 'DELAYED'].includes(item.actionStatus ?? '') && (
                        <>
                          <button
                            className="btn-primary"
                            type="button"
                            onClick={() => setAsking('complete')}
                          >
                            Report it complete
                          </button>
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => setAsking('update')}
                          >
                            Add an update
                          </button>
                        </>
                      )}

                    {isAction && item.actionStatus === 'UNDER_REVIEW' && canConfirm && !mine && (
                      <>
                        <button
                          className="btn-primary"
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void act('confirm')}
                        >
                          {busy === 'confirm' ? 'Confirming…' : 'Confirm it as completed'}
                        </button>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => setAsking('send-back')}
                        >
                          Send it back
                        </button>
                      </>
                    )}

                    {isAction && item.actionStatus === 'UNDER_REVIEW' && mine && (
                      <span className="text-[12.5px] text-muted">
                        Reported complete and waiting to be confirmed. Nobody confirms their own
                        work, so this one is not yours to close.
                      </span>
                    )}

                    {isAction && item.actionStatus === 'UNDER_REVIEW' && !canConfirm && !mine && (
                      <WhoCan
                        capability="confirm_completion"
                        lead="Reported complete, waiting to be confirmed."
                        who="That is their step"
                        offerToGrant={false}
                      />
                    )}

                    {!isAction && item.clarificationStatus === 'OPEN' && canRespond && (
                      <button
                        className="btn-primary"
                        type="button"
                        onClick={() => setAsking('respond')}
                      >
                        Respond
                      </button>
                    )}

                    {!isAction && item.clarificationStatus === 'RESPONDED' && iRaisedIt && (
                      <button
                        className="btn-primary"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void act('close')}
                      >
                        {busy === 'close' ? 'Closing…' : 'The answer will do — close it'}
                      </button>
                    )}

                    {!isAction && item.clarificationStatus === 'RESPONDED' && !iRaisedIt && (
                      <span className="text-[12.5px] text-muted">
                        Answered. {item.raisedBy.name} raised it and decides whether the answer
                        will do.
                      </span>
                    )}

                    {(item.actionStatus === 'COMPLETED' ||
                      item.clarificationStatus === 'CLOSED') && (
                      <span className="text-[12.5px] text-muted">
                        Closed. It stays in the register and in the MoM that raised it.
                      </span>
                    )}

                    {isAction && item.isActive && !mine && item.actionStatus !== 'UNDER_REVIEW' && (
                      <span className="text-[12.5px] text-muted">
                        With{' '}
                        {item.owners.map((o) => o.user.name).join(', ') || 'nobody — no owner is named'}
                        . Only a named officer reports it complete.
                      </span>
                    )}
                  </div>
                )}

                {asking !== null && (
                  <div className="grid gap-3">
                    <Field
                      label={
                        asking === 'complete'
                          ? 'What was done'
                          : asking === 'send-back'
                            ? 'Why it is going back'
                            : asking === 'respond'
                              ? 'The answer'
                              : 'The update'
                      }
                      required
                      hint={
                        asking === 'complete'
                          ? 'This goes on the record and is what the confirming officer reads.'
                          : asking === 'send-back'
                            ? 'Be specific — this is what the officer has to act on.'
                            : undefined
                      }
                    >
                      <textarea
                        className="i min-h-[84px]"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        autoFocus
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        className="btn-primary"
                        type="button"
                        disabled={busy !== null || text.trim().length < 3}
                        onClick={() => {
                          if (asking === 'complete') void act('report-complete', { note: text.trim() });
                          else if (asking === 'update') void act('updates', { note: text.trim() });
                          else if (asking === 'send-back') void act('send-back', { reason: text.trim() });
                          else void act('respond', { response: text.trim() });
                        }}
                      >
                        {busy ? 'Sending…' : 'Save it'}
                      </button>
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={() => {
                          setAsking(null);
                          setText('');
                        }}
                      >
                        Never mind
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-[12px] border border-line bg-white px-[17px] py-4">
                <h4 className="mb-2.5 mt-0 text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-muted">
                  History
                </h4>
                {item.updates.length === 0 ? (
                  <p className="m-0 text-[12.5px] text-muted">
                    Nothing recorded against it yet beyond its creation.
                  </p>
                ) : (
                  <ol className="m-0 list-none space-y-2.5 p-0">
                    {item.updates.map((u) => (
                      <li key={u.id} className="border-b border-line pb-2.5 last:border-0">
                        <div className="flex flex-wrap items-baseline gap-2 text-[12px]">
                          <b className="text-navy">
                            {u.fromStatus && u.toStatus
                              ? `${statusLabel(u.fromStatus)} → ${statusLabel(u.toStatus)}`
                              : 'Update'}
                          </b>
                          <span className="text-muted">{u.actor?.name ?? 'System'}</span>
                          <span className="text-muted">· {formatDate(u.createdAt)}</span>
                        </div>
                        {u.note && <p className="mb-0 mt-1 text-[12.5px] text-ink">{u.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A stored status, in the officer's language.
 *
 * The trail holds the enum value, because that is what the machine moved
 * between. Nobody reads UNDER_REVIEW as words, so it is translated here
 * rather than stored pre-formatted — the labels can then be reworded without
 * rewriting history.
 */
function statusLabel(value: string): string {
  const labels: Record<string, string> = { ...ACTION_STATUS_LABEL, ...CLARIFICATION_STATUS_LABEL };
  return labels[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[9.5px] font-bold uppercase tracking-[1.2px] text-muted">{label}</dt>
      <dd className="m-0 mt-1 text-[13px] font-semibold text-navy">{value}</dd>
    </div>
  );
}
