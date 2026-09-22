import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { mergeAnnexures, clip, type Annexure } from './mom.pdf.js';
import { browserCandidates, findBrowser, noBrowserMessage } from '../../common/print/browser.js';

/**
 * The bundle the client asked for: the minutes, then the papers tabled at the
 * meeting. The rule these tests exist to hold is that **the page count is
 * never quietly short**. A minute whose section 7 lists five annexures and
 * whose PDF carries three is worse than one that says which is missing,
 * because nobody checks a number they have no reason to doubt.
 */
async function blank(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595.28, 841.89]);
  return doc.save();
}

/** A 1×1 PNG, as a real image the embedder has to accept. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const annexure = (over: Partial<Annexure> = {}): Annexure => ({
  ref: 'A-01',
  name: 'Revised estimate',
  fileName: 'estimate.pdf',
  typeLabel: 'Estimate',
  mimeType: 'application/pdf',
  bytes: PNG,
  ...over,
});

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe('building the bundle', () => {
  it('leaves the minutes alone when nothing was tabled', async () => {
    const minutes = await blank(2);
    const { pdf, appended } = await mergeAnnexures(minutes, []);
    expect(await pageCount(pdf)).toBe(2);
    expect(appended).toEqual([]);
  });

  it('puts a separator page in front of every annexure', async () => {
    const minutes = await blank(2);
    const { pdf } = await mergeAnnexures(minutes, [
      annexure({ ref: 'A-01', bytes: await blank(3) }),
      annexure({ ref: 'A-02', bytes: await blank(1) }),
    ]);
    // 2 minutes + (1 separator + 3) + (1 separator + 1)
    expect(await pageCount(pdf)).toBe(8);
  });

  it('merges an attached PDF page for page', async () => {
    const { pdf, appended } = await mergeAnnexures(await blank(1), [
      annexure({ bytes: await blank(5) }),
    ]);
    expect(appended[0]).toMatchObject({ ref: 'A-01', pages: 5, embedded: true });
    expect(await pageCount(pdf)).toBe(1 + 1 + 5);
  });

  it('gives an image a page of its own', async () => {
    const { appended } = await mergeAnnexures(await blank(1), [
      annexure({ mimeType: 'image/png', fileName: 'site.png', bytes: PNG }),
    ]);
    expect(appended[0]).toMatchObject({ pages: 1, embedded: true });
  });

  it('says so on the page when a file cannot go inside a PDF', async () => {
    // A .docx needs an office suite to render. It is NOT dropped.
    const { pdf, appended } = await mergeAnnexures(await blank(1), [
      annexure({
        ref: 'A-03',
        fileName: 'letter.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: Buffer.from('PK\u0003\u0004 not really a docx'),
      }),
    ]);
    expect(appended[0]).toMatchObject({ ref: 'A-03', embedded: false, pages: 1 });
    expect(appended[0]?.reason).toMatch(/cannot be placed inside a PDF/);
    // Separator + notice: the annexure still occupies its place in the bundle.
    expect(await pageCount(pdf)).toBe(3);
  });

  it('survives a corrupt attachment rather than losing the whole document', async () => {
    /*
     * The minutes are the thing that has to be produced. A scan that is
     * truncated, or a PDF somebody renamed from a Word file, must cost that
     * one annexure and nothing else.
     */
    const { pdf, appended } = await mergeAnnexures(await blank(2), [
      annexure({ bytes: Buffer.from('%PDF-1.4 and then nothing useful') }),
      annexure({ ref: 'A-02', bytes: await blank(1) }),
    ]);
    expect(appended[0]).toMatchObject({ ref: 'A-01', embedded: false });
    expect(appended[1]).toMatchObject({ ref: 'A-02', embedded: true, pages: 1 });
    // 2 + (separator + notice) + (separator + 1) — nothing vanished.
    expect(await pageCount(pdf)).toBe(6);
  });

  it('never returns fewer entries than it was given', async () => {
    const many = [1, 2, 3, 4].map((n) =>
      annexure({ ref: `A-0${n}`, bytes: Buffer.from('rubbish') }),
    );
    const { appended } = await mergeAnnexures(await blank(1), many);
    expect(appended).toHaveLength(4);
    expect(appended.map((a) => a.ref)).toEqual(['A-01', 'A-02', 'A-03', 'A-04']);
  });
});

describe('text that has to survive the standard PDF fonts', () => {
  /*
   * WinAnsi cannot encode an em dash, and pdf-lib throws rather than dropping
   * it — so an unfolded document name would fail the whole bundle. Every
   * substitution below is a character this product actually produces.
   */
  it('folds the punctuation this product emits', async () => {
    expect(clip('Revised estimate — Zone A', 80)).toBe('Revised estimate - Zone A');
    expect(clip('A-03 · Contractor correspondence', 80)).toBe('A-03 - Contractor correspondence');
    expect(clip('the chair’s direction', 80)).toBe("the chair's direction");
    expect(clip('“as tabled”', 80)).toBe('"as tabled"');
    expect(clip('and so on…', 80)).toBe('and so on...');
  });

  it('keeps what it cannot fold visible rather than throwing', async () => {
    expect(clip('పురోగతి', 80)).toBe('???????');
  });

  it('truncates without leaving a character the font cannot set', async () => {
    const out = clip('a'.repeat(200), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('...')).toBe(true);
    expect(/^[\x20-\x7E]*$/.test(out)).toBe(true);
  });

  it('produces a page for every folded string, in a real document', async () => {
    // The point of all the above: pdf-lib must not throw on any of them.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage();
    for (const s of ['Zone A — trunk', 'A-01 · estimate', 'పురోగతి', '“x”']) {
      expect(() => page.drawText(clip(s, 40), { x: 10, y: 10, size: 9, font })).not.toThrow();
    }
  });
});

describe('finding a browser to print with', () => {
  it('looks for Edge and Chrome on Windows, in both Program Files roots', () => {
    const paths = browserCandidates('win32', {
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    } as NodeJS.ProcessEnv);
    expect(paths.some((p) => p.endsWith('msedge.exe'))).toBe(true);
    expect(paths.some((p) => p.endsWith('chrome.exe'))).toBe(true);
    expect(paths.some((p) => p.includes('Program Files (x86)'))).toBe(true);
  });

  it('looks for chromium on Linux, which is what the server installs', () => {
    const paths = browserCandidates('linux', {} as NodeJS.ProcessEnv);
    expect(paths).toContain('/usr/bin/chromium');
    expect(paths).toContain('/usr/bin/google-chrome');
  });

  it('puts an explicit MOM_BROWSER_PATH first, on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as NodeJS.Platform[]) {
      expect(
        browserCandidates(platform, { MOM_BROWSER_PATH: '/opt/my/chrome' } as NodeJS.ProcessEnv)[0],
      ).toBe('/opt/my/chrome');
    }
  });

  it('returns the first one that is actually there', () => {
    const found = findBrowser(
      'linux',
      {} as NodeJS.ProcessEnv,
      (p) => p === '/usr/bin/google-chrome',
    );
    expect(found).toBe('/usr/bin/google-chrome');
  });

  it('returns nothing rather than a guess when none exists', () => {
    expect(findBrowser('linux', {} as NodeJS.ProcessEnv, () => false)).toBeNull();
  });

  it('tells the officer what to install, per platform, and names the setting', () => {
    expect(noBrowserMessage('win32')).toMatch(/Edge/);
    expect(noBrowserMessage('linux')).toMatch(/apt-get install/);
    expect(noBrowserMessage('linux')).toMatch(/MOM_BROWSER_PATH/);
  });
});
