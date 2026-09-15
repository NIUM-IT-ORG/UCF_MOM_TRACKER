'use client';

import { useRef, useState } from 'react';
import { DOCUMENT_TYPE_LABEL, type DocumentType } from '@mom/shared';
import { ApiError, api } from '@/lib/api';
import { Card, Notice } from '@/components/ui';
import { formatBytes } from '@/lib/format';

const TYPES = Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[];

/**
 * Adding a document: a name, a type and a file, all three required.
 *
 * The client asked for this by name, and it is the rule most likely to be
 * softened by whoever is in a hurry. It is enforced on the server; the form
 * only saves the officer a round trip. Note that the name is asked for *first*
 * — the moment someone uploads a file is the only moment they know what it is.
 */
export function DocumentUpload({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DocumentType>('SANCTION_ORDER');
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const nameBad = touched && name.trim().length < 3;
  const fileBad = touched && !file;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (name.trim().length < 3 || !file) return;

    setBusy(true);
    try {
      // Step one: reserve a row and find out where the bytes go.
      const { fileId, uploadUrl } = await api<{ fileId: string; uploadUrl: string }>('/files', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });

      // Step two: the bytes themselves. Not JSON, so this one bypasses `api`.
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) {
        const body = (await put.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new ApiError('INTERNAL', body?.error?.message ?? 'The upload failed.', put.status);
      }

      // Step three: the document that gives the file a name.
      await api(`/projects/${projectId}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type,
          fileId,
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        }),
      });

      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'Could not add the document.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add a document">
      <form onSubmit={submit} className="px-[17px] py-4" noValidate>
        <Notice>
          A name and a file are both required. A folder of <code>scan_0043.pdf</code> is
          unusable within a year, and this is the only moment anyone knows what the file is.
        </Notice>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
              Document name <span className="text-danger">*</span>
            </span>
            <input
              className={`i ${nameBad ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Administrative sanction order"
              aria-invalid={nameBad}
            />
            {nameBad && (
              <span role="alert" className="mt-1 block text-[11.5px] font-semibold text-danger">
                Give the document a name someone else would recognise.
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
              Type <span className="text-danger">*</span>
            </span>
            <select className="i" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
            File <span className="text-danger">*</span>
          </span>
          <div
            className={`rounded-xl border-[1.5px] border-dashed p-5 text-center ${
              fileBad ? 'border-[#D98C7F] bg-[#FEF8F7]' : 'border-[#B9C6D6] bg-[#F9FBFD]'
            }`}
          >
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="btn-ghost" onClick={() => fileInput.current?.click()}>
              Choose a file
            </button>
            <div className="mt-2 text-[12.5px] text-muted">
              {file ? (
                <>
                  <b className="text-navy">{file.name}</b> · {formatBytes(file.size)}
                </>
              ) : (
                'PDF, image, Word, Excel or PowerPoint. Up to 25 MB.'
              )}
            </div>
          </div>
          {fileBad && (
            <span role="alert" className="mt-1 block text-[11.5px] font-semibold text-danger">
              Choose the file to attach.
            </span>
          )}
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
            Remarks <span className="font-normal text-muted">optional</span>
          </span>
          <textarea
            className="i min-h-[64px]"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Superseded by the revision of 12 August, kept for the record"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-[#FDF3F1] px-3 py-2.5 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Adding…' : 'Add document'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
