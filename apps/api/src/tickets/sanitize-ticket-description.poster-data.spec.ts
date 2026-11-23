import {
  hasHtmlMarkup,
  sanitizeTicketDescription as sanitize,
} from './sanitize-ticket-description';

/**
 * GH-390 item 4: `poster` e `data` também carregam URL; em tag desconhecida com
 * esquema perigoso entram no mesmo portão de href/src/action.
 */
describe('sanitizeTicketDescription: poster e data em tag desconhecida (GH-390 item 4)', () => {
  const DANGEROUS_RE = /javascript|vbscript|data:|<foo|<x-|alert/i;

  it.each([
    ['poster javascript:', '<foo poster="javascript:alert(1)">x</foo>'],
    ['data javascript:', '<foo data="javascript:alert(1)">x</foo>'],
    ['data data:', '<x-obj data="data:text/html,x">x</x-obj>'],
    ['poster com entidade sem ;', '<foo poster="&#106avascript:alert(1)">x</foo>'],
  ])('%s: a tag e o esquema não são gravados', (_nome, input) => {
    expect(hasHtmlMarkup(input)).toBe(true);
    expect(sanitize(input)).not.toMatch(DANGEROUS_RE);
  });

  it.each([
    '<foo poster="https://exemplo.com/a.png">x</foo>',
    '<foo data="abc">x</foo>',
    '<foo poster="/relativo.png">x</foo>',
    '<foo data-x="javascript:só texto">x</foo>',
  ])('texto puro não muda: %j', (input) => {
    expect(hasHtmlMarkup(input)).toBe(false);
    expect(sanitize(input)).toBe(input);
  });
});
