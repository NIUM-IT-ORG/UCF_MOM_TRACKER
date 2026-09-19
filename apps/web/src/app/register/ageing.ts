import type { ItemRow } from '@/lib/meetings';

/** The ageing column, worded as docs/05 words it. */
export function ageing(i: ItemRow): string {
  if (i.type === 'CLARIFICATION') {
    if (i.clarificationStatus === 'CLOSED') return 'closed';
    const days = Math.max(
      0,
      Math.round((Date.now() - new Date(i.meeting.meetingDate).getTime()) / 86_400_000),
    );
    return `${days} day${days === 1 ? '' : 's'} open`;
  }
  if (i.actionStatus === 'COMPLETED') return 'closed';
  if (i.daysOverdue > 0) {
    return i.awaitingConfirmation
      ? `${i.daysOverdue} day${i.daysOverdue === 1 ? '' : 's'} with the confirmer`
      : `${i.daysOverdue} day${i.daysOverdue === 1 ? '' : 's'} late`;
  }
  if (!i.dueDate) return '—';
  const left = Math.round((new Date(i.dueDate).getTime() - Date.now()) / 86_400_000);
  if (left <= 0) return 'due today';
  return `due in ${left} day${left === 1 ? '' : 's'}`;
}
