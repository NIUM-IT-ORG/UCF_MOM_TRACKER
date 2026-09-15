'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { Card, Notice } from '@/components/ui';
import type { MeetingDetail } from '@/lib/meetings';

/**
 * Generating the draft MoM — the step between writing the minutes and the
 * approval cycle.
 *
 * It was missing from the interface entirely. The endpoint existed, the
 * minutes editor said "then generate the MoM" in prose, and the MoM tab said
 * "No MoM has been generated yet. Record the minutes first" — to somebody who
 * had just recorded them. Every screen pointed at a button that was nowhere,
 * so the whole approval half of the product was unreachable and the minutes
 * looked broken because nothing downstream of them could be seen.
 *
 * The server refuses without full attendance and some minutes, so both are
 * stated here before the click rather than discovered after it.
 */
export function GenerateMom({
  meeting,
  canGenerate,
  onGenerated,
}: {
  meeting: MeetingDetail;
  canGenerate: boolean;
  onGenerated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unmarked = meeting.invitees.filter((i) => !i.attendance).map((i) => i.user.name);
  const hasMinutes = Boolean(meeting.minutes?.id);
  const held = ['HELD', 'MINUTED', 'CLOSED'].includes(meeting.stage);
  const ready = held && unmarked.length === 0 && hasMinutes;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meeting.id}/mom/generate`, { method: 'POST' });
      onGenerated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.display : 'Could not generate the MoM.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Minutes of meeting" tag="Not generated yet">
      <div className="px-[17px] py-4">
        {error && <Notice tone="red">{error}</Notice>}

        <p className="mt-0 text-[13px] text-ink">
          The MoM is the document that goes for approval and signature. It is built from the
          minutes and the attendance sheet — nothing is typed twice.
        </p>

        <ul className="my-3 space-y-1.5 pl-0 text-[12.5px]">
          <Requirement met={held}>The meeting has been held</Requirement>
          <Requirement met={unmarked.length === 0}>
            {unmarked.length === 0
              ? 'Attendance recorded for everyone invited'
              : `Attendance still unmarked for ${unmarked.join(', ')}`}
          </Requirement>
          <Requirement met={hasMinutes}>
            {hasMinutes ? 'The minutes are written' : 'No minutes written yet'}
          </Requirement>
        </ul>

        {!canGenerate && (
          <Notice>
            Generating the MoM needs the <b>Record minutes</b> capability. Your designation does
            not carry it.
          </Notice>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            className="btn-primary"
            type="button"
            onClick={() => void generate()}
            disabled={!canGenerate || !ready || busy}
          >
            {busy ? 'Generating…' : 'Generate the draft MoM'}
          </button>
          <Link className="btn-ghost" href={`/meetings/${meeting.id}/minutes`}>
            {hasMinutes ? 'Edit the minutes' : 'Write the minutes'}
          </Link>
        </div>

        <p className="mb-0 mt-3 text-[11.5px] text-muted">
          Generating changes nothing that is live. The actions raised here stay inert until the
          signed MoM is circulated.
        </p>
      </div>
    </Card>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 list-none">
      <span
        aria-hidden="true"
        className={`mt-[3px] inline-block h-[14px] w-[14px] shrink-0 rounded-full text-center text-[9px] font-bold leading-[14px] ${
          met ? 'bg-[#DFF3E6] text-[#1B7F44]' : 'bg-[#FDECEC] text-[#B02A2A]'
        }`}
      >
        {met ? '✓' : '!'}
      </span>
      <span className={met ? 'text-muted' : 'text-navy'}>{children}</span>
    </li>
  );
}
