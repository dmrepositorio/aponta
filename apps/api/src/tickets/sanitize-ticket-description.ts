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

// Mesma ideia do HTML_TAG_RE do front (RichContentView), ampliada com o que o
// editor produz e o renderizador achata.
const RECOGNIZED_TAG_RE =
  /<\/?(p|div|span|br|strong|b|em|i|u|s|strike|del|ul|ol|li|a|img|h[1-6]|blockquote|table|code|pre|mark|hr|sub|sup|colgroup|col|thead|tbody|tr|th|td)\b/i;
const DANGEROUS_TAG_RE =
  /<\/?(script|style|iframe|object|embed|svg|math|form|link|meta|base)\b/i;

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

export function hasHtmlMarkup(input: string): boolean {
  return RECOGNIZED_TAG_RE.test(input) || DANGEROUS_TAG_RE.test(input);
}

export function sanitizeTicketDescription(input: string): string {
  if (!hasHtmlMarkup(input)) return input;
  return sanitizeHtml(input, OPTIONS);
}
