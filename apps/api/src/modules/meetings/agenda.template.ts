import {
  ACTION_STATUS_LABEL,
  CLARIFICATION_STATUS_LABEL,
  MEETING_CATEGORY_LABEL,
  MEETING_TYPE_LABEL,
  PRIORITY_LABEL,
  type ActionStatus,
  type ClarificationStatus,
  type MeetingCategory,
  type MeetingStage,
  type MeetingType,
  type Priority,
} from '@mom/shared';
import { PAPER_STYLE, esc, masthead, shortDate, stamp } from '../../common/print/paper.js';

/**
 * The agenda document. One template, one output — the same rule the minutes
 * follow, and for the same reason: the on-screen preview, the print view and
 * the server-side PDF all render exactly this string, so the copy an officer
 * reads on a phone and the copy that reaches their inbox cannot disagree
 * about what is being discussed.
 *
 * `docs/03-API-SPEC.md` specifies `GET /meetings/:id/agenda.pdf`; `docs/06`
 * attaches it to MTG-01, MTG-03 and MTG-05, and offers it from the Share
 * control on the meeting's Agenda tab. This is that document.
 *
 * It is deliberately shorter than the minutes. An agenda is read before a
 * meeting, usually in a hurry: what is being discussed, when, where, who is
 * expected, what was left unfinished last time, and which papers to read. The
 * tabled papers are listed rather than merged — an agenda that arrives as a
 * forty-page bundle does not get read, and the documents are a click away in
 * the system.
 */

export interface AgendaDocumentData {
  meeting: {
    code: string;
    title: string;
    type: MeetingType;
    category: MeetingCategory;
    stage: MeetingStage;
    meetingDate: Date;
    startTime: string;
    endTime: string;
    venue: string;
    vcLink: string | null;
    projects: { code: string; name: string; fullName: string }[];
    chair: { name: string; designationName: string } | null;
    /** After this instant invitees may read the agenda but not add to it. */
    agendaFreezeAt: Date | null;
    confirmedAt: Date | null;
    cancelledReason: string | null;
  };
  items: {
    ordinal: number;
    text: string;
    projectName: string | null;
    addedByName: string | null;
    isCarryBlock: boolean;
    isDeferred: boolean;
    /**
     * The unfinished commitments pulled into agenda item 0.
     *
     * Printed in full rather than counted. "5 items carried forward" tells a
     * reader nothing they can prepare for; the refs, the owners and the dates
     * are what somebody arriving at the meeting needs in front of them.
     */
    carried: {
      ref: string;
      description: string;
      owners: string[];
      dueDate: Date | null;
      revisedDue: Date | null;
      priority: Priority | null;
      statusLabel: string;
      carryCount: number;
    }[];
  }[];
  invitees: {
    name: string;
    designationName: string;
    departmentName: string;
    isChair: boolean;
  }[];
  /** Papers circulated with the agenda — named here, held in the system. */
  papers: { name: string; fileName: string; typeLabel: string }[];
  emblemDataUri: string | null;
  cdmaDataUri: string | null;
  generatedAt: Date;
}

/**
 * An agenda that has not been confirmed is still being assembled, and saying
 * so on the page matters: an invitee who prints a draft two days early and
 * turns up to discuss item 4 — since removed — has been misled by a document
 * that looked final. Confirmation is what freezes it, so confirmation is what
 * removes the watermark.
 */
export function agendaWatermark(stage: MeetingStage): string | null {
  if (stage === 'CANCELLED') return 'CANCELLED';
  return stage === 'PLANNED' || stage === 'AGENDA' || stage === 'INVITEES' || stage === 'INVITEE_INPUTS'
    ? 'DRAFT'
    : null;
}

export function renderAgendaDocument(data: AgendaDocumentData): string {
  const { meeting } = data;
  const watermark = agendaWatermark(meeting.stage);
  const points = data.items.filter((i) => !i.isCarryBlock);
  /*
   * An empty carry block is a real state: `carry` upserts the block, so one
   * can exist with nothing under it after the last item was closed. It must
   * not count towards the numbering, or the agenda opens at "2." with no
   * section 1 above it.
   */
  const carryBlock = data.items.find((i) => i.isCarryBlock && i.carried.length > 0) ?? null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(meeting.code)} — Agenda — ${esc(meeting.title)}</title>
