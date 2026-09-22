import { describe, expect, it } from 'vitest';
import {
  agendaWatermark,
  carriedStatusLabel,
  renderAgendaDocument,
  type AgendaDocumentData,
} from './agenda.template.js';

/**
 * The agenda is the document an invitee reads before the meeting, and the one
 * they act on: it tells them what is being discussed, what they still owe from
 * last time, and whether they can still add to it. Every one of those is
 * pinned here, because each is a sentence somebody plans their week around.
 */
const base: AgendaDocumentData = {
  meeting: {
    code: 'UCF/P1/RM-06',
    title: 'Monthly review — Project 1',
    type: 'SCHEDULED',
    category: 'WEEKLY_PROGRESS_REVIEW',
    stage: 'CONFIRMED',
    meetingDate: new Date('2026-09-15T00:00:00.000Z'),
    startTime: '11:00',
    endTime: '12:30',
    venue: 'Conference Hall',
    vcLink: null,
    projects: [{ code: 'P1', name: 'Project 1', fullName: 'Underground Drainage — City 1' }],
    chair: { name: 'Officer A', designationName: 'Mission Director' },
    agendaFreezeAt: null,
    confirmedAt: new Date('2026-09-10T06:00:00.000Z'),
    cancelledReason: null,
  },
  items: [
    {
      ordinal: 1,
      text: 'Progress on package 3',
      projectName: 'Project 1',
      addedByName: 'Officer C',
      isCarryBlock: false,
      isDeferred: false,
      carried: [],
    },
  ],
  invitees: [
    {
      name: 'Officer A',
      designationName: 'Mission Director',
      departmentName: 'UCF Head Office',
      isChair: true,
    },
  ],
  papers: [],
  emblemDataUri: null,
  cdmaDataUri: null,
  generatedAt: new Date('2026-09-11T05:00:00.000Z'),
};

const render = (over: Partial<AgendaDocumentData> = {}) =>
  renderAgendaDocument({ ...base, ...over });

const withMeeting = (over: Partial<AgendaDocumentData['meeting']>) =>
  render({ meeting: { ...base.meeting, ...over } });

describe('the masthead', () => {
  it('is the same government letterhead the minutes carry', () => {
    const html = render();
    expect(html).toContain('Government of Telangana');
    expect(html).toContain('Municipal Administration Department');
  });

  it('names the document as an agenda, not as minutes', () => {
    const html = render();
    expect(html).toContain('<h1>Agenda</h1>');
    expect(html).not.toContain('Minutes of Meeting');
  });

  it('prints both crests when they are configured, in the same order as the minutes', () => {
    const html = render({
      emblemDataUri: 'data:image/png;base64,AAAA',
      cdmaDataUri: 'data:image/png;base64,BBBB',
    });
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(head.indexOf('class="emblem"')).toBeLessThan(head.indexOf('class="titles"'));
    expect(head.indexOf('class="titles"')).toBeLessThan(head.indexOf('class="emblem cdma"'));
  });

  it('prints without a crest rather than a broken image when none is configured', () => {
    expect(render()).not.toContain('<img class="emblem"');
  });
});

describe('the draft watermark', () => {
  /*
   * The rule that matters: an invitee who prints an agenda while it is still
   * being assembled must be able to see that it is not final.
   */
  it.each(['PLANNED', 'AGENDA', 'INVITEES', 'INVITEE_INPUTS'] as const)(
    'marks an agenda DRAFT at %s',
    (stage) => {
      expect(agendaWatermark(stage)).toBe('DRAFT');
      expect(withMeeting({ stage })).toContain('<span>DRAFT</span>');
    },
  );

  it('drops the watermark once the meeting is confirmed', () => {
    expect(agendaWatermark('CONFIRMED')).toBeNull();
    expect(withMeeting({ stage: 'CONFIRMED' })).not.toContain('<span>DRAFT</span>');
  });

  it('stays unmarked for every stage after confirmation', () => {
    for (const stage of ['HELD', 'MINUTED', 'CLOSED', 'LIVE', 'COMPOSED'] as const) {
      expect(agendaWatermark(stage)).toBeNull();
    }
  });

  it('marks a cancelled meeting CANCELLED, and says why on the page', () => {
    expect(agendaWatermark('CANCELLED')).toBe('CANCELLED');
    const html = withMeeting({ stage: 'CANCELLED', cancelledReason: 'Chair unavailable' });
    expect(html).toContain('<span>CANCELLED</span>');
    expect(html).toContain('This meeting was cancelled.');
    expect(html).toContain('Chair unavailable');
  });
});

