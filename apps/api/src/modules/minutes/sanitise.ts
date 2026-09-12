/**
 * The paste-from-Word defence, and it belongs on the server.
 *
 * docs/03-API-SPEC.md fixes the allow-list: `p h3 b i u mark ol ul li br
 * a[href]`. Everything else is stripped, including every style and class. The
 * reason is not only XSS — though it is that too. It is that a MoM pasted out
 * of Word carries three fonts, a table layout and a colour scheme, and the
 * printed document has to look like one document. Strip on write and the
 * stored HTML is already clean, so the editor, the preview and the PDF all
 * render the same thing without any of them having to be careful.
 *
 * Written by hand rather than pulled from a library because it has to run
 * identically in the API and in the PDF renderer, must not depend on a DOM, and
 * is small enough that its behaviour can be read in full — which for a security
 * boundary is worth more than the features a general-purpose sanitiser adds.
 */

/** Tags that survive. Everything else has its tags removed; the text stays. */
const ALLOWED = new Set(['p', 'h3', 'b', 'i', 'u', 'mark', 'ol', 'ul', 'li', 'br', 'a']);

/** Tags whose *content* is discarded too, not just their markup. */
const DROP_CONTENT = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed']);

/** Word and Google Docs emit these; they are semantically the allowed tag. */
const REWRITE: Record<string, string> = {
  strong: 'b',
  em: 'i',
  ins: 'u',
  h1: 'h3',
  h2: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  div: 'p',
};

const VOID = new Set(['br']);

export function sanitiseHtml(input: string): string {
  if (!input) return '';

  let html = input;

  // 1. Remove comments, which is where conditional Word markup hides.
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Remove elements whose content must go with them.
  for (const tag of DROP_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    // An unclosed <script> would otherwise leave its body as text.
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'gi'), '');
  }

  const open: string[] = [];
  let out = '';
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, lt));

    // A "<" only begins a tag when a name or a slash follows it. Without this
    // check, prose like "Cost < 100 cr" swallows everything up to the next ">"
    // — which is the closing tag — and the sentence loses its second half.
    if (!/[a-zA-Z/!]/.test(html[lt + 1] ?? '')) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      // A stray "<" in prose. Keep it as text rather than eating the rest.
      out += escapeText(html.slice(lt));
      break;
    }

    const raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw === '') continue;

    const closing = raw.startsWith('/');
    const name = (closing ? raw.slice(1) : raw).split(/[\s/>]/)[0].toLowerCase();
    const mapped = REWRITE[name] ?? name;

    if (!ALLOWED.has(mapped)) continue; // tag dropped, text kept

    if (closing) {
      // Only close something actually open, so malformed input cannot produce
      // stray closing tags that break the document around it.
      const at = open.lastIndexOf(mapped);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop() as string}>`;
      continue;
    }

    if (VOID.has(mapped)) {
      out += '<br />';
      continue;
    }

    out += mapped === 'a' ? openAnchor(raw) : `<${mapped}>`;
    open.push(mapped);
  }

  while (open.length > 0) out += `</${open.pop() as string}>`;

  return collapse(out);
}

/**
 * `href` is the only attribute that survives anywhere, and only when it is a
 * plain http(s) or mailto link. `javascript:` and `data:` are the two that
 * matter, and an allow-list of schemes is the only way to exclude them that
 * does not need updating every time someone finds a new encoding.
 */
function openAnchor(raw: string): string {
  const match = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(raw);
  const href = (match?.[2] ?? match?.[3] ?? match?.[4] ?? '').trim();
  const safe = /^(https?:\/\/|mailto:)/i.test(href);
  if (!safe) return '<a>';
  // rel/target are added here rather than trusted from the input: a MoM link
  // opening in the same tab loses the reader's place in the document.
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`;
}

function escapeText(s: string): string {
  return s.replace(/&(?!(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);)/g, '&amp;').replace(/</g, '&lt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Empty paragraphs are what a Word paste leaves behind in quantity. */
function collapse(s: string): string {
  return s
    .replace(/<p>(\s|&nbsp;|<br \/>)*<\/p>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Plain text, for the search index and the notification preview. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br \/>/g, '\n')
    .replace(/<\/(p|h3|li)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
