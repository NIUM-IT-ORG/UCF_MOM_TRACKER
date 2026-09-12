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
  signatories: { name: string; designationName: string; role: string }[];
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

  <header class="head">
    <div class="crest" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="1.7"
           stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    </div>
    <div class="titles">
      <p class="dept">Government of the State · Municipal Administration Department</p>
      <h1>Urban Challenge Fund</h1>
      <p class="kind">Minutes of Meeting</p>
    </div>
    <dl class="ref">
      <dt>Ref</dt><dd class="mono">${esc(meeting.code)}</dd>
      <dt>Version</dt><dd>v${mom.version}</dd>
      <dt>Dated</dt><dd>${longDate(meeting.meetingDate)}</dd>
    </dl>
  </header>

  <table class="facts">
    <tbody>
      <tr>
        <th>Meeting</th>
        <td colspan="3"><b>${esc(meeting.title)}</b></td>
      </tr>
      <tr>
        <th>Date</th><td>${longDate(meeting.meetingDate)}</td>
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

  <h2>7. Circulation and next review</h2>
  <p>These minutes are circulated to all invitees listed at section 1 and to the standing
  head-office recipients. Open items are carried forward to the next review for the project named
  above.</p>

  <div class="signatures">
    ${data.signatories
      .map(
        (s) => `<div class="sig">
          <div class="rule"></div>
          <b>${esc(s.name)}</b>
          <span>${esc(s.designationName)}</span>
          ${
            // "Meeting Coordinator / Meeting Coordinator" is not a second fact.
            s.role === s.designationName ? '' : `<span>${esc(s.role)}</span>`
          }
        </div>`,
      )
      .join('')}
  </div>

  <footer class="foot">
    <span>${esc(meeting.code)} · ${esc(meeting.title)}</span>
    <span>${
      signed
        ? `Signed and circulated ${mom.circulatedAt ? shortDate(mom.circulatedAt) : ''}`
        : `System-generated draft · not valid until signed · generated ${shortDate(data.generatedAt)}`
    }</span>
  </footer>
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
:root { --ink:#1B2433; --navy:#13233D; --muted:#5A6B82; --line:#D7DEE8; --accent:#C2703A; }
* { box-sizing: border-box; }
body { margin:0; background:#EEF2F7; color:var(--ink);
  font:13px/1.55 "Public Sans","Segoe UI",system-ui,sans-serif; }
.sheet { position:relative; width:794px; min-height:1123px; margin:24px auto; padding:56px 54px 40px;
  background:#fff; box-shadow:0 4px 22px rgba(19,35,61,.13); }
.watermark { position:fixed; inset:0; display:grid; place-items:center; pointer-events:none; z-index:5; }
.watermark span { font:800 118px/1 "Bitter",Georgia,serif; letter-spacing:.14em; color:#C3372B;
  opacity:.085; transform:rotate(-24deg); border:9px solid currentColor; border-radius:26px;
  padding:18px 44px; }

.head { display:grid; grid-template-columns:auto 1fr auto; gap:18px; align-items:start;
  padding-bottom:14px; border-bottom:2.5px solid var(--navy); }
.crest { width:52px; height:52px; border-radius:12px; background:var(--navy); display:grid; place-items:center; }
.titles { text-align:center; }
.dept { margin:0; font-size:9.5px; font-weight:800; letter-spacing:2.1px; text-transform:uppercase; color:var(--muted); }
.titles h1 { margin:4px 0 2px; font:700 21px/1.2 "Bitter",Georgia,serif; color:var(--navy); }
.kind { margin:0; font-size:10px; font-weight:800; letter-spacing:2.6px; text-transform:uppercase; color:var(--accent); }
.ref { display:grid; grid-template-columns:1fr; gap:1px; margin:0; text-align:right; }
.ref dt { font-size:8.5px; text-transform:uppercase; letter-spacing:.9px; color:var(--muted); }
.ref dd { margin:0 0 5px; font-size:11.5px; font-weight:700; color:var(--navy); }

h2 { margin:22px 0 8px; font:700 13px/1.3 "Bitter",Georgia,serif; color:var(--navy);
  padding-bottom:5px; border-bottom:1px solid var(--line); }
p { margin:0 0 9px; }
.lede { color:var(--muted); }
.mono { font-family:ui-monospace,"Cascadia Mono",Menlo,monospace; font-size:11px; }
.n { width:26px; text-align:center; color:var(--muted); }

table { width:100%; border-collapse:collapse; margin:8px 0 4px; }
.facts { margin-top:16px; border:1px solid var(--line); }
.facts th { width:118px; padding:9px 11px; text-align:left; vertical-align:top; background:#F4F7FB;
  border:1px solid var(--line); font-size:9px; font-weight:800; letter-spacing:1.1px;
  text-transform:uppercase; color:var(--muted); }
.facts td { padding:9px 11px; border:1px solid var(--line); vertical-align:top; }
.vc { display:block; font-size:11px; color:var(--muted); word-break:break-all; }

.grid th { padding:7px 9px; text-align:left; background:#F4F7FB; border:1px solid var(--line);
  font-size:8.5px; font-weight:800; letter-spacing:.9px; text-transform:uppercase; color:var(--muted); }
.grid td { padding:7px 9px; border:1px solid var(--line); vertical-align:top; }

.minutes { margin-top:4px; }
.minutes h3 { margin:14px 0 5px; font:700 12px/1.35 "Bitter",Georgia,serif; color:var(--navy); }
.minutes p { margin:0 0 8px; }
.minutes ul, .minutes ol { margin:0 0 8px; padding-left:20px; }
.minutes mark { background:#FDF0C8; padding:0 2px; }
.minutes a { color:#2E5FA3; }

.note { margin:8px 0 0; padding:8px 11px; background:#F4F7FB; border-left:3px solid var(--navy);
  font-size:11.5px; color:var(--muted); }
.note.instant { border-left-color:var(--accent); margin:14px 0 0; }
.tag { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.6px;
  color:var(--accent); }

.signatures { display:flex; gap:60px; justify-content:space-around; margin:56px 0 0; text-align:center; }
.sig { flex:1; max-width:240px; display:flex; flex-direction:column; gap:1px; }
.sig .rule { border-top:1px solid var(--ink); margin-bottom:7px; }
.sig b { font-size:12.5px; color:var(--navy); }
.sig span { font-size:11px; color:var(--muted); }

.foot { display:flex; justify-content:space-between; gap:18px; margin-top:34px; padding-top:9px;
  border-top:1px solid var(--line); font-size:9.5px; letter-spacing:.3px; color:var(--muted); }

@page { size:A4; margin:14mm; }
@media print {
  body { background:#fff; }
  .sheet { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; }
  .watermark { position:fixed; }
  h2, .grid thead { break-after:avoid; }
  .grid tr, .sig { break-inside:avoid; }
}
`;

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function longDate(d: Date): string {
  return shortDate(d);
}
