import { describe, expect, it } from 'vitest';
import { renderMomDocument, type MomDocumentData } from './mom.template.js';

/**
 * The masthead and the signature block are the parts of this document that a
 * government office judges it by before reading a word of it. They were
 * changed on the client's instruction, and they are exactly the sort of thing
 * a later refactor restores by accident, so they are pinned here.
 */
const base: MomDocumentData = {
  meeting: {
    code: 'UCF/P1/RM-06',
    title: 'Monthly review — Project 1',
    type: 'SCHEDULED',
    category: 'WEEKLY_PROGRESS_REVIEW',
    meetingDate: new Date('2026-09-15T00:00:00.000Z'),
    startTime: '11:00',
    endTime: '12:30',
    venue: 'Conference Hall',
    vcLink: null,
    projects: [{ code: 'P1', name: 'Project 1', fullName: 'Underground Drainage — City 1' }],
    chair: { name: 'Officer A', designationName: 'Mission Director' },
  },
  mom: { state: 'DRAFT', version: 1, circulatedAt: null },
  attendance: [
    {
      name: 'Officer A',
      designationName: 'Mission Director',
      departmentName: 'UCF Head Office',
      mark: 'PRESENT',
      isChair: true,
      isWalkIn: false,
    },
  ],
  agenda: [],
  bodyHtml: '<p>The works were reviewed.</p>',
  actions: [],
  clarifications: [],
  annexures: [],
  signatory: {
    name: 'Officer B',
    designationName: 'Additional Mission Director',
    signedAt: null,
  },
  emblemDataUri: null,
  cdmaDataUri: null,
  generatedAt: new Date('2026-09-16T05:00:00.000Z'),
};

const render = (over: Partial<MomDocumentData> = {}) => renderMomDocument({ ...base, ...over });

describe('the masthead', () => {
  it('names the state and the department, on two lines', () => {
    const html = render();
    expect(html).toContain('Government of Telangana');
    expect(html).toContain('Municipal Administration Department');
  });

  it('no longer says "Government of the State"', () => {
    expect(render()).not.toContain('Government of the State');
  });

  it('no longer carries the programme name', () => {
    // Removed on the client's instruction: the masthead names the government
    // and the department, and the document names itself. The programme is
    // identified by the meeting code in the body and the footer.
    expect(render()).not.toContain('Urban Challenge Fund');
  });

  it('names the document itself as the heading', () => {
    const html = render();
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(head).toContain('<h1>Minutes of Meeting</h1>');
  });

  it('carries no reference block — that belongs in the body and the footer', () => {
    const html = render();
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(head).not.toMatch(/<dt>Ref<\/dt>/);
    expect(head).not.toMatch(/<dt>Version<\/dt>/);
    expect(head).not.toMatch(/<dt>Dated<\/dt>/);
  });

  it('still identifies the document somewhere', () => {
    // Removing it from the masthead must not lose it: a minute nobody can
    // reference is not a record.
    expect(render()).toContain('UCF/P1/RM-06');
  });

  it('prints the emblem when one is configured', () => {
    const html = render({ emblemDataUri: 'data:image/png;base64,AAAA' });
    expect(html).toContain('<img class="emblem" src="data:image/png;base64,AAAA"');
  });

  it('prints the CDMA roundel opposite it', () => {
    const html = render({
      emblemDataUri: 'data:image/png;base64,AAAA',
      cdmaDataUri: 'data:image/png;base64,BBBB',
    });
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(head).toContain('<img class="emblem cdma" src="data:image/png;base64,BBBB"');
    // State emblem, wording, CDMA — in that order across the page.
    expect(head.indexOf('class="emblem"')).toBeLessThan(head.indexOf('class="titles"'));
    expect(head.indexOf('class="titles"')).toBeLessThan(head.indexOf('class="emblem cdma"'));
    // Neither side needs a balancing column when both crests are present.
    expect(head).not.toContain('class="spacer"');
  });

  it('keeps the wording centred when only the CDMA roundel is configured', () => {
    const html = render({ emblemDataUri: null, cdmaDataUri: 'data:image/png;base64,BBBB' });
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    // An empty column stands in for the missing crest, so the titles do not
    // slide left. An office with one file gets a balanced masthead.
    expect(head.indexOf('class="spacer"')).toBeLessThan(head.indexOf('class="titles"'));
    expect(head).toContain('head crested');
  });

  it('puts the crest to the left of the titles, with the titles still centred', () => {
    const html = render({ emblemDataUri: 'data:image/png;base64,AAAA' });
    const head = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    // The image comes before the titles in the source, and the balancing
    // column after them — that is what keeps the wording optically centred.
    expect(head.indexOf('class="emblem"')).toBeLessThan(head.indexOf('class="titles"'));
    expect(head.indexOf('class="titles"')).toBeLessThan(head.indexOf('class="spacer"'));
    expect(html).toContain('.head.crested { display:grid; grid-template-columns:104px 1fr 104px;');
  });

  it('drops the balancing columns when there is no crest at all', () => {
    const html = render({ emblemDataUri: null, cdmaDataUri: null });
    expect(html).not.toContain('class="spacer"');
    expect(html).not.toContain('head crested');
  });

  it('prints without a crest rather than a broken image when none is configured', () => {
    const html = render({ emblemDataUri: null });
    expect(html).not.toContain('<img class="emblem"');
    expect(html).toContain('Government of Telangana');
  });
});

