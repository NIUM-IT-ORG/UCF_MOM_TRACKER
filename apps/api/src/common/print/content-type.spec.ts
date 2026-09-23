import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noBrowserMessage } from './browser.js';

/**
 * A failed PDF must not be served as a PDF.
 *
 * This is here because it already happened. Both PDF routes declared
 * `@Header('content-type', 'application/pdf')`, and Nest applies that
 * metadata *before* the handler runs — so when printing threw, the exception
 * filter wrote its JSON body into a response that still claimed to be a PDF.
 * The browser showed "Failed to load PDF document" and nothing else, and the
 * message it was hiding was the useful one: that the server has no browser to
 * print with, and which package to install. A whole afternoon can go into a
 * blank viewer that is actually reporting a missing apt package.
 *
 * So the content type is set inside the handler, after the bytes exist. These
 * tests read the source because that is the only place the ordering is
 * visible — by the time a response is on the wire the mistake has been made.
 */

const ROUTES = [
  join(__dirname, '..', '..', 'modules', 'meetings', 'meetings.controller.ts'),
  join(__dirname, '..', '..', 'modules', 'mom', 'mom.controller.ts'),
];

describe('a PDF route never declares its content type as metadata', () => {
  it.each(ROUTES)('%s sets it in the handler instead', (path) => {
    const src = readFileSync(path, 'utf8');

    // The decorator form is the bug: applied before the handler, so it
    // survives a throw.
    expect(src).not.toMatch(/@Header\(\s*['"]content-type['"]\s*,\s*['"]application\/pdf/i);

    // And the runtime form is what should be there instead — but only in a
    // file that actually serves a PDF.
    if (/\.pdf['"]\)/.test(src)) {
      expect(src).toMatch(/setHeader\(\s*['"]content-type['"]\s*,\s*['"]application\/pdf/i);
    }
  });
});

describe('the message a missing browser produces', () => {
  /*
   * The diagnosis is only half of it. The .html route renders the identical
   * document from the identical template and needs no browser on the server,
   * so an officer who needs the minutes today should not have to wait for
   * somebody with sudo.
   */
  it('offers the printable page as a way through, not just an apt command', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      const msg = noBrowserMessage(platform);
      expect(msg, platform).toMatch(/\.html/);
      expect(msg, platform).toMatch(/Save as PDF/i);
    }
  });

  it('still says what to install, and where to point it', () => {
    expect(noBrowserMessage('win32')).toMatch(/Edge/);
    expect(noBrowserMessage('linux')).toMatch(/apt-get install/);
    expect(noBrowserMessage('linux')).toMatch(/MOM_BROWSER_PATH/);
  });
});
