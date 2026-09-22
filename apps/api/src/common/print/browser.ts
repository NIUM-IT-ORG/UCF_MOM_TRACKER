import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Finding a browser to print with.
 *
 * The document is one HTML template, and turning it into a PDF needs a
 * browser engine. Bundling one is what we refused to do: `puppeteer` pulls a
 * ~300 MB Chromium per platform, and this has to install on a government
 * officer's Windows machine with no Docker and often a proxy in the way.
 *
 * So we use `puppeteer-core`, which bundles nothing, and drive a browser the
 * machine already has. Windows has ships Edge — there is no supported Windows
 * build without it. Ubuntu has chromium or google-chrome a single apt package
 * away, and the deployment provisioner installs one.
 *
 * If none is found the caller is told exactly what to install and which
 * setting to point at an existing one. It never falls back to a download.
 */
export const BROWSER_ENV = 'MOM_BROWSER_PATH';

export function browserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env[BROWSER_ENV];
  const out: string[] = configured ? [configured] : [];

  if (platform === 'win32') {
    // Both Program Files roots: Edge is 64-bit on a 64-bit Windows and the
    // x86 folder on some builds, and Chrome is routinely the other way round.
    const roots = [
      env['PROGRAMFILES'] ?? 'C:\\Program Files',
      env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      env['LOCALAPPDATA'] ?? '',
    ].filter(Boolean);
    for (const root of roots) {
      out.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      out.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    return out;
  }

  if (platform === 'darwin') {
    out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    out.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    out.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    return out;
  }

  out.push(
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  );
  return out;
}

export function findBrowser(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  for (const path of browserCandidates(platform, env)) {
    try {
      if (exists(path)) return path;
    } catch {
      // An unreadable path is not a browser; keep looking.
    }
  }
  return null;
}

/** What to tell somebody when there is no browser to print with. */
export function noBrowserMessage(platform: NodeJS.Platform = process.platform): string {
  const install =
    platform === 'win32'
      ? 'Microsoft Edge is part of Windows and is normally already there; installing Google Chrome also works.'
      : platform === 'darwin'
        ? 'Install Google Chrome, or Chromium.'
        : 'Install one:  sudo apt-get install -y chromium';
  return (
    'The PDF is produced by printing the document with a browser, and no browser was found on this server. ' +
    `${install} If one is installed somewhere unusual, set ${BROWSER_ENV} in .env to its full path.`
  );
}