describe('the signature block', () => {
  const signed = {
    name: 'Officer B',
    designationName: 'Additional Mission Director',
    signedAt: new Date('2026-09-17T06:12:00.000Z'),
  };

  it('carries the officer it was routed to, and only them', () => {
    const html = render();
    const block = html.slice(html.indexOf('<div class="signatures">'), html.indexOf('<footer'));
    expect(block).toContain('Officer B');
    expect(block).toContain('Additional Mission Director');
    // The chair presided; they did not put their name to the document, and
    // neither did the coordinator who typed it.
    expect(block).not.toContain('Officer A');
    expect(block).not.toContain('Meeting Coordinator');
  });

  it('has exactly one signature', () => {
    // Careful: `class="signatures"` also begins with "sig".
    expect(render().match(/class="sig(?: signed)?"/g)).toHaveLength(1);
  });

  it('sits on the right', () => {
    expect(render()).toContain('.signatures { display:flex; justify-content:flex-end;');
  });

  it('prints a rule and says whom it is waiting for, before signature', () => {
    const html = render();
    expect(html).toContain('<div class="rule">');
    expect(html).toContain('For signature');
    expect(html).not.toContain('class="sig signed"');
  });

  it('prints a green tick, the officer, the designation and the moment, once signed', () => {
    const html = render({ signatory: signed });
    const block = html.slice(html.indexOf('<div class="signatures">'), html.indexOf('<footer'));
    expect(block).toContain('class="sig signed"');
    expect(block).toContain('Officer B');
    expect(block).toContain('Additional Mission Director');
    expect(block).toContain('Signed 17 Sep 2026 at 11:42 IST');
    // The blank rule is gone — there is nothing left to sign.
    expect(block).not.toContain('<div class="rule">');
    expect(block).not.toContain('For signature');
  });

  it('draws the tick rather than typing one', () => {
    // A "✓" renders as a hollow box in Times New Roman on many Windows
    // machines, and this document is printed and filed.
    const html = render({ signatory: signed });
    expect(html).toContain('<svg viewBox="0 0 24 24"');
    expect(html).toContain('#1B7F44');
    expect(html).not.toContain('✓');
  });

  it('stamps the time in IST, not UTC', () => {
    // 06:12 UTC is 11:42 IST on the same day. Getting this wrong puts a
    // signature on the document six hours before the officer made it.
    const html = render({ signatory: signed });
    expect(html).toContain('11:42 IST');
    expect(html).not.toContain('06:12');
  });

  it('prints nothing rather than an empty rule when nobody has been nominated', () => {
    const html = render({ signatory: null });
    expect(html).not.toContain('class="signatures"');
  });
});

describe('annexures', () => {
  const twoDocs = [
    {
      name: 'Revised estimate — Zone A',
      fileName: 'zone-a-revised-estimate.pdf',
      typeLabel: 'Estimate',
      addedByName: 'Officer D',
    },
    {
      name: 'Site photographs',
      fileName: 'site-photos.pdf',
      typeLabel: 'Other',
      addedByName: 'Officer D',
    },
  ];

  it('are not printed at all when nothing was attached', () => {
    const html = render();
    expect(html).not.toContain('Annexures');
    // …and the circulation section keeps its usual number.
    expect(html).toContain('<h2>7. Circulation and next review</h2>');
  });

  it('are listed by name, type and file, and numbered', () => {
    const html = render({ annexures: twoDocs });
    expect(html).toContain('<h2>7. Annexures</h2>');
    expect(html).toContain('A-01');
    expect(html).toContain('A-02');
    expect(html).toContain('Revised estimate — Zone A');
    expect(html).toContain('zone-a-revised-estimate.pdf');
    expect(html).toContain('Estimate');
  });

  it('push the circulation section along rather than colliding with it', () => {
    const html = render({ annexures: twoDocs });
    expect(html).toContain('<h2>8. Circulation and next review</h2>');
    expect(html).not.toContain('<h2>7. Circulation and next review</h2>');
  });

  it('say on the document that they travel with it', () => {
    // The point of naming them: a minute that refers to "the revised estimate"
    // without recording which file that was is unusable a year later.
    expect(render({ annexures: twoDocs })).toContain(
      'The annexures listed above are circulated with these minutes.',
    );
  });
});

describe('the page itself', () => {
  it('is ruled, as government stationery is', () => {
    const html = render();
    expect(html).toMatch(/\.sheet \{[^}]*border:2\.4px solid/);
    expect(html).toContain('.sheet::before');
  });

  it('is set in the typeface government correspondence uses', () => {
    expect(render()).toContain('"Times New Roman","Liberation Serif"');
  });

  it('keeps the border when printed', () => {
    const html = render();
    const print = html.slice(html.indexOf('@media print'));
    expect(print).toContain('box-shadow:none');
  });
});
