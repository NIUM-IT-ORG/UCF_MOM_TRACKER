'use client';

import { PROJECT_STATUS_LABEL, type ProjectStatus } from '@mom/shared';

/**
 * The small pieces every screen reuses, lifted from the prototype.
 *
 * They live together so a card looks the same on the project master as it does
 * on the register — the alternative is twelve slightly different cards, which
 * is what makes an application feel assembled rather than designed.
 */

export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10.5px] font-extrabold uppercase tracking-[2px] text-accent">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-0.5 font-serif text-[23px] font-semibold text-navy">{title}</h2>
        {lede && <p className="mt-1.5 max-w-[820px] text-[13.5px] text-muted">{lede}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  tag,
  actions,
  children,
  className = '',
}: {
  title?: string;
  tag?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-[17px] py-[13px]">
          {title && <h3 className="m-0 text-[14.5px] font-bold text-navy">{title}</h3>}
          {tag && <span className="text-[11px] text-muted">{tag}</span>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-[18px] flex gap-0.5 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[12.5px] font-semibold ${
            active === t.key
              ? 'border-accent text-navy'
              : 'border-transparent text-muted hover:text-navy'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={`rounded-full px-[7px] py-px text-[10.5px] font-extrabold ${
                active === t.key ? 'bg-ice text-blue' : 'bg-[#EDF1F6] text-muted'
              }`}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<ProjectStatus, string> = {
  PLANNING: 'bg-[#EDF1F6] text-[#64707F]',
  PROCUREMENT: 'bg-[#FFF2E0] text-[#A66A12]',
  UNDER_EXECUTION: 'bg-[#EAF1F9] text-[#2E5FA3]',
  COMPLETED: 'bg-[#E6F4EC] text-[#1B8A57]',
  ON_HOLD: 'bg-[#FBEBE8] text-[#BF3B2B]',
};

export function StatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${
        STATUS_STYLE[status] ?? STATUS_STYLE.PLANNING
      }`}
    >
      <i
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: 'currentColor' }}
        aria-hidden="true"
      />
      {PROJECT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ProjectTag({ code }: { code: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-md border border-ice2 bg-ice px-2 py-0.5 text-[10px] font-bold text-navy">
      {code}
    </span>
  );
}

export function Avatar({
  initials,
  colour = '#5E7DAA',
  size = 31,
}: {
  initials: string;
  colour?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-full font-bold text-white"
      style={{ background: colour, width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

/**
 * Empty states say what to do next. "No data" tells the reader nothing and
 * leaves them wondering whether the screen is broken — docs/07-UI-SPEC.md §2.
 */
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-[34px] text-center text-[13px] text-muted">{children}</div>;
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'amber' | 'red' | 'green';
  children: React.ReactNode;
}) {
  const styles = {
    info: 'bg-ice border-ice2',
    amber: 'bg-[#FEF7EC] border-[#EFD9AC]',
    red: 'bg-[#FDF3F1] border-[#EBC7C0]',
    green: 'bg-[#F1FAF5] border-[#BEE3CF]',
  } as const;
  return (
    <div className={`mb-3 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] ${styles[tone]}`}>
      {children}
    </div>
  );
}

/** A table that scrolls inside itself, so the page body never scrolls sideways. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}
