import {
  hasHtmlMarkup,
  sanitizeTicketDescription as sanitize,
} from './sanitize-ticket-description';
import { htmlToSearchText } from './html-to-search-text';
import { ticketDescriptionFields } from './ticket-description-fields';

/**
 * GH-390 item 3: o navegador decodifica referência numérica sem `;`
 * (`&#106avascript:` vira `javascript:`), o htmlparser2 8.0.2 não. Em tag
 * desconhecida o esquema perigoso precisa ser pego do jeito que o navegador lê.
 * Hexadecimal é guloso como no navegador: `&#x6Aavascript` lê `6Aa` (U+06AA),
 * então só vale `&#x6A` seguido de caractere que não é dígito hexa.
 */
describe('sanitizeTicketDescription: referência numérica sem ponto e vírgula (GH-390 item 3)', () => {
  const DANGEROUS_RE = /javascript|vbscript|data:|<foo|<custom-el|<x-|alert|&#/i;

  it.each([
    ['decimal sem ;', '<foo href="&#106avascript:alert(1)">x</foo>'],
    ['decimal sem ; e sem aspas', '<foo href=&#106avascript:alert(1)>x</foo>'],
    ['hexadecimal sem ;', '<foo href="&#x6A&#x61vascript:alert(1)">x</foo>'],
    ['hexadecimal maiúsculo', '<foo href="&#X6A&#X61vascript:alert(1)">x</foo>'],
    ['zeros à esquerda', '<foo href="&#0000106avascript:alert(1)">x</foo>'],
    ['dois pontos como &#58 sem ;', '<foo href="javascript&#58alert(1)">x</foo>'],
    ['tab como &#9 sem ;', '<foo href="java&#9script:alert(1)">x</foo>'],
    ['vbscript', '<foo href="&#118bscript:msgbox(1)">x</foo>'],
    ['data', '<foo src="&#100ata:text/html,x">x</foo>'],
    ['misturado com e sem ;', '<foo href="&#106;&#97vascript:alert(1)">x</foo>'],
    ['custom element', '<x-btn href="&#106avascript:alert(1)">x</x-btn>'],
    ['atributo action', '<foo action="&#106avascript:alert(1)">x</foo>'],
    ['após title com ">"', '<foo title=">" href="&#106avascript:alert(1)">x</foo>'],
  ])('%s: a tag e o esquema não são gravados', (_nome, input) => {
    expect(hasHtmlMarkup(input)).toBe(true);
    expect(sanitize(input)).not.toMatch(DANGEROUS_RE);
  });

  it('ticketDescriptionFields e htmlToSearchText ficam coerentes', () => {
    const fields = ticketDescriptionFields('<foo href="&#106avascript:alert(1)">visível</foo>');
    expect(fields.description).toBe('visível');
    expect(fields.descriptionText).toBe('visível');
    expect(htmlToSearchText('<foo href=&#106avascript:alert(1)>visível')).toBe('visível');
  });

  it('é idempotente', () => {
    const once = sanitize('<foo href="&#106avascript:alert(1)">x</foo>');
    expect(sanitize(once)).toBe(once);
  });

  describe('texto puro não muda', () => {
    it.each([
      '&#106avascript:alert(1)',
      'use &#106avascript: como texto',
      '<foo title="&#106avascript:x">x</foo>',
      '<foo href="&#106avascript">x</foo>',
      '<foo href="&#x6Aavascript:alert(1)">x</foo>',
      '<foo href="&amp;#106avascript:alert(1)">x</foo>',
      '<foo href="&#106;&#97;lerta">x</foo>',
      '<custom-el href="https://exemplo.com/?a=1&#38b=2">x</custom-el>',
      'a &#106 b',
      '<fulano@exemplo.com> &#106avascript:',
    ])('%j', (input) => {
      expect(hasHtmlMarkup(input)).toBe(false);
      expect(sanitize(input)).toBe(input);
    });
  });
});
