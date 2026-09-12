'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';
import { Card, Empty, PageHead } from '@/components/ui';

/**
 * The type chooser.
 *
 * A deliberate stop rather than a dropdown on one form, because the two
 * journeys are genuinely different — one circulates an agenda days in advance
 * and one starts now — and choosing between them is the first real decision.
 * Putting it in a select buried in a form is how people end up scheduling a
 * meeting they meant to start.
 */
export default function NewMeetingPage() {
  const { caps } = useSession();
  const canSchedule = caps.includes('plan_scheduled');
  const canInstant = caps.includes('plan_instant');

  if (!canSchedule && !canInstant) {
    return (
      <>
        <PageHead eyebrow="Meetings" title="New meeting" />
        <Card>
          <Empty>
            Calling a meeting needs the <b>Plan a scheduled meeting</b> or{' '}
            <b>Create an instant meeting</b> capability. Your designation carries neither.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Meetings"
        title="What kind of meeting?"
        lede="The difference is whether an agenda goes out in advance. Everything after the meeting is held is identical."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Choice
          href="/meetings/new/scheduled"
          enabled={canSchedule}
          missing="Plan a scheduled meeting"
          badge="RM"
          title="Scheduled review"
          lede="Planned ahead, with an agenda invitees can add to until it freezes 24 hours before."
          steps={[
            'Details — when, where, who chairs, which projects',
            'Agenda, including items carried forward from last time',
            'Invitees, and the window for their contributions',
            'Confirm — the agenda goes out and is frozen',
          ]}
        />
        <Choice
          href="/meetings/new/instant"
          enabled={canInstant}
          missing="Create an instant meeting"
          badge="IM"
          title="Instant meeting"
          lede="Happening now. A title, a project and one person is enough; everything else can be filled in afterwards."
          steps={[
            'Compose it in one screen',
            'Launch — everyone named is told immediately',
            'End it when you are done',
            'Minute it exactly like a scheduled meeting',
          ]}
          note="Every register, MoM header and export marks it as instant, because a reader has to know no agenda was circulated."
        />
      </div>
    </>
  );
}

function Choice({
  href,
  enabled,
  missing,
  badge,
  title,
  lede,
  steps,
  note,
}: {
  href: string;
  enabled: boolean;
  missing: string;
  badge: string;
  title: string;
  lede: string;
  steps: string[];
  note?: string;
}) {
  const body = (
    <div className="flex h-full flex-col px-[17px] py-4">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-navy font-mono text-[12px] font-bold text-white">
          {badge}
        </span>
        <h3 className="m-0 font-serif text-[17px] font-semibold text-navy">{title}</h3>
      </div>
      <p className="mb-3 mt-0 text-[13px] text-ink">{lede}</p>
      <ol className="m-0 mb-3 flex-1 space-y-1.5 pl-5 text-[12.5px] text-muted">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {note && <p className="mb-3 mt-0 rounded-lg bg-ice px-3 py-2 text-[11.5px] text-navy">{note}</p>}
      {enabled ? (
        <span className="btn-primary self-start">Start</span>
      ) : (
        <span className="text-[11.5px] font-semibold text-muted">
          Needs the “{missing}” capability
        </span>
      )}
    </div>
  );

  if (!enabled) {
    return <Card className="opacity-60">{body}</Card>;
  }
  return (
    <Link href={href} className="block text-inherit no-underline">
      <Card className="h-full transition-shadow hover:shadow-[0_6px_20px_rgba(29,53,87,.12)]">
        {body}
      </Card>
    </Link>
  );
}
