/**
 * Which requests carry raw bytes rather than JSON.
 *
 * Exactly one route does: `PUT /files/:id/content`, the second step of an
 * upload. Everything else on `/files` is ordinary JSON — reserving a file,
 * and reading one back.
 *
 * This exists because the raw parser was first registered for the whole
 * `/files` subtree. That turned the JSON body which RESERVES a file into a
 * Buffer, so the DTO saw an object with the keys '0', '1', '2' … and reported
 *
 *   fileName: Required; mimeType: Required; (body): Unrecognized key(s) in
 *   object: '0', '1', '2', … 'readBigUInt64LE', 'writeFloatBE' …
 *
 * on a body that plainly carried a fileName. Every upload in the product ran
 * through that route — project documents, meeting documents, the signed MoM —
 * so none of them could be filed at all.
 *
 * A predicate in its own file because middleware order is not something a
 * test can easily reach, and the rule itself is the part worth pinning down.
 */
const CONTENT_ROUTE = /^\/api\/v1\/files\/[^/]+\/content\/?$/;

export function isRawUploadRequest(method: string, path: string): boolean {
  return method.toUpperCase() === 'PUT' && CONTENT_ROUTE.test(path);
}
