import {
  hasHtmlMarkup,
  sanitizeTicketDescription as sanitize,
} from './sanitize-ticket-description';
import { htmlToSearchText } from './html-to-search-text';
import { ticketDescriptionFields } from './ticket-description-fields';

/**
 * GH-390 item 2: `>` dentro de aspas não encerra a tag. Os portões da #368
 * (`on*`) e da #379 (esquema perigoso em tag desconhecida) paravam no primeiro
 * `>` e deixavam passar `<foo title=">" href="javascript:...">`, que o navegador
 * lê como uma única tag.
 */
describe('sanitizeTicketDescription: ">" dentro de aspas em atributo (GH-390 item 2)', () => {
  const DANGEROUS_RE = /javascript|vbscript|data:|onclick|onerror|onmouseover|<foo|<custom-el|alert/i;

  it.each([
    ['href perigoso após title com ">" (aspas duplas)', '<foo title=">" href="javascript:alert(1)">x'],
    ['href perigoso após title com ">" (aspas simples)', "<foo title='>' href='javascript:alert(1)'>x"],
    ['href sem aspas após title com ">"', '<foo title=">" href=javascript:alert(1)>x'],
    ['onclick sem aspas após title com ">"', '<foo title=">" onclick=alert(1)>x'],
    ['onclick com aspas após title com ">"', '<foo title=">" onclick="alert(1)">x'],
    ['onerror após alt com ">" em tag desconhecida', '<foo alt=">" onerror=alert(1)>x'],
    ['vários ">" entre aspas', '<foo a=">>>" b=">" href="javascript:alert(1)">x'],
    ['custom element com ">" em aspas', '<custom-el title=">" href="javascript:alert(1)">x</custom-el>'],
    ['"<" em aspas antes do atributo perigoso', '<foo title="<" onclick=alert(1)>x'],
  ])('%s: tag e atributo não são gravados', (_nome, input) => {
    expect(hasHtmlMarkup(input)).toBe(true);
    expect(sanitize(input)).not.toMatch(DANGEROUS_RE);
  });

  it('ticketDescriptionFields e htmlToSearchText ficam coerentes', () => {
    const fields = ticketDescriptionFields('<foo title=">" href="javascript:alert(1)">visível');
    expect(fields.description).toBe('visível');
    expect(fields.descriptionText).toBe('visível');
    expect(htmlToSearchText('<foo title=">" onclick=alert(1)>visível')).toBe('visível');
  });

  it('é idempotente', () => {
    const once = sanitize('<foo title=">" href="javascript:alert(1)">x');
    expect(sanitize(once)).toBe(once);
  });

  describe('texto puro não muda', () => {
    it.each([
      '<foo title=">" href="https://exemplo.com">x',
      '<foo title=">" data-x=1>x',
      '<foo title=">" class="a">x',
      '<foo title="javascript:é só título" href=ok>x',
      '<foo title=">">x</foo>',
      '<foo onclick>x',
    ])('%j', (input) => {
      expect(hasHtmlMarkup(input)).toBe(false);
      expect(sanitize(input)).toBe(input);
    });
  });
});
