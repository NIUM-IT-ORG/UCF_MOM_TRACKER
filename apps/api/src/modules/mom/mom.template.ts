import {
  ACTION_STATUS_LABEL,
  ATTENDANCE_LABEL,
  CLARIFICATION_STATUS_LABEL,
  MEETING_CATEGORY_LABEL,
  MEETING_TYPE_LABEL,
  MOM_WATERMARK,
  PRIORITY_LABEL,
  type ActionStatus,
  type AttendanceMark,
  type ClarificationStatus,
  type MeetingCategory,
  type MeetingType,
  type MomState,
  type Priority,
} from '@mom/shared';
import { PAPER_STYLE, esc, masthead, shortDate, stamp } from '../../common/print/paper.js';

/**
 * The MoM document. One template, one output.
 *
 * docs/03-API-SPEC.md: "The PDF renderer must consume the same HTML the UI
 * previews. One template file, one output. A second renderer is how the printed
 * copy and the screen copy drift apart." So this function is the only thing in
 * the product that knows what a MoM looks like — the on-screen preview, the
 * print view and any future server-side PDF all render exactly this string.
 *
 * The seven sections and the header block follow the reference document in
 * `prototype/Sample-MoM-draft.pdf`, which is the client's accepted layout.
 */

export interface MomDocumentData {
  meeting: {
    code: string;
    title: string;
    type: MeetingType;
    category: MeetingCategory;
    meetingDate: Date;
    startTime: string;
    endTime: string;
    venue: string;
    vcLink: string | null;
    projects: { code: string; name: string; fullName: string }[];
    chair: { name: string; designationName: string } | null;
  };
  mom: { state: MomState; version: number; circulatedAt: Date | null };
  attendance: {
    name: string;
    designationName: string;
    departmentName: string;
    mark: AttendanceMark | null;
    isChair: boolean;
    isWalkIn: boolean;
  }[];
  agenda: {
    ordinal: number;
    text: string;
    projectName: string | null;
    addedByName: string | null;
    isCarryBlock: boolean;
    isDeferred: boolean;
    carriedCount: number;
  }[];
  /** The sanitised minutes, dropped in as section 4. */
  bodyHtml: string;
  actions: {
    ref: string;
    description: string;
    raisedByName: string;
    owners: string[];
    dueDate: Date | null;
    priority: Priority | null;
    status: ActionStatus | null;
    remarks: string | null;
  }[];
  clarifications: {
    ref: string;
    description: string;
    raisedByName: string;
    respondedByName: string | null;
    status: ClarificationStatus | null;
    remarks: string | null;
  }[];
  /**
   * Documents attached while the minutes were being recorded.
   *
   * They are named on the document rather than merely travelling with it: a
   * minute that refers to "the revised estimate" without recording which file
   * that was is unusable a year later, when the file is one of nine in a
   * folder.
   */
  annexures: { name: string; fileName: string; typeLabel: string; addedByName: string | null }[];
  /**
   * Who signs, and whether they have.
   *
   * One officer — the one the Project Coordinator routed it to. Before
   * signature the block prints their name over a rule, so the document says
   * whom it is waiting for. After signature the rule is replaced by a tick,
   * the name, the designation and the moment it was signed.
   */
  signatory: {
    name: string;
    designationName: string;
    signedAt: Date | null;
  } | null;
  /**
   * The state emblem, already inlined as a data: URI.
   *
   * A file path or an http URL would not survive being printed, e-mailed or
   * archived — the document has to carry its own crest. Absent is a legal
   * state: the header simply prints without it rather than showing a broken
   * image on a minute that goes on the record.
   */
  emblemDataUri: string | null;
  /**
   * The CDMA roundel, opposite the state emblem.
   *
   * Independent of the emblem on purpose: an office that has one file and not
   * the other still gets a balanced masthead, rather than one crest shoved
   * against the titles.
   */
  cdmaDataUri: string | null;
  generatedAt: Date;
}

export function renderMomDocument(data: MomDocumentData): string {
  const { meeting, mom } = data;
  const watermark = MOM_WATERMARK[mom.state];
  const signed = mom.state === 'SIGNED';

  const present = data.attendance.filter((a) => a.mark === 'PRESENT').length;
  const virtual = data.attendance.filter((a) => a.mark === 'VIRTUAL').length;
  const absent = data.attendance.filter((a) => a.mark === 'ABSENT').length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(meeting.code)} — ${esc(meeting.title)}</title>