describe('the agenda points', () => {
  it('lists each point with its project and who raised it', () => {
    const html = render();
    expect(html).toContain('Progress on package 3');
    expect(html).toContain('Project 1');
    expect(html).toContain('Officer C');
  });

  it('says so plainly when nothing has been added yet', () => {
    expect(render({ items: [] })).toContain('No agenda points have been added yet.');
  });

  /*
   * Deferring keeps the point on the record and marks it as not taken.
   * Dropping it would leave the agenda shorter than the one that was
   * circulated — the same rule agenda.service.ts enforces on delete.
   */
  it('keeps a deferred point on the page and marks it', () => {
    const html = render({
      items: [{ ...base.items[0], isDeferred: true }],
    });
    expect(html).toContain('Progress on package 3');
    expect(html).toContain('deferred');
    expect(html).toContain('class="deferred"');
  });

  it('escapes a point somebody typed a tag into', () => {
    const html = render({
      items: [{ ...base.items[0], text: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the carried-forward block', () => {
  const carried: AgendaDocumentData['items'][number] = {
    ordinal: 0,
    text: 'Review of items from previous meetings',
    projectName: null,
    addedByName: 'Officer C',
    isCarryBlock: true,
    isDeferred: false,
    carried: [
      {
        ref: 'ACT-07',
        description: 'Submit the revised estimate',
        owners: ['Officer D', 'Officer E'],
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        revisedDue: null,
        priority: 'VERY_HIGH',
        statusLabel: 'In Progress',
        carryCount: 1,
      },
    ],
  };

  const withCarry = (over: Partial<(typeof carried)['carried'][number]> = {}) =>
    render({ items: [{ ...carried, carried: [{ ...carried.carried[0], ...over }] }, base.items[0]] });

  it('opens the agenda, ahead of the new points', () => {
    const html = withCarry();
    expect(html).toContain('1. Review of items from previous meetings');
    expect(html.indexOf('Review of items from previous meetings')).toBeLessThan(
      html.indexOf('Progress on package 3'),
    );
  });

  /*
   * The whole point of printing these in full: "5 items carried forward" is
   * not something an officer can prepare against.
   */
  it('prints the ref, the owners, the date and the status rather than a count', () => {
    const html = withCarry();
    expect(html).toContain('ACT-07');
    expect(html).toContain('Submit the revised estimate');
    expect(html).toContain('Officer D, Officer E');
    expect(html).toContain('1 Sep 2026');
    expect(html).toContain('In Progress');
  });

  it('renumbers the new points as section 2 when a carry block is present', () => {
    expect(withCarry()).toContain('2. Agenda');
    expect(render()).toContain('1. Agenda');
  });

  /*
   * An item round more than once is the fact that ought to provoke a question
   * in the room, so it is on the page rather than inferrable.
   */
  it('flags an item that has been carried more than once', () => {
    expect(withCarry({ carryCount: 3 })).toContain('carried 3×');
    expect(withCarry({ carryCount: 1 })).not.toContain('carried 1×');
  });

  it('shows the revised date, marked as revised, when one was set', () => {
    const html = withCarry({ revisedDue: new Date('2026-10-05T00:00:00.000Z') });
    expect(html).toContain('5 Oct 2026');
    expect(html).toContain('revised');
  });

  it('is left out entirely when nothing was carried', () => {
    const html = render({ items: [{ ...carried, carried: [] }, base.items[0]] });
    expect(html).not.toContain('Review of items from previous meetings');
    expect(html).toContain('1. Agenda');
  });
});

describe('the freeze notice', () => {
  const freeze = new Date('2026-09-14T06:00:00.000Z');

  /*
   * This is the one instruction on the page an invitee has to act on, so it
   * is a date in words rather than a stage name they have never seen.
   */
  it('tells invitees the deadline while contributions are still open', () => {
    const html = withMeeting({ stage: 'INVITEE_INPUTS', agendaFreezeAt: freeze, confirmedAt: null });
    expect(html).toContain('Invitees may add points to this agenda until');
    expect(html).toContain('14 Sep 2026 at 11:30 IST');
  });

  it('says contributions have closed once the freeze has passed', () => {
    const html = renderAgendaDocument({
      ...base,
      meeting: {
        ...base.meeting,
        stage: 'INVITEE_INPUTS',
        agendaFreezeAt: freeze,
        confirmedAt: null,
      },
      generatedAt: new Date('2026-09-14T12:00:00.000Z'),
    });
    expect(html).toContain('Contributions to this agenda closed on');
    expect(html).toContain('The coordinator can still amend it');
  });

  it('drops the notice once the meeting is confirmed — the agenda is final', () => {
    const html = withMeeting({ agendaFreezeAt: freeze });
    expect(html).not.toContain('Invitees may add points');
    expect(html).not.toContain('Contributions to this agenda closed');
  });

  it('never shows it for an instant meeting, which has no freeze', () => {
    const html = withMeeting({ type: 'INSTANT', agendaFreezeAt: null, confirmedAt: null });
    expect(html).not.toContain('Invitees may add points');
    expect(html).toContain('Instant meeting.');
  });
});

describe('the invitees and the papers', () => {
  it('lists the invitees and marks the chair', () => {
    const html = render();
    expect(html).toContain('Officer A');
    expect(html).toContain('Mission Director');
    expect(html).toContain('<b>(Chair)</b>');
  });

  /*
   * Listed, not merged. The minutes carry their annexures because a signed
   * minute is the record; an agenda is a notice that has to stay readable.
   */
  it('names the papers and says where they are held', () => {
    const html = render({
      papers: [{ name: 'Revised estimate', fileName: 'estimate-v2.pdf', typeLabel: 'Estimate' }],
    });
    expect(html).toContain('Revised estimate');
    expect(html).toContain('estimate-v2.pdf');
    expect(html).toContain('can be downloaded there');
  });

  it('leaves the section out entirely when nothing is tabled', () => {
    expect(render()).not.toContain('Papers for this meeting');
  });
});

describe('the footer', () => {
  it('identifies the meeting and marks a draft as not yet confirmed', () => {
    const html = withMeeting({ stage: 'AGENDA', confirmedAt: null });
    expect(html).toContain('UCF/P1/RM-06');
    expect(html).toContain('Draft agenda · not yet confirmed');
  });

  it('records the confirmation date on a confirmed agenda', () => {
    expect(render()).toContain('Agenda confirmed 10 Sep 2026');
  });
});

describe('the status label of a carried item', () => {
  it('reads an action from its action status', () => {
    expect(carriedStatusLabel('IN_PROGRESS', null)).toBe('In Progress');
  });

  it('reads a clarification from its own status', () => {
    expect(carriedStatusLabel(null, 'OPEN')).toBe('Open');
  });

  /*
   * The items_shape constraint guarantees one of the two is always set, so
   * this is defence rather than an expected state — but a dash is the right
   * thing to print if the guarantee ever fails, not "undefined".
   */
  it('prints a dash rather than undefined when neither is set', () => {
    expect(carriedStatusLabel(null, null)).toBe('—');
  });
});
