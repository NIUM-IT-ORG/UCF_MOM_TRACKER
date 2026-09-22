import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two crests on the masthead, read once and inlined as data: URIs.
 *
 * Inlined rather than linked because the document has to carry its own crest:
 * a MoM is emailed, printed and archived, and an <img src> pointing at this
 * server is a broken image in every one of those places a year from now.
 *
 * Nothing is invented. If no file is found the masthead prints without a
 * crest — which is honest — where a stand-in emblem on a minute that goes on
 * the record would not be.
 */
let cachedEmblem: string | null | undefined;
let cachedCdma: string | null | undefined;

/**
 * Where to look, in order. The dev server runs with `apps/api` as its working
 * directory and a built server runs from the repository root, so both are
 * tried rather than assumed: a crest that appears in development and vanishes
 * in production is exactly the kind of thing nobody notices until it is
 * printed.
 *
 * `var/branding` wins over `assets/branding` — the tracked file is what the
 * project ships with, and `var/` is whatever this office put there.
 */
export function emblemCandidates(cwd: string = process.cwd(), configured = process.env.MOM_EMBLEM_PATH): string[] {
  return candidates('emblem.png', cwd, configured);
}

/** The same search, for the CDMA roundel that sits opposite the state emblem. */
export function cdmaCandidates(cwd: string = process.cwd(), configured = process.env.MOM_CDMA_LOGO_PATH): string[] {
  return candidates('cdma.png', cwd, configured);
}

function candidates(file: string, cwd: string, configured?: string): string[] {
  const roots = [cwd, join(cwd, '..', '..')];
  const relative = [join('var', 'branding', file), join('assets', 'branding', file)];
  return [
    ...(configured ? [configured] : []),
    ...roots.flatMap((root) => relative.map((rel) => join(root, rel))),
  ];
}

export function readEmblem(paths: string[]): string | null {
  for (const path of paths) {
    try {
      const bytes = readFileSync(path);
      const lower = path.toLowerCase();
      const type = lower.endsWith('.svg')
        ? 'image/svg+xml'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png';
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      // not there; try the next
    }
  }
  return null;
}

/** Cached: these are files that change when somebody replaces them, and a
 *  restart is the natural moment to notice. */
export function emblem(): string | null {
  if (cachedEmblem === undefined) cachedEmblem = readEmblem(emblemCandidates());
  return cachedEmblem;
}

export function cdmaLogo(): string | null {
  if (cachedCdma === undefined) cachedCdma = readEmblem(cdmaCandidates());
  return cachedCdma;
}
