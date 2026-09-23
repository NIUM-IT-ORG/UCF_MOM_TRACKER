'use client';

import { useEffect, useRef } from 'react';

/**
 * A small rich-text editor over `contenteditable`.
 *
 * No editor library, for a reason that matters here: the server sanitises to a
 * fixed allow-list — `p h3 b i u mark ol ul li br a[href]` — and anything a
 * heavier editor could produce beyond that would be silently stripped on save.
 * An editor whose buttons produce output the server then discards teaches the
 * officer that the application loses their work. So the toolbar offers exactly
 * what survives, and nothing more.
 *
 * `document.execCommand` is deprecated but is still the only thing every
 * browser implements for this, and the output is sanitised server-side
 * regardless of what it produces.
 */
export function Editor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Only write into the DOM when the value differs, or every keystroke would
  // re-render the node and drop the caret to the start.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  function exec(command: string, arg?: string) {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(command, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  }

  return (
    <div className={`rounded-[10px] border ${disabled ? 'border-line bg-[#F6F8FB]' : 'border-line bg-white'}`}>
      {/*
        * Sticky, because the minutes of a two-hour review run well past one
        * screen and the formatting buttons were scrolling away exactly when
        * they start being needed. `.stage` is the scroll container, so this
        * pins just under the top bar.
        *
        * The background is opaque and matches the card — a translucent
        * toolbar with body text sliding under it is harder to read than no
        * toolbar at all.
        */}
      <div
        className={`sticky top-0 z-10 flex flex-wrap gap-1 rounded-t-[10px] border-b border-line px-2 py-1.5 ${
          disabled ? 'bg-[#F6F8FB]' : 'bg-white'
        }`}
        role="toolbar"
        aria-label="Formatting"
      >
        <Btn label="Heading" title="Sub-heading" onClick={() => exec('formatBlock', 'h3')} disabled={disabled} />
        <Btn label="B" title="Bold" bold onClick={() => exec('bold')} disabled={disabled} />
        <Btn label="I" title="Italic" italic onClick={() => exec('italic')} disabled={disabled} />
        <Btn label="U" title="Underline" underline onClick={() => exec('underline')} disabled={disabled} />
        <Btn
          label="Highlight"
          title="Highlight a decision"
          onClick={() => exec('hiliteColor', '#FDF0C8')}
          disabled={disabled}
        />
        <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
        <Btn label="• List" title="Bulleted list" onClick={() => exec('insertUnorderedList')} disabled={disabled} />
        <Btn label="1. List" title="Numbered list" onClick={() => exec('insertOrderedList')} disabled={disabled} />
        <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
        <Btn label="Paragraph" title="Plain paragraph" onClick={() => exec('formatBlock', 'p')} disabled={disabled} />
        <Btn
          label="Clear"
          title="Remove formatting"
          onClick={() => exec('removeFormat')}
          disabled={disabled}
        />
      </div>

      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Minutes"
        spellCheck
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onBlur={() => onChange(ref.current?.innerHTML ?? '')}
        // Paste as text is not forced: the structure of a pasted agenda is
        // worth keeping, and the server strips the styling anyway.
        className="minutes-body min-h-[340px] px-4 py-3.5 text-[13.5px] leading-relaxed outline-none"
      />
    </div>
  );
}

function Btn({
  label,
  title,
  onClick,
  disabled,
  bold,
  italic,
  underline,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      // onMouseDown, not onClick: clicking a button blurs the editable region
      // and loses the selection before the command can apply to it.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`rounded-md px-2 py-1 text-[11.5px] text-navy transition-colors hover:bg-ice disabled:opacity-40 ${
        bold ? 'font-bold' : ''
      } ${italic ? 'italic' : ''} ${underline ? 'underline' : ''}`}
    >
      {label}
    </button>
  );
}
