import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdmaCandidates, emblemCandidates, readEmblem } from './emblem.js';

/**
 * The crest has to be found from wherever the server happens to be started:
 * `nest start` runs with apps/api as the working directory, a built server
 * runs from the repository root. A masthead that has its emblem in
 * development and loses it in production is the kind of defect that is only
 * discovered on paper.
 */
describe('finding the emblem', () => {
  it('looks in var/ and assets/, from the working directory and the repo root', () => {
    const paths = emblemCandidates('/srv/app/apps/api', undefined).map((p) => p.replace(/\\/g, '/'));
    expect(paths).toContain('/srv/app/apps/api/var/branding/emblem.png');
    expect(paths).toContain('/srv/app/var/branding/emblem.png');
    expect(paths).toContain('/srv/app/assets/branding/emblem.png');
  });

  it('prefers what the office put in var/ over what the project ships', () => {
    const paths = emblemCandidates('/srv/app', undefined).map((p) => p.replace(/\\/g, '/'));
    expect(paths.indexOf('/srv/app/var/branding/emblem.png')).toBeLessThan(
      paths.indexOf('/srv/app/assets/branding/emblem.png'),
    );
  });

  it('puts an explicit MOM_EMBLEM_PATH first', () => {
    expect(emblemCandidates('/srv/app', '/etc/ucf/crest.svg')[0]).toBe('/etc/ucf/crest.svg');
  });

  it('reads the first file that exists and inlines it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emblem-'));
    mkdirSync(join(dir, 'assets', 'branding'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'branding', 'emblem.png'), Buffer.from([1, 2, 3, 4]));
    const uri = readEmblem(emblemCandidates(dir, undefined));
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`);
  });

  it('knows an SVG from a PNG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emblem-'));
    writeFileSync(join(dir, 'crest.svg'), '<svg/>');
    expect(readEmblem([join(dir, 'crest.svg')])).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('returns nothing rather than throwing when there is no emblem anywhere', () => {
    expect(readEmblem([join(tmpdir(), 'definitely-not-here.png')])).toBeNull();
  });
});

describe('finding the CDMA roundel', () => {
  it('is searched for exactly like the state emblem, under its own name', () => {
    const paths = cdmaCandidates('/srv/app/apps/api', undefined).map((p) => p.replace(/\\/g, '/'));
    expect(paths).toContain('/srv/app/apps/api/var/branding/cdma.png');
    expect(paths).toContain('/srv/app/var/branding/cdma.png');
    expect(paths).toContain('/srv/app/assets/branding/cdma.png');
  });

  it('prefers what the office put in var/', () => {
    const paths = cdmaCandidates('/srv/app', undefined).map((p) => p.replace(/\\/g, '/'));
    expect(paths.indexOf('/srv/app/var/branding/cdma.png')).toBeLessThan(
      paths.indexOf('/srv/app/assets/branding/cdma.png'),
    );
  });

  it('takes MOM_CDMA_LOGO_PATH first', () => {
    expect(cdmaCandidates('/srv/app', '/etc/ucf/cdma.png')[0]).toBe('/etc/ucf/cdma.png');
  });

  it('never collides with the emblem', () => {
    // Two crests, two files. If these overlapped, one office replacing the
    // state emblem would silently replace the department logo as well.
    const a = new Set(emblemCandidates('/srv/app', undefined));
    for (const path of cdmaCandidates('/srv/app', undefined)) {
      expect(a.has(path)).toBe(false);
    }
  });
});
