'use client';

import { useId, useState } from 'react';

/**
 * Twelve months of two series, as paired bars.
 *
 * The only chart on the dashboard with a direction. Everything beside it is a
 * snapshot, and a snapshot cannot answer the question a review opens with -
 * whether the backlog is growing or shrinking. Two bars a month, raised
 * against closed, answers it at a glance: the months where the first is
 * taller are the months the pile grew.
 *
 * Drawn as plain SVG for the same reason the donut is: a charting library for
 * twenty-four rectangles is a dependency, a bundle and a theme to fight, and
 * none of it would make this clearer.
 *
 * Identity never rests on colour. Every month carries its label, the totals
 * are printed above the chart, and each bar pair has a `<title>` the browser
 * shows on hover and a screen reader reads.
 */
export interface MonthPoint {
  month: string;
  raised: number;
  closed: number;
}

const H = 150;
const GAP = 3;

export function MonthlyBars({
  data,
  raisedLabel,
  closedLabel,
  raisedColour,
  closedColour,
  empty,
}: {
  data: MonthPoint[];
  raisedLabel: string;
  closedLabel: string;
  raisedColour: string;
  closedColour: string;
  empty: string;
}) {
  const titleId = useId();
  const [hover, setHover] = useState<string | null>(null);

  const peak = Math.max(1, ...data.map((d) => Math.max(d.raised, d.closed)));
  const totalRaised = data.reduce((n, d) => n + d.raised, 0);
  const totalClosed = data.reduce((n, d) => n + d.closed, 0);

  if (totalRaised + totalClosed === 0) {
    return <p className="m-0 text-[12.5px] text-muted">{empty}</p>;
  }

  const slot = 100 / data.length;
  const barW = (slot - GAP) / 2;
  const y = (v: number) => H - (v / peak) * H;
  const active = hover ? data.find((d) => d.month === hover) : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px]">
        <Key colour={raisedColour} label={raisedLabel} value={totalRaised} />
        <Key colour={closedColour} label={closedLabel} value={totalClosed} />
        <span className="ml-auto tabular-nums text-muted">
          {active ? (
            <>
              <b className="text-navy">{monthLabel(active.month)}</b> · {active.raised}{' '}
              {raisedLabel.toLowerCase()} · {active.closed} {closedLabel.toLowerCase()}
            </>
          ) : (
            /*
             * The net, because it is the sentence the chart exists to say and
             * reading it off twenty-four bars is work.
             */
            <>
              {totalRaised === totalClosed
                ? 'Level over twelve months'
                : totalRaised > totalClosed
                  ? `${totalRaised - totalClosed} more raised than closed over twelve months`
                  : `${totalClosed - totalRaised} more closed than raised over twelve months`}
            </>
          )}
        </span>
      </div>

      <svg
        viewBox={`0 0 100 ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={titleId}
        className="block h-[150px] w-full"
      >
        <title id={titleId}>
          {raisedLabel} against {closedLabel}, by month, over the last twelve months
        </title>
        {data.map((d, i) => (
          <g
            key={d.month}
            onMouseEnter={() => setHover(d.month)}
            onMouseLeave={() => setHover(null)}
          >
            {/* A full-height target, so hovering a short bar is not a game of skill. */}
            <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
            <title>
              {monthLabel(d.month)}: {d.raised} {raisedLabel.toLowerCase()}, {d.closed}{' '}
              {closedLabel.toLowerCase()}
            </title>
            <rect
              x={i * slot + GAP / 2}
              y={y(d.raised)}
              width={barW}
              height={H - y(d.raised)}
              fill={raisedColour}
              opacity={hover && hover !== d.month ? 0.45 : 1}
            />
            <rect
              x={i * slot + GAP / 2 + barW}
              y={y(d.closed)}
              width={barW}
              height={H - y(d.closed)}
              fill={closedColour}
              opacity={hover && hover !== d.month ? 0.45 : 1}
            />
          </g>
        ))}
      </svg>

      <div className="mt-1.5 flex text-[10px] text-muted">
        {data.map((d) => (
          <span key={d.month} className="flex-1 text-center">
            {/* Just the initial at this width; the full month is in the hover. */}
            {monthLabel(d.month).slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Key({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden
        className="block h-[10px] w-[10px] rounded-sm"
        style={{ background: colour }}
      />
      <span className="text-ink">{label}</span>
      <b className="tabular-nums text-navy">{value}</b>
    </span>
  );
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-09" to "September 2026", without constructing a Date for a label. */
function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}