<style>${STYLE}</style>
</head>
<body class="${signed ? 'signed' : 'draft'}">
${watermark ? `<div class="watermark" aria-hidden="true"><span>${esc(watermark)}</span></div>` : ''}
<main class="sheet">
<div class="inner">

  ${masthead('Minutes of Meeting', data.emblemDataUri, data.cdmaDataUri)}

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
    </tbody>
  </table>

  ${
    meeting.type === 'INSTANT'
      ? `<p class="note instant"><b>Instant meeting.</b> No agenda was circulated in advance;
         the points below were taken as raised.</p>`
      : ''
  }

  <h2>1. Attendance</h2>
  <p class="lede">Invited ${data.attendance.length} · present ${present} · attended virtually ${virtual} · absent ${absent}.</p>
  <table class="grid">
    <thead><tr><th class="n">#</th><th>Name</th><th>Designation</th><th>Department</th><th>Attendance</th></tr></thead>
    <tbody>
      ${data.attendance
        .map(
          (a, i) => `<tr>
            <td class="n">${i + 1}</td>
            <td>${esc(a.name)}${a.isChair ? ' <b>(Chair)</b>' : ''}${
              a.isWalkIn ? ' <span class="tag">walk-in</span>' : ''
            }</td>
            <td>${esc(a.designationName)}</td>
            <td>${esc(a.departmentName)}</td>
            <td>${a.mark ? esc(ATTENDANCE_LABEL[a.mark]) : '—'}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <h2>2. Agenda as taken</h2>
  ${
    data.agenda.length === 0
      ? '<p class="lede">No agenda was recorded for this meeting.</p>'
      : `<table class="grid">
    <thead><tr><th class="n">#</th><th>Agenda item</th><th>Project</th><th>Raised by</th></tr></thead>
    <tbody>
      ${data.agenda
        .map(
          (a) => `<tr>
            <td class="n">${a.ordinal}</td>
            <td>${esc(a.text)}${
              a.isCarryBlock
                ? ` <i>(${a.carriedCount} carried forward)</i>`
                : a.isDeferred
                  ? ' <i>(deferred)</i>'
                  : ''
            }</td>
            <td>${esc(a.projectName ?? '—')}</td>
            <td>${esc(a.isCarryBlock ? 'System' : (a.addedByName ?? '—'))}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
  }

  <h2>3. Review of items carried forward</h2>
  ${
    data.agenda.some((a) => a.isCarryBlock)
      ? `<p>Open items from the previous review were taken up as agenda item 0. Their status as
         recorded at the close of this meeting is shown in the action and clarification tables
         below; any item still open is carried forward again.</p>`
      : '<p>No items were carried forward into this meeting.</p>'
  }

  <h2>4. Discussion and decisions</h2>
  <div class="minutes">${data.bodyHtml}</div>

  <h2>5. Action items arising</h2>
  ${
    data.actions.length === 0
      ? '<p class="lede">No action items were recorded.</p>'
      : `<table class="grid">
    <thead><tr>
      <th>ID</th><th>Action</th><th>Raised by</th><th>Responsible officer(s)</th>
      <th>Due date</th><th>Priority</th><th>Status</th><th>Remarks</th>
    </tr></thead>
    <tbody>
      ${data.actions
        .map(
          (a) => `<tr>
            <td class="mono"><b>${esc(a.ref)}</b></td>
            <td>${esc(a.description)}</td>
            <td>${esc(a.raisedByName)}</td>
            <td>${a.owners.map(esc).join(',<br />')}</td>
            <td>${a.dueDate ? shortDate(a.dueDate) : '—'}</td>
            <td>${a.priority ? esc(PRIORITY_LABEL[a.priority]) : '—'}</td>
            <td>${a.status ? esc(ACTION_STATUS_LABEL[a.status]) : 'Not yet active'}</td>
            <td>${esc(a.remarks ?? '—')}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p class="note">Where more than one officer is named, all are <b>jointly and equally
  accountable</b>. Any one of them may report the action complete; the completion is then confirmed
  by the competent authority before the item closes.</p>`
  }

  <h2>6. Clarifications and additional points</h2>
  ${
    data.clarifications.length === 0
      ? '<p class="lede">No clarifications were recorded.</p>'
      : `<table class="grid">
    <thead><tr>
      <th>ID</th><th>Clarification</th><th>Raised by</th><th>Responded by</th><th>Status</th><th>Remarks</th>
    </tr></thead>
    <tbody>
      ${data.clarifications
        .map(
          (c) => `<tr>
            <td class="mono"><b>${esc(c.ref)}</b></td>
            <td>${esc(c.description)}</td>
            <td>${esc(c.raisedByName)}</td>
            <td>${esc(c.respondedByName ?? '—')}</td>
            <td>${c.status ? esc(CLARIFICATION_STATUS_LABEL[c.status]) : 'Not yet active'}</td>
            <td>${esc(c.remarks ?? '—')}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
  }

  ${
    data.annexures.length === 0
      ? ''
      : `<h2>7. Annexures</h2>
  <table class="grid">
    <thead><tr><th>No.</th><th>Document</th><th>Type</th><th>File</th><th>Placed by</th></tr></thead>
    <tbody>
      ${data.annexures
        .map(
          (a, n) => `<tr>
            <td class="mono"><b>A-${String(n + 1).padStart(2, '0')}</b></td>
            <td>${esc(a.name)}</td>
            <td>${esc(a.typeLabel)}</td>
            <td class="mono">${esc(a.fileName)}</td>
            <td>${esc(a.addedByName ?? '—')}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p class="note">The annexures listed above are circulated with these minutes.</p>
`
  }

  <h2>${data.annexures.length === 0 ? 7 : 8}. Circulation and next review</h2>
  <p>These minutes are circulated to all invitees listed at section 1 and to the standing
  head-office recipients. Open items are carried forward to the next review for the project named
  above.</p>

  ${
    /*
     * One block, hard right, as a government order is signed. The coordinator
     * produced the document and the Project Coordinator approved it; neither
     * signs it, and a second block invites the reader to think otherwise.
     * Both names are on the record anyway, in the history and the audit trail.
     *
     * Signed in the system, so the tick is the signature. It carries the name,
     * the designation and the exact moment — which is more than a scanned
     * squiggle proves, because none of it can be backdated.
     */
    !data.signatory
      ? ''
      : data.signatory.signedAt
        ? `<div class="signatures">
          <div class="sig signed">
            <div class="tick" aria-hidden="true">${TICK_SVG}</div>
            <b>${esc(data.signatory.name)}</b>
            <span>${esc(data.signatory.designationName)}</span>
            <span class="stamp">Signed ${esc(stamp(data.signatory.signedAt))}</span>
          </div>
        </div>`
        : `<div class="signatures">
          <div class="sig">
            <div class="rule"></div>
            <b>${esc(data.signatory.name)}</b>
            <span>${esc(data.signatory.designationName)}</span>
            <span>For signature</span>
          </div>
        </div>`
  }

  <footer class="foot">
    <span>${esc(meeting.code)} · ${esc(meeting.title)}</span>
    <span>${
      signed
        ? `Signed and circulated ${mom.circulatedAt ? shortDate(mom.circulatedAt) : ''}`
        : `System-generated draft · not valid until signed · generated ${shortDate(data.generatedAt)}`
    }</span>
  </footer>
</div>
</main>
</body>
</html>`;
}

/**
 * A4 at 96dpi is 794 × 1123 px. The sheet is fixed to that width on screen so
 * that what the officer previews is the page that prints — docs/07-UI-SPEC.md
 * is explicit that this one layout must never reflow responsively.
 */
const STYLE = `
${PAPER_STYLE}

/* ── the minutes' own rules ─────────────────────────────────────────── */

.watermark { position:fixed; inset:0; display:grid; place-items:center; pointer-events:none; z-index:5; }
.watermark span { font:800 118px/1 "Bitter",Georgia,serif; letter-spacing:.14em; color:#C3372B;
  opacity:.085; transform:rotate(-24deg); border:9px solid currentColor; border-radius:26px;
  padding:18px 44px; }

.minutes { margin-top:4px; }
.minutes h3 { margin:14px 0 5px; font:700 12px/1.35 "Bitter",Georgia,serif; color:var(--navy); }
.minutes p { margin:0 0 8px; }
.minutes ul, .minutes ol { margin:0 0 8px; padding-left:20px; }
.minutes mark { background:#FDF0C8; padding:0 2px; }
.minutes a { color:#2E5FA3; }

/* One block, hard right — where a signature goes on an order. */
.signatures { display:flex; justify-content:flex-end; margin:64px 0 0; text-align:center; }
.sig { width:260px; display:flex; flex-direction:column; gap:1px; }
.sig .rule { border-top:1px solid var(--ink); margin-bottom:7px; }
.sig b { font-size:12.5px; color:var(--navy); }
.sig span { font-size:11px; color:var(--muted); }

/* Signed in the system: the tick replaces the rule, and the block is boxed so
   that it reads as an attestation rather than as a place to write. */
.sig.signed { border:1px solid #BFE0CC; border-radius:6px; background:#F3FAF5; padding:11px 14px 12px; }
.sig.signed .tick { display:flex; justify-content:center; margin-bottom:5px; }
.sig.signed .stamp { margin-top:3px; font-size:10px; color:#1B7F44; font-weight:700; }

@media print {
  .watermark { position:fixed; }
  .sig { break-inside:avoid; }
}
`;

/**
 * The tick, drawn rather than typed.
 *
 * A "✓" renders as whatever glyph the reader's font happens to carry, and in
 * Times New Roman on a Windows machine that is frequently a hollow box. This
 * document is printed and filed, so the mark is an inline SVG path: identical
 * on every machine, and it survives being saved as a PDF.
 */
const TICK_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" role="img" aria-label="Signed">' +
  '<circle cx="12" cy="12" r="11" fill="#1B7F44"/>' +
  '<path d="M6.8 12.4l3.4 3.4 7-7.2" fill="none" stroke="#fff" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
