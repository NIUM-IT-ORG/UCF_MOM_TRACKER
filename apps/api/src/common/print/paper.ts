/**
 * The stationery both printed documents are set on.
 *
 * The minutes and the agenda are two different documents, so they have two
 * templates — but they are the same office's paper, and they are read one
 * after the other: an officer gets the agenda before the meeting and the
 * minutes after it. If the crest sits at a different height, or the fact table
 * is ruled differently, the pair look like they came from two departments.
 *
 * So the letterhead, the page rules, the fact table and the grid live here and
 * are shared. What is specific to one document — the DRAFT watermark and the
 * signature block on the minutes, the contribution notice on the agenda —
 * stays in that document's own template.
 */

/** HTML-escape. Every value interpolated into a template goes through this. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `9 Sep 2026`. Dates are stored as `date`, so UTC is the stored value. */
export function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * A moment, in the timezone the officers work in.
 *
 * Everything else on these documents is a date, so UTC does no harm. A
 * timestamp is different: it is evidence, it gets quoted, and "16 Sep 2026,
 * 11:42 pm" for something done at 5:12 am on the 17th in Hyderabad is the sort
 * of discrepancy that ends up in a note on a file. So this one is printed in
 * IST and says so.
 */
export function stamp(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${shortDate(ist)} at ${hh}:${mm} IST`;
}

/**
 * The masthead: state emblem left, CDMA roundel right, wording between them.
 *
 * Either side falls back to an empty column of the same width when its file is
 * missing, so the titles stay optically centred whether the office has both
 * crests, one, or neither. A missing file prints nothing rather than a
 * placeholder: these documents go on the record.
 */
export function masthead(
  title: string,
  emblemDataUri: string | null,
  cdmaDataUri: string | null,
): string {
  const crested = emblemDataUri || cdmaDataUri ? ' crested' : '';
  const left = emblemDataUri
    ? `<img class="emblem" src="${emblemDataUri}" alt="Government of Telangana" />`
    : cdmaDataUri
      ? '<div class="spacer" aria-hidden="true"></div>'
      : '';
  const right = cdmaDataUri
    ? `<img class="emblem cdma" src="${cdmaDataUri}" alt="Commissioner &amp; Director of Municipal Administration" />`
    : emblemDataUri
      ? '<div class="spacer" aria-hidden="true"></div>'
      : '';

  return `<header class="head${crested}">
    ${left}
    <div class="titles">
      <p class="govt">Government of Telangana</p>
      <p class="dept">Municipal Administration Department</p>
      <h1>${esc(title)}</h1>
    </div>
    ${right}
  </header>`;
}

/**
 * The shared stylesheet. A document's own template appends its own rules.
 *
 * Times New Roman, because that is what government correspondence in India is
 * set in — every order, proceeding and minute that crosses a desk in this
 * department. Liberation Serif is the metric-compatible substitute on Linux
 * servers, and Nirmala UI carries Telugu if a name or a place is written in
 * it. Changing this one stack changes both documents.
 */
export const PAPER_STYLE = `
:root { --ink:#1B2433; --navy:#13233D; --muted:#5A6B82; --line:#D7DEE8; --accent:#C2703A; }
* { box-sizing: border-box; }

body { margin:0; background:#EEF2F7; color:var(--ink);
  font:13.5px/1.5 "Times New Roman","Liberation Serif","Nirmala UI",Georgia,serif; }

/*
 * The page border. Government stationery is ruled, and a document without one
 * does not look like a record — a double rule, the outer heavier, inset far
 * enough that no printer's unprintable margin clips it.
 */
.sheet { position:relative; width:794px; min-height:1123px; margin:24px auto; padding:34px;
  background:#fff; box-shadow:0 4px 22px rgba(19,35,61,.13);
  border:2.4px solid var(--navy); }
.sheet::before { content:""; position:absolute; inset:5px; border:0.8px solid var(--navy);
  pointer-events:none; }
.inner { position:relative; padding:22px 24px 16px; }

/* The crest to the left of the titles, as the client's own stationery has it.
   The empty column on the right is the same width, so the titles read as
   centred on the page rather than shunted off to one side. */
.head { text-align:center; padding-bottom:12px; border-bottom:2.2px solid var(--navy); }
.head.crested { display:grid; grid-template-columns:104px 1fr 104px; gap:14px; align-items:center; }
.emblem { display:block; height:100px; width:auto; margin:0 auto 0 0; }
/* The CDMA roundel is a filled circle and the state emblem a fine outline, so
   matched pixel heights read as mismatched weights. A touch smaller, and
   pushed to its own edge. */
.emblem.cdma { height:88px; margin:0 0 0 auto; }
.titles { text-align:center; }
.govt { margin:0; font-size:15px; font-weight:700; letter-spacing:1.2px; color:var(--navy); }
.dept { margin:2px 0 0; font-size:12.5px; font-weight:700; letter-spacing:.7px; color:var(--ink); }
.titles h1 { margin:7px 0 2px; font:700 20px/1.2 "Times New Roman","Liberation Serif",Georgia,serif;
  color:var(--navy); }

h2 { margin:20px 0 8px; font:700 14px/1.3 "Times New Roman","Liberation Serif",Georgia,serif; color:var(--navy);
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

.note { margin:8px 0 0; padding:8px 11px; background:#F4F7FB; border-left:3px solid var(--navy);
  font-size:11.5px; color:var(--muted); }
.note.instant { border-left-color:var(--accent); margin:14px 0 0; }
.tag { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.6px;
  color:var(--accent); }

.foot { display:flex; justify-content:space-between; gap:18px; margin-top:34px; padding-top:9px;
  border-top:1px solid var(--line); font-size:9.5px; letter-spacing:.3px; color:var(--muted); }

@page { size:A4; margin:14mm; }
@media print {
  body { background:#fff; }
  .sheet { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; border-width:2px; }
  h2, .grid thead { break-after:avoid; }
  .grid tr { break-inside:avoid; }
}
`;
