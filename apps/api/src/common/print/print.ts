import puppeteer, { type Browser } from 'puppeteer-core';
import { AppError } from '../app-error.js';
import { findBrowser, noBrowserMessage } from './browser.js';

/**
 * One HTML string in, one PDF out.
 *
 * Both documents this product prints — the minutes and the agenda — come
 * through here, so they are printed by the same engine with the same page
 * settings. Two call sites each launching their own browser is how the agenda
 * ends up with different margins from the minutes it precedes, and nobody
 * notices until the two are filed side by side.
 *
 * The browser is one the machine already has; see browser.ts for why nothing
 * is bundled. It is launched per call and closed in a `finally`, because a
 * leaked headless Chrome is 150 MB of resident memory that nobody notices
 * until the fourth one.
 */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const executablePath = findBrowser();
  if (!executablePath) throw new AppError('INTERNAL', noBrowserMessage());

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      // --no-sandbox is required to run as a service account on Linux and is
      // harmless here: the only page ever loaded is HTML this server just
      // generated, never anything fetched from outside.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    // `setContent` rather than a URL: the document is already in hand, and a
    // round trip through the server would need the request's own cookie.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    // The templates carry @page { size:A4 } and their own margins, so the
    // margins here are zero and printBackground keeps the crests, the rules
    // and the coloured panels.
    return await page.pdf({
      format: 'a4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'INTERNAL',
      `The document could not be printed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  } finally {
    await browser?.close().catch(() => {
      // Closing failed; the process will be reaped. Nothing useful to do.
    });
  }
}
