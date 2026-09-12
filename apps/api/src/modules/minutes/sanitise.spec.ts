import { describe, expect, it } from 'vitest';
import { htmlToText, sanitiseHtml } from './sanitise.js';

describe('the minutes sanitiser', () => {
  it('keeps the allowed tags', () => {
    const html = '<p>The <b>drainage</b> work is <i>behind</i> and <u>must</u> be <mark>reviewed</mark>.</p>';
    expect(sanitiseHtml(html)).toBe(html);
  });

  it('keeps lists and headings', () => {
    expect(sanitiseHtml('<h3>Zone 4</h3><ul><li>One</li><li>Two</li></ul>')).toBe(
      '<h3>Zone 4</h3><ul><li>One</li><li>Two</li></ul>',
    );
    expect(sanitiseHtml('<ol><li>First</li></ol>')).toBe('<ol><li>First</li></ol>');
  });

  it('rewrites the tags Word and Google Docs actually emit', () => {
    expect(sanitiseHtml('<strong>x</strong>')).toBe('<b>x</b>');
    expect(sanitiseHtml('<em>x</em>')).toBe('<i>x</i>');
    expect(sanitiseHtml('<h1>Heading</h1>')).toBe('<h3>Heading</h3>');
    expect(sanitiseHtml('<div>Paragraph</div>')).toBe('<p>Paragraph</p>');
  });

  it('strips every style and class, which is the whole point', () => {
    expect(sanitiseHtml('<p style="font-family:Calibri;color:#f00" class="MsoNormal">Text</p>')).toBe(
      '<p>Text</p>',
    );
  });

  it('removes a tag but keeps its text', () => {
    expect(sanitiseHtml('<table><tr><td>Cell</td></tr></table>')).toBe('Cell');
    expect(sanitiseHtml('<span>Kept</span>')).toBe('Kept');
  });

  it('removes script and style content entirely', () => {
    expect(sanitiseHtml('<p>Before</p><script>alert(1)</script><p>After</p>')).toBe(
      '<p>Before</p><p>After</p>',
    );
    expect(sanitiseHtml('<style>p{color:red}</style><p>Text</p>')).toBe('<p>Text</p>');
  });

  it('removes an unclosed script rather than leaving its body as text', () => {
    expect(sanitiseHtml('<p>Hi</p><script>alert(1)')).toBe('<p>Hi</p>');
  });

  it('drops an onerror handler with the tag that carried it', () => {
    expect(sanitiseHtml('<img src=x onerror="alert(1)">')).toBe('');
    expect(sanitiseHtml('<p onclick="alert(1)">Text</p>')).toBe('<p>Text</p>');
  });

  it('keeps an http link and adds the attributes we want, not the ones sent', () => {
    expect(sanitiseHtml('<a href="https://ucf.gov.in/order" target="_self">Order</a>')).toBe(
      '<a href="https://ucf.gov.in/order" target="_blank" rel="noopener noreferrer">Order</a>',
    );
  });

  it('keeps a mailto link', () => {
    expect(sanitiseHtml('<a href="mailto:pd@example.gov">PD</a>')).toContain(
      'href="mailto:pd@example.gov"',
    );
  });

  it('refuses javascript: and data: hrefs, keeping the text', () => {
    expect(sanitiseHtml('<a href="javascript:alert(1)">Click</a>')).toBe('<a>Click</a>');
    expect(sanitiseHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">Click</a>')).toBe(
      '<a>Click</a>',
    );
    expect(sanitiseHtml('<a href="JaVaScRiPt:alert(1)">Click</a>')).toBe('<a>Click</a>');
  });

  it('escapes a stray angle bracket in prose', () => {
    expect(sanitiseHtml('<p>Cost < 100 cr</p>')).toBe('<p>Cost &lt; 100 cr</p>');
  });

  it('closes tags that were left open', () => {
    expect(sanitiseHtml('<p>Unclosed')).toBe('<p>Unclosed</p>');
    expect(sanitiseHtml('<ul><li>One')).toBe('<ul><li>One</li></ul>');
  });

  it('ignores a closing tag that was never opened', () => {
    expect(sanitiseHtml('Text</p></div>')).toBe('Text');
  });

  it('removes HTML comments, where conditional Word markup hides', () => {
    expect(sanitiseHtml('<p>A</p><!--[if gte mso 9]><xml>…</xml><![endif]--><p>B</p>')).toBe(
      '<p>A</p><p>B</p>',
    );
  });

  it('drops the empty paragraphs a Word paste leaves behind', () => {
    expect(sanitiseHtml('<p>Real</p><p>&nbsp;</p><p></p><p><br></p>')).toBe('<p>Real</p>');
  });

  it('normalises br to a self-closing tag', () => {
    expect(sanitiseHtml('<p>One<br>Two</p>')).toBe('<p>One<br />Two</p>');
  });

  it('returns empty for empty input rather than throwing', () => {
    expect(sanitiseHtml('')).toBe('');
  });

  it('is idempotent — sanitising twice changes nothing', () => {
    const messy = '<div style="x"><strong>A</strong><script>bad()</script><p>B</p></div>';
    const once = sanitiseHtml(messy);
    expect(sanitiseHtml(once)).toBe(once);
  });
});

describe('htmlToText', () => {
  it('turns the stored HTML into readable plain text', () => {
    expect(htmlToText('<h3>Zone 4</h3><p>Work is <b>behind</b>.</p>')).toBe(
      'Zone 4\nWork is behind.',
    );
  });

  it('unescapes the entities the sanitiser introduced', () => {
    expect(htmlToText(sanitiseHtml('<p>Cost < 100 &amp; rising</p>'))).toBe('Cost < 100 & rising');
  });
});