<style>${STYLE}</style>
</head>
<body class="${watermark ? 'draft' : 'final'}">
${watermark ? `<div class="watermark" aria-hidden="true"><span>${esc(watermark)}</span></div>` : ''}
<main class="sheet">
<div class="inner">

  ${masthead('Agenda', data.emblemDataUri, data.cdmaDataUri)}

  <table class="facts">
    <tbody>
      <tr>
        <th>Meeting</th>
        <td colspan="3"><b>${esc(meeting.title)}</b></td>
      </tr>
      <tr>
        <th>Date</th><td>${shortDate(meeting.meetingDate)}</td>
        <th>Time</th><td>${esc(meeting.startTime)} – ${esc(meeting.endTime)} hrs</td>
      </tr>
      <tr>
        <th>Chairperson</th>
        <td>${meeting.chair ? `${esc(meeting.chair.name)} · ${esc(meeting.chair.designationName)}` : '—'}</td>
        <th>Venue</th>
        <td>${esc(meeting.venue)}${
          meeting.vcLink ? `<span class="vc">${esc(meeting.vcLink)}</span>` : ''
        }</td>
      </tr>
      <tr>
        <th>Type of meeting</th>
        <td>${esc(MEETING_CATEGORY_LABEL[meeting.category])} · ${esc(MEETING_TYPE_LABEL[meeting.type])} meeting</td>
        <th>Projects</th>
        <td>${meeting.projects.map((p) => esc(p.fullName || p.name)).join('<br />')}</td>
      </tr>
      <tr>
        <th>Reference</th>
        <td colspan="3" class="mono">${esc(meeting.code)}</td>
      </tr>
    </tbody>
  </table>

  ${
    meeting.stage === 'CANCELLED'
      ? `<p class="note cancelled"><b>This meeting was cancelled.</b>${
          meeting.cancelledReason ? ` ${esc(meeting.cancelledReason)}` : ''
        }</p>`
      : ''
  }

  ${
    meeting.type === 'INSTANT'
      ? `<p class="note instant"><b>Instant meeting.</b> No agenda was circulated in advance;
         the points below were taken as raised.</p>`
      : ''
  }

  ${carryBlock ? renderCarryForward(carryBlock) : ''}

  <h2>${carryBlock ? '2' : '1'}. Agenda</h2>
  ${
    points.length === 0
      ? '<p class="lede">No agenda points have been added yet.</p>'
      : `<table class="grid">
    <thead><tr><th class="n">#</th><th>Agenda point</th><th>Project</th><th>Raised by</th></tr></thead>
    <tbody>
      ${points
        .map(
          (a) => `<tr${a.isDeferred ? ' class="deferred"' : ''}>
            <td class="n">${a.ordinal}</td>
            <td>${esc(a.text)}${a.isDeferred ? ' <span class="tag">deferred</span>' : ''}</td>
            <td>${esc(a.projectName ?? '—')}</td>
            <td>${esc(a.addedByName ?? '—')}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
  }

  ${renderInvitees(data, carryBlock ? 3 : 2)}

  ${renderPapers(data, carryBlock ? 4 : 3)}

  ${
    /*
     * The freeze is the one instruction on this page an invitee has to act
     * on, so it is stated in words and dates rather than left to be inferred
     * from a stage name they have never seen.
     */
    meeting.type === 'SCHEDULED' && meeting.agendaFreezeAt && !meeting.confirmedAt
      ? `<p class="note">${
          meeting.agendaFreezeAt.getTime() <= data.generatedAt.getTime()
            ? `Contributions to this agenda closed on <b>${esc(stamp(meeting.agendaFreezeAt))}</b>.
               The coordinator can still amend it until the meeting is confirmed.`
            : `Invitees may add points to this agenda until <b>${esc(stamp(meeting.agendaFreezeAt))}</b>.`
        }</p>`
      : ''
  }

  <footer class="foot">
    <span>${esc(meeting.code)} · ${esc(meeting.title)}</span>
    <span>${
      watermark === 'DRAFT'
        ? `Draft agenda · not yet confirmed · generated ${shortDate(data.generatedAt)}`
        : `Agenda${
            meeting.confirmedAt ? ` confirmed ${shortDate(meeting.confirmedAt)}` : ''
          } · generated ${shortDate(data.generatedAt)}`
    }</span>
  </footer>
