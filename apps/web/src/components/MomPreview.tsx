'use client';

import { useRef, useState } from 'react';

/**
 * The MoM document, shown where the decision about it is taken.
 *
 * "Open the document" in a new tab was the only way to read a draft, which
 * means approving one meant leaving the console, reading, coming back and
 * trusting your memory. The document is the thing being approved, so it
 * belongs on the same screen as the buttons that approve it.
 *
 * It is the *same* HTML the PDF is printed from — one template, one output,
 * per the build contract — served through Next's rewrite, so it is
 * same-origin and carries the session cookie like any other request.
 */
export function MomPreview({ meetingId, label }: { meetingId: string; label: string }) {
  const src = `/api/v1/meetings/${meetingId}/mom.html`;
  /*
   * The PDF is not the same thing as printing this preview. The server prints
   * the identical template and then appends the papers tabled at the meeting —
   * which is what the client asked for, and what Ctrl+P can never do, because
   * the browser has no way to staple an attached document onto the page it is
   * printing.
   */
  const pdf = `/api/v1/meetings/${meetingId}/mom.pdf`;
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(true);
  const [tall, setTall] = useState(false);

  function print() {
    // Printing the frame rather than the page: the document carries its own
    // A4 print styles and watermark, and the surrounding application should
    // not appear on the paper.
    const win = frame.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  }

  return (
    <div className="mt-4 rounded-[10px] border border-line bg-[#F9FBFD]">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-3 py-2">
        <button
          type="button"
          className="text-[12px] font-semibold text-navy"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'} {label}
        </button>
        <span className="flex-1" />
        {open && (
          <>
            <button type="button" className="btn-ghost" onClick={() => setTall((v) => !v)}>
              {tall ? 'Shorter' : 'Taller'}
            </button>
            <button type="button" className="btn-ghost" onClick={print}>
              Print this page
            </button>
          </>
        )}
        <a className="btn-ghost" href={src} target="_blank" rel="noreferrer">
          Open full page
        </a>
        <a className="btn-primary" href={pdf} target="_blank" rel="noreferrer">
          PDF with annexures
        </a>
      </div>

      {open && (
        <iframe
          ref={frame}
          src={src}
          title={label}
          className="block w-full rounded-b-[10px] bg-white"
          style={{ height: tall ? 1100 : 560, border: 0 }}
        />
      )}
    </div>
  );
}
