import { describe, expect, it } from 'vitest';
import { isRawUploadRequest } from './raw-upload.js';

/**
 * Every upload in the product goes through these two requests. Registering
 * the raw body parser for both meant the first one — the JSON that reserves
 * the file — arrived as a Buffer, and no document, no signed MoM and no
 * project paper could be filed. The failure surfaced as a validation error
 * listing '0', '1', '2' … as unrecognised keys.
 */
describe('only the byte upload carries a raw body', () => {
  it('is raw: PUT /files/:id/content', () => {
    expect(isRawUploadRequest('PUT', '/api/v1/files/cmu2abc123/content')).toBe(true);
  });

  it('is raw with a trailing slash too', () => {
    expect(isRawUploadRequest('PUT', '/api/v1/files/cmu2abc123/content/')).toBe(true);
  });

  it('is NOT raw: POST /files — this is the one that broke every upload', () => {
    expect(isRawUploadRequest('POST', '/api/v1/files')).toBe(false);
  });

  it('is NOT raw: GET /files/:id/content — reading a file back sends no body', () => {
    expect(isRawUploadRequest('GET', '/api/v1/files/cmu2abc123/content')).toBe(false);
  });

  it.each([
    ['POST', '/api/v1/meetings/cmu2abc123/documents'],
    ['POST', '/api/v1/projects/seed_prj_P1/documents'],
    ['POST', '/api/v1/meetings/cmu2abc123/mom/sign'],
    ['PUT', '/api/v1/meetings/cmu2abc123/attendance'],
    ['POST', '/api/v1/auth/login'],
  ])('is NOT raw: %s %s', (method, path) => {
    expect(isRawUploadRequest(method, path)).toBe(false);
  });

  it('does not match a deeper path that merely starts the same way', () => {
    expect(isRawUploadRequest('PUT', '/api/v1/files/cmu2abc123/content/extra')).toBe(false);
  });
});
