import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The MoM as one PDF: the minutes, and then the papers that were tabled.
 *
 * The client's complaint was exact — "attached documents which have been
 * mentioned during the meetings are not coming in the PDF". Listing an
 * annexure by name in section 7 says what was tabled; it does not put it in
 * the file that gets mailed and filed. This appends the documents themselves.
 *
 * Three kinds of attachment, three honest outcomes:
 *
 *   PDF     merged page by page. The common case: sanction orders, estimates,
 *           scanned letters.
 *   image   placed on its own A4 page, scaled to fit with its aspect ratio
 *           kept. Site photographs are usually a phone picture in portrait.
 *   other   a .docx or .xlsx cannot be rendered without an office suite, so
 *           the annexure gets a page that says so and names the file. It is
 *           NOT silently dropped: a minute that claims five annexures and
 *           carries four is worse than one that admits which is missing.
 *
 * Every annexure is preceded by a separator page carrying its reference and
 * name, so a reader flicking through a forty-page bundle can find A-03.
 */

const A4 = { width: 595.28, height: 841.89 };

export interface Annexure {
  /** A-01, A-02 … the same reference printed in section 7 of the minutes. */
  ref: string;
  name: string;
  fileName: string;
  typeLabel: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MergeResult {
  pdf: Uint8Array;
  /** What happened to each annexure, for the log and for the audit trail. */
  appended: { ref: string; pages: number; embedded: boolean; reason?: string }[];
}

export async function mergeAnnexures(
  minutesPdf: Uint8Array,
  annexures: Annexure[],
): Promise<MergeResult> {
  const out = await PDFDocument.load(minutesPdf);
  const helvetica = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const appended: MergeResult['appended'] = [];

  for (const a of annexures) {
    separator(out, a, bold, helvetica);
    let pages = 0;
    let embedded = true;
    let reason: string | undefined;

    try {
      if (a.mimeType === 'application/pdf') {
        pages = await appendPdf(out, a.bytes);
      } else if (isImage(a.mimeType)) {
        pages = await appendImage(out, a);
      } else {
        embedded = false;
        reason = `${a.typeLabel} files cannot be placed inside a PDF`;
        notEmbeddable(out, a, bold, helvetica, reason);
        pages = 1;
      }
    } catch (err) {
      /*
       * A corrupt or password-protected attachment must not take the whole
       * document down with it. The minutes are the thing that has to be
       * produced; this annexure says plainly that it could not be included.
       */
      embedded = false;
      reason = err instanceof Error ? err.message : 'the file could not be read';
      notEmbeddable(out, a, bold, helvetica, reason);
      pages = 1;
    }

    appended.push({ ref: a.ref, pages, embedded, reason });
  }

  return { pdf: await out.save(), appended };
}

const isImage = (mime: string) =>
  mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg';

async function appendPdf(out: PDFDocument, bytes: Uint8Array): Promise<number> {
  // ignoreEncryption: a scanned order is often saved with an owner password
  // that permits printing. Refusing it would drop a document the officer can
  // open perfectly well in any reader.
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const p of pages) out.addPage(p);
  return pages.length;
}

async function appendImage(out: PDFDocument, a: Annexure): Promise<number> {
  const img =
    a.mimeType === 'image/png' ? await out.embedPng(a.bytes) : await out.embedJpg(a.bytes);

  const margin = 40;
  const maxW = A4.width - margin * 2;
  const maxH = A4.height - margin * 2;
  // Fit inside the margins without distorting it. A stretched site photograph
  // is worse than a small one.
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;

  const page = out.addPage([A4.width, A4.height]);
  page.drawImage(img, {
    x: (A4.width - w) / 2,
    y: (A4.height - h) / 2,
    width: w,
    height: h,
  });
  return 1;
}

function separator(
  out: PDFDocument,
  a: Annexure,
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  regular: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const page = out.addPage([A4.width, A4.height]);
  const navy = rgb(0.114, 0.208, 0.341);
  const muted = rgb(0.42, 0.46, 0.52);
  const mid = A4.height / 2;

  page.drawRectangle({
    x: 0,
    y: mid + 78,
    width: A4.width,
    height: 3,
    color: navy,
  });

  centred(page, a.ref, bold, 34, mid + 22, navy);
  centred(page, clip(a.name, 58), bold, 15, mid - 14, navy);
  centred(page, a.typeLabel, regular, 11, mid - 38, muted);
  centred(page, clip(a.fileName, 72), regular, 10, mid - 58, muted);

  page.drawRectangle({
    x: 0,
    y: mid - 84,
    width: A4.width,
    height: 1,
    color: rgb(0.82, 0.86, 0.9),
  });
  centred(page, 'Annexure to the Minutes of Meeting', regular, 9.5, mid - 104, muted);
}

function notEmbeddable(
  out: PDFDocument,
  a: Annexure,
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  regular: Awaited<ReturnType<PDFDocument['embedFont']>>,
  reason: string,
): void {
  const page = out.addPage([A4.width, A4.height]);
  const mid = A4.height / 2;
  const muted = rgb(0.42, 0.46, 0.52);
  const amber = rgb(0.65, 0.42, 0.07);

  centred(page, 'This annexure is not reproduced here', bold, 14, mid + 40, amber);
  centred(page, clip(reason, 80), regular, 11, mid + 14, muted);
  centred(page, clip(`${a.ref} · ${a.name}`, 70), regular, 11, mid - 16, muted);
  centred(page, clip(a.fileName, 80), regular, 10, mid - 36, muted);
  centred(
    page,
    'It is held in the system against this meeting and can be downloaded there.',
    regular,
    9.5,
    mid - 68,
    muted,
  );

  // A rule under the notice, so a reader riffling through a printed bundle
  // sees at a glance that this page is a notice rather than a document.
  page.drawLine({
    start: { x: 60, y: mid - 120 },
    end: { x: A4.width - 60, y: mid - 120 },
    thickness: 0.8,
    color: rgb(0.85, 0.85, 0.85),
  });
}

function centred(
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
  y: number,
  color: ReturnType<typeof rgb>,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (A4.width - width) / 2, y, size, font, color });
}

/**
 * Trim to something that fits on the page.
 *
 * WinAnsi — what the standard PDF fonts encode — has no em dash and no
 * curly quotes, and pdf-lib throws on a character it cannot encode rather
 * than dropping it. Document names in this system routinely contain an em
 * dash ("Revised estimate — Zone A"), so they are folded to ASCII first.
 * Losing a dash is acceptable; failing to produce the bundle is not.
 */
export function clip(text: string, max: number): string {
  const ascii = text
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // The middle dot is this product's own separator — it is in half the
    // labels on screen — so letting it become "?" is the substitution
    // somebody would notice first. It is not in WinAnsi either.
    .replace(/·/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
  return ascii.length <= max ? ascii : `${ascii.slice(0, Math.max(0, max - 3))}...`;
}