</div>
</main>
</body>
</html>`;
}

/**
 * Agenda item 0 — what was left unfinished, with live status.
 *
 * `docs/01-PRD.md` §7 makes this the opening item of every meeting, and the
 * point of the product: an action that quietly rolls from cycle to cycle is
 * exactly what the tracker exists to stop. So it is printed first, and the
 * carry count is shown when an item has been round more than once, because
 * "carried 3 times" is the fact that ought to provoke a question in the room.
 */
function renderCarryForward(block: AgendaDocumentData['items'][number]): string {
  if (block.carried.length === 0) return '';
  return `
  <h2>1. Review of items from previous meetings</h2>
  <p class="lede">${block.carried.length} item${block.carried.length === 1 ? '' : 's'} carried forward, with status as at generation.</p>
  <table class="grid">
    <thead><tr>
      <th class="n">#</th><th>Ref</th><th>Item</th><th>Responsible</th>
      <th>Due</th><th>Priority</th><th>Status</th>
    </tr></thead>
    <tbody>
      ${block.carried
        .map(
          (c, i) => `<tr>
            <td class="n">${i + 1}</td>
            <td class="mono">${esc(c.ref)}${
              c.carryCount > 1 ? `<span class="carried">carried ${c.carryCount}×</span>` : ''
            }</td>
            <td>${esc(c.description)}</td>
            <td>${c.owners.length ? esc(c.owners.join(', ')) : '—'}</td>
            <td>${
              c.revisedDue
                ? `${shortDate(c.revisedDue)}<span class="was">revised</span>`
                : c.dueDate
                  ? shortDate(c.dueDate)
                  : '—'
            }</td>
            <td>${c.priority ? esc(PRIORITY_LABEL[c.priority]) : '—'}</td>
            <td>${esc(c.statusLabel)}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

function renderInvitees(data: AgendaDocumentData, n: number): string {
  return `
  <h2>${n}. Invitees</h2>
  ${
    data.invitees.length === 0
      ? '<p class="lede">No invitees have been added yet.</p>'
      : `<table class="grid">
    <thead><tr><th class="n">#</th><th>Name</th><th>Designation</th><th>Department</th></tr></thead>
    <tbody>
      ${data.invitees
        .map(
          (p, i) => `<tr>
            <td class="n">${i + 1}</td>
            <td>${esc(p.name)}${p.isChair ? ' <b>(Chair)</b>' : ''}</td>
            <td>${esc(p.designationName)}</td>
            <td>${esc(p.departmentName)}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
  }`;
}

/**
 * The papers, named but not attached.
 *
 * The minutes merge their annexures, because a signed minute is the record
 * and has to be self-contained. An agenda is a notice: listing what to read,
 * with the file name so it can be found, keeps it to the page or two that
 * actually gets read before a meeting.
 */
function renderPapers(data: AgendaDocumentData, n: number): string {
  if (data.papers.length === 0) return '';
  return `
  <h2>${n}. Papers for this meeting</h2>
  <table class="grid">
    <thead><tr><th class="n">#</th><th>Paper</th><th>Type</th><th>File</th></tr></thead>
    <tbody>
      ${data.papers
        .map(
          (d, i) => `<tr>
            <td class="n">${i + 1}</td>
            <td>${esc(d.name)}</td>
            <td>${esc(d.typeLabel)}</td>
            <td class="mono">${esc(d.fileName)}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p class="note">These papers are held against this meeting in the tracker and can be downloaded there.</p>`;
}

/** The status of a carried item, whichever kind it is. */
export function carriedStatusLabel(
  actionStatus: ActionStatus | null,
  clarificationStatus: ClarificationStatus | null,
): string {
  if (actionStatus) return ACTION_STATUS_LABEL[actionStatus];
  if (clarificationStatus) return CLARIFICATION_STATUS_LABEL[clarificationStatus];
  return '—';
}

const STYLE = `
${PAPER_STYLE}

/* ── the agenda's own rules ─────────────────────────────────────────── */

.watermark { position:fixed; inset:0; display:grid; place-items:center; pointer-events:none; z-index:5; }
.watermark span { font:800 118px/1 "Bitter",Georgia,serif; letter-spacing:.14em; color:#C3372B;
  opacity:.085; transform:rotate(-24deg); border:9px solid currentColor; border-radius:26px;
  padding:18px 44px; }

.note.cancelled { border-left-color:#C3372B; color:#8E2F26; margin:14px 0 0; }

/* A deferred point stays on the page — removing it would leave the agenda
   shorter than the one that was circulated — but it should not read as
   something to prepare for. */
.deferred td { color:var(--muted); }

/* Both sit under the value they qualify rather than beside it, so the column
   stays narrow enough for seven columns to fit the page. */
.carried, .was { display:block; font-size:9px; font-weight:700; text-transform:uppercase;
  letter-spacing:.5px; color:var(--accent); }
.was { color:var(--muted); }
`;
