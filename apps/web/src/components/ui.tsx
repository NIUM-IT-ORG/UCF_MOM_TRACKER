'use client';

import {
  ACTION_STATUS_COLOR,
  ACTION_STATUS_LABEL,
  CLARIFICATION_STATUS_COLOR,
  CLARIFICATION_STATUS_LABEL,
  MEETING_STAGE_LABEL,
  MOM_STATE_LABEL,
  PROJECT_STATUS_LABEL,
  type ActionStatus,
  type ClarificationStatus,
  type ItemType,
  type MeetingStage,
  type MomState,
  type ProjectStatus,
} from '@mom/shared';

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

// ─────────────────────── meetings, MoM and items ───────────────────────

const STAGE_STYLE: Record<string, string> = {
  PLANNED: 'bg-[#EEF2F7] text-[#5A6B82]',
  AGENDA: 'bg-[#EEF2F7] text-[#5A6B82]',
  INVITEES: 'bg-[#EEF2F7] text-[#5A6B82]',
  INVITEE_INPUTS: 'bg-[#FFF2E0] text-[#A66A12]',
  CONFIRMED: 'bg-[#EAF1F9] text-[#2E5FA3]',
  COMPOSED: 'bg-[#EEF2F7] text-[#5A6B82]',
  LIVE: 'bg-[#FBEBE8] text-[#BF3B2B]',
  HELD: 'bg-[#F3EAF8] text-[#7D3C98]',
  MINUTED: 'bg-[#FFF2E0] text-[#A66A12]',
  CLOSED: 'bg-[#E6F4EC] text-[#1B8A57]',
  CANCELLED: 'bg-[#EEF2F7] text-[#8A94A3] line-through',
};

export function StageChip({ stage }: { stage: MeetingStage }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${
        STAGE_STYLE[stage] ?? STAGE_STYLE.PLANNED
      }`}
    >
      <i className="h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor' }} aria-hidden="true" />
      {MEETING_STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

const MOM_STYLE: Record<string, string> = {
  NOT_GENERATED: 'bg-[#EEF2F7] text-[#5A6B82]',
  DRAFT: 'bg-[#EEF2F7] text-[#5A6B82]',
  SUBMITTED: 'bg-[#FFF2E0] text-[#A66A12]',
  RETURNED: 'bg-[#FBEBE8] text-[#BF3B2B]',
  APPROVED: 'bg-[#EAF1F9] text-[#2E5FA3]',
  SIGNED: 'bg-[#E6F4EC] text-[#1B8A57]',
};

export function MomChip({ state }: { state: MomState }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${
        MOM_STYLE[state] ?? MOM_STYLE.DRAFT
      }`}
    >
      <i className="h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor' }} aria-hidden="true" />
      {MOM_STATE_LABEL[state] ?? state}
    </span>
  );
}

/**
 * The two item vocabularies, each with its own colour from `@mom/shared`.
 *
 * The colours are not chosen here. They come from the shared constants the two
 * dashboard donuts also read, which is what stops a status being one colour on
 * a chart and another in a table.
 */
export function ItemStatusChip({
  type,
  status,
  isActive = true,
}: {
  type: ItemType;
  status: ActionStatus | ClarificationStatus | null;
  /**
   * An item that has not been circulated shows as "Not yet active" whatever
   * status it carries. Inertness is `activatedAt`, not a missing status — the
   * database requires every item to have one from the moment it is created.
   */
  isActive?: boolean;
}) {
  if (!status || !isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#EEF2F7] px-2.5 py-1 text-[11px] font-bold text-[#8A94A3]">
        Not yet active
      </span>
    );
  }
  const colour =
    type === 'ACTION'
      ? ACTION_STATUS_COLOR[status as ActionStatus]
      : CLARIFICATION_STATUS_COLOR[status as ClarificationStatus];
  const label =
    type === 'ACTION'
      ? ACTION_STATUS_LABEL[status as ActionStatus]
      : CLARIFICATION_STATUS_LABEL[status as ClarificationStatus];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ color: colour, background: `${colour}1a` }}
    >
      <i className="h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor' }} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * A field with its label, error and hint — the shape every form on this
 * product uses, so that a required field looks required everywhere.
 */
export function Field({
  label,
  required,
  /** A value that cannot be changed here — neither required nor optional. */
  fixed,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  fixed?: boolean;
  error?: string | null;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold text-navy">
        {label}
        {fixed ? null : required ? (
          <span className="text-danger"> *</span>
        ) : (
          <span className="font-normal text-muted"> optional</span>
        )}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-[11.5px] font-semibold text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

/** The numbered progress rail on the four-step scheduled wizard. */
export function Steps({
  steps,
  current,
  onGo,
}: {
  steps: string[];
  current: number;
  onGo?: (index: number) => void;
}) {
  return (
    <ol className="mb-4 flex flex-wrap gap-1.5 p-0" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i === current ? 'current' : i < current ? 'done' : 'todo';
        return (
          <li key={label} className="flex-1 list-none">
            <button
              type="button"
              onClick={onGo && i <= current ? () => onGo(i) : undefined}
              aria-current={state === 'current' ? 'step' : undefined}
              disabled={!onGo || i > current}
              className={`flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-left text-[12px] font-semibold transition-colors ${
                state === 'current'
                  ? 'border-blue bg-blue text-white'
                  : state === 'done'
                    ? 'border-ice2 bg-ice text-navy hover:border-steel'
                    : 'border-line bg-white text-muted'
              }`}
            >
              <span
                className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[10px] font-extrabold ${
                  state === 'current' ? 'bg-white/25' : state === 'done' ? 'bg-white text-blue' : 'bg-[#EEF2F7]'
                }`}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span className="truncate">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
