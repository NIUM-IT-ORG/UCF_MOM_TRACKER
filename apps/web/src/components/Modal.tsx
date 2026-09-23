'use client';

import { useEffect, useRef } from 'react';

/**
 * A dialog.
 *
 * It exists because some forms need room. The one that prompted it — raising an
 * action from the minutes — was squeezed into a 380px column beside the editor,
 * which is why the officer picker could show a name and a three-letter code and
 * nothing else. Given a dialog it can show who the officer is, what they do and
 * which projects they can see, which is the information you actually need
 * before making somebody accountable for something.
 *
 * The keyboard and screen-reader behaviour is not decoration: this is a
 * government system and somebody will drive it without a mouse.
 *   · Escape closes it.
 *   · Clicking the backdrop closes it; clicking inside does not.
 *   · Focus moves into the dialog on open and returns to whatever opened it.
 *   · Tab is kept inside while it is open.
 *   · The page behind does not scroll.
 */
export function Modal({
  title,
  lede,
  onClose,
  children,
  footer,
  width = 820,
}: {
  title: string;
  lede?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  /*
   * The latest onClose, without it being a dependency.
   *
   * Every caller passes an inline arrow — `onClose={() => setOpen(false)}` —
   * so the prop is a new function on every render. With `[onClose]` as the
   * dependency the whole effect tore down and re-ran on each one, and since
   * it both restores focus on cleanup and grabs it on setup, typing a single
   * letter into any field in any dialog threw focus to the close button. The
   * next keystroke went nowhere.
   *
   * A ref keeps the handler current while the effect runs once, on mount,
   * which is what "trap the focus while this dialog is open" actually means.
   */
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    /*
     * The first field, not the close button: opening a form and landing on
     * "cancel" is a small insult repeated every time.
     *
     * That was the intent all along, but the close button sits in the header
     * and so is first in document order — `focusable()[0]` was picking
     * exactly the control the comment said to avoid. It is skipped here for
     * the opening focus only; it stays in the tab cycle, where it belongs.
     */
    const items = focusable();
    const opener = items.find((el) => el.dataset.modalClose === undefined) ?? items[0];
    opener?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        latestClose.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const cycle = focusable();
      const first = cycle[0];
      const last = cycle[cycle.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      returnTo.current?.focus?.();
    };
    // Mount only, deliberately: see the note on `latestClose` above. A
    // dependency here re-runs the focus trap mid-edit and steals the caret.
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,29,48,.55)] p-4 sm:p-8"
      onMouseDown={(e) => {
        // mousedown, not click: a drag that starts inside the panel and ends on
        // the backdrop should not close the form the officer is filling in.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto w-full rounded-[14px] bg-white shadow-[0_24px_64px_rgba(16,29,48,.34)]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start gap-4 border-b border-line px-[22px] py-4">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[16px] font-extrabold text-navy">{title}</h2>
            {lede && <p className="mb-0 mt-1 text-[12px] text-muted">{lede}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            // Skipped when choosing where focus lands on open; still tabbable.
            data-modal-close=""
            aria-label="Close"
            className="-mr-1 rounded-lg px-2 py-1 text-[20px] leading-none text-muted hover:bg-[#F4F7FB] hover:text-navy"
          >
            ×
          </button>
        </div>

        <div className="px-[22px] py-5">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2.5 border-t border-line px-[22px] py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
