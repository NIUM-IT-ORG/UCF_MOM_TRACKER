'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { Card, Empty, Notice, PageHead, TableWrap } from '@/components/ui';
import { WhoCan } from '@/components/WhoCan';

/**
 * Which months' commitments the dashboard counts.
 *
 * A year of conducted meetings leaves the dashboard describing mostly
 * history. Switching a month off takes everything raised in that month's
 * meetings out of every figure on that page.
 *
 * The screen has one job beyond the switches: being honest about what they
 * do. Disabling a month hides live, assigned, overdue commitments from
 * everybody who reads the dashboard, and the officers responsible for them
 * are not told. So the counts sit beside each switch before it is thrown, and
 * the dashboard carries a banner afterwards.
 */
interface MonthRow {
  month: string;
  enabled: boolean;
  meetings: number;
  actions: number;
  clarifications: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export default function DashboardMonthsPage() {
  const { caps } = useSession();
  const allowed = caps.includes('manage_masters');

  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    api<MonthRow[]>('/dashboard/months')
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.display : 'Could not load the months.'),
      );
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function toggle(row: MonthRow) {
    setSaving(row.month);
    setError(null);
    try {
      const next = await api<MonthRow[]>('/dashboard/months', {
        method: 'PUT',
        body: JSON.stringify({ months: [{ month: row.month, enabled: !row.enabled }] }),
      });
      // The server answers with the whole list, so this screen never has to
      // guess what it now looks like.
      setRows(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.display : 'That could not be saved.');
    } finally {
      setSaving(null);
    }
  }

  if (!allowed) {
    return (
      <>
        <PageHead eyebrow="System" title="Dashboard months" />
        <Card>
          <div className="px-[17px] py-4">
            <WhoCan
              capability="manage_masters"
              lead="This decides what every officer's dashboard counts."
              who="Changing it is"
            />
          </div>
        </Card>
      </>
    );
  }

  const hidden = (rows ?? []).filter((r) => !r.enabled);
  const hiddenItems = hidden.reduce((n, r) => n + r.actions + r.clarifications, 0);

  return (
    <>
      <PageHead
        eyebrow="System"
        title="Dashboard months"
        lede="Which months' actions and clarifications are counted on the dashboard. Nothing here deletes anything."
      />

      {error && <Notice tone="red">{error}</Notice>}

      <Notice tone="amber">
        <b>This hides work, it does not close it.</b> An action in a switched-off month stays
        live, stays assigned and stays overdue if its date has passed — it is still in the Action
        Register, still in every report and still on the meeting it came from. What changes is
        that the dashboard stops counting it, for everybody, and the officer responsible is not
        told. The dashboard states how much it is leaving out.
      </Notice>

      {hidden.length > 0 && (
        <Notice tone="red">
          <b>
            {hidden.length} {hidden.length === 1 ? 'month is' : 'months are'} switched off
          </b>
          , taking {hiddenItems} {hiddenItems === 1 ? 'item' : 'items'} out of the dashboard:{' '}
          {hidden.map((h) => monthLabel(h.month)).join(', ')}.
        </Notice>
      )}

      <div className="mt-4">
        <Card
          title="Months with meetings"
          tag={rows ? `${rows.length} · newest first` : 'Loading…'}
        >
          {!rows ? (
            <Empty>Loading the months…</Empty>
          ) : rows.length === 0 ? (
            <Empty>
              No meeting has been held yet, so there is no month to configure. A month appears
              here on its own once it has one.
            </Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Meetings</th>
                    <th>Actions</th>
                    <th>Clarifications</th>
                    <th>On the dashboard</th>
                    <th>Last changed</th>
                    <th aria-label="Switch" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <td className="whitespace-nowrap">
                        <b className="text-navy">{monthLabel(r.month)}</b>
                      </td>
                      <td className="tabular-nums">{r.meetings}</td>
                      <td className="tabular-nums">{r.actions}</td>
                      <td className="tabular-nums">{r.clarifications}</td>
                      <td className="whitespace-nowrap">
                        {r.enabled ? (
                          <span className="inline-flex items-center rounded-full bg-[#E7F4EC] px-2.5 py-1 text-[11px] font-bold text-[#1B8A57]">
                            Counted
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-[#FBEBE8] px-2.5 py-1 text-[11px] font-bold text-[#BF3B2B]">
                            Not counted
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-[11.5px] text-muted">
                        {r.updatedAt ? (
                          <>
                            {formatDate(r.updatedAt)}
                            {r.updatedBy ? ` · ${r.updatedBy}` : ''}
                          </>
                        ) : (
                          /* Never configured, which is the same as counted. */
                          <span>Default</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button
                          type="button"
                          className={r.enabled ? 'btn-ghost' : 'btn-primary'}
                          disabled={saving !== null}
                          onClick={() => void toggle(r)}
                        >
                          {saving === r.month
                            ? 'Saving…'
                            : r.enabled
                              ? 'Switch off'
                              : 'Switch on'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <div className="border-t border-line px-[17px] py-3 text-[11.5px] text-muted">
            A month with no row here has never been configured, and is counted. New months are
            counted from the moment their first meeting is held — nobody has to remember to
            switch them on.
          </div>
        </Card>
      </div>
    </>
  );
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}
