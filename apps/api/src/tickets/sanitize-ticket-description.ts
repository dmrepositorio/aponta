import { Parser } from 'htmlparser2';
import sanitizeHtml from 'sanitize-html';
import { buildSanitizeOptions } from '../common/sanitize/sanitize-html-base';

/**
 * Descrição do ticket vem do editor rico (EzRichText, Tiptap) e é gravada
 * como HTML. A API sanitiza com lista permitida ao gravar (defesa em
 * profundidade; o front continua sanitizando na leitura em RichContentView).
 *
 * Texto sem tag reconhecida passa intacto: o sanitize-html escaparia `<`, `>`
 * e `&` soltos, o que mudaria o dado gravado.
 */

// Tags que o editor produz (EzRichText) mais div e span.
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark',
  'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'a', 'img', 'hr', 'sub', 'sup', 'div', 'span',
  'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td',
];

const STYLED_TAGS = [
  'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th',
  'mark',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
  mark: ['data-color'],
};

// Nomes de tag HTML5 conhecidos. A decisão "isto parece HTML?" não depende de
// lista curta: qualquer tag conhecida (ou atributo on* dentro de tag, abaixo)
// manda a entrada pelo sanitizador. Também serve de nomes aceitos no log.
export const KNOWN_HTML_TAGS: ReadonlySet<string> = new Set(
  (
    'a abbr acronym address applet area article aside audio b base basefont bdi bdo big ' +
    'blockquote body br button canvas caption center cite code col colgroup data datalist dd ' +
    'del details dfn dialog dir div dl dt em embed fieldset figcaption figure font footer ' +
    'form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins ' +
    'kbd label legend li link main map mark marquee math menu meta meter nav noframes noscript ' +
    'object ol optgroup option output p param picture pre progress q rp rt ruby s samp script ' +
    'search section select slot small source span strike strong style sub summary sup svg ' +
    'table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr'
  ).split(' '),
);

const KNOWN_TAG_RE = new RegExp(`<\/?(${[...KNOWN_HTML_TAGS].join('|')})(?![a-z0-9-])`, 'i');
// Atributo on* dentro de uma tag, com espaço, quebra de linha, tab, `/` ou
// aspas antes do nome.
const EVENT_HANDLER_IN_TAG_RE = /<[a-z][^<>]*[\s/"'`]on[a-z]+\s*=/i;

// GH-379: tag desconhecida (fora de KNOWN_HTML_TAGS, inclusive custom element
// com hífen) com esquema perigoso em atributo de URL também vai ao
// sanitizador. O portão é barato e linear (`[^<>]*` não atravessa `<`, então
// cada início de tag varre só a própria corrida); só se ele passar o
// htmlparser2 lê os atributos, já com as entidades decodificadas.
const URL_ATTR_IN_TAG_RE = /<[a-z][^<>]*(?:href|src|action)\s*=/i;
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href', 'src', 'action', 'formaction', 'xlink:href',
]);
const DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data):/i;

const NUMERIC_SIZE_RE = /^\d{1,5}$/;
const SAFE_ABSOLUTE_URL_RE = /^(https?:\/\/|mailto:)/i;

function isSafeUrl(value: string, allowMailto: boolean): boolean {
  // Mesma normalização que o sanitize-html aplica antes de checar o esquema.
  const url = value.replace(/[\u0000- \u007f-\u009f]+/g, '');
  if (url.startsWith('//')) return false;
  if (url.startsWith('/')) return true;
  if (/^mailto:/i.test(url)) return allowMailto;
  return SAFE_ABSOLUTE_URL_RE.test(url);
}

const OPTIONS: sanitizeHtml.IOptions = {
  ...buildSanitizeOptions({
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    styledTags: STYLED_TAGS,
  }),
  allowProtocolRelative: false,
  selfClosing: ['img', 'br', 'hr', 'col'],
  transformTags: {
    a: (tagName, attribs) => {
      const next = { ...attribs };
      if (next.href !== undefined && !isSafeUrl(next.href, true)) {
        delete next.href;
      }
      if (next.target !== undefined && next.target !== '_blank') {
        delete next.target;
      }
      if (next.target === '_blank') {
        const extras = (next.rel ?? '')
          .split(/\s+/)
          .filter(
            (t) => /^[a-z]+$/i.test(t) && t !== 'noopener' && t !== 'noreferrer',
          );
        const tokens = ['noopener', 'noreferrer', ...extras];
        next.rel = tokens.join(' ');
      }
      return { tagName, attribs: next };
    },
    img: (tagName, attribs) => {
      const next = { ...attribs };
      if (next.src !== undefined && !isSafeUrl(next.src, false)) {
        delete next.src;
      }
      for (const dim of ['width', 'height']) {
        if (next[dim] !== undefined && !NUMERIC_SIZE_RE.test(next[dim])) {
          delete next[dim];
        }
      }
      return { tagName, attribs: next };
    },
  },
};

function hasDangerousSchemeInUnknownTag(input: string): boolean {
  if (!URL_ATTR_IN_TAG_RE.test(input)) return false;
  let found = false;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (found || KNOWN_HTML_TAGS.has(name)) return;
        for (const [attr, value] of Object.entries(attribs)) {
          if (!URL_ATTRIBUTES.has(attr)) continue;
          // Mesma normalização de isSafeUrl (controles e espaços removidos).
          const url = value.replace(/[\u0000- \u007f-\u009f]+/g, '');
          if (DANGEROUS_SCHEME_RE.test(url)) found = true;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(input);
  parser.end();
  return found;
}

export function hasHtmlMarkup(input: string): boolean {
  return (
    KNOWN_TAG_RE.test(input) ||
    EVENT_HANDLER_IN_TAG_RE.test(input) ||
    hasDangerousSchemeInUnknownTag(input)
  );
}

export function sanitizeTicketDescription(input: string): string {
  if (!hasHtmlMarkup(input)) return input;
  return sanitizeHtml(input, OPTIONS);
}
