import {
  hasHtmlMarkup,
  sanitizeTicketDescription as sanitize,
} from './sanitize-ticket-description';
import { htmlToSearchText } from './html-to-search-text';
import { ticketDescriptionFields } from './ticket-description-fields';

/**
 * GH-379 (follow-up da GH-368, decisão do humano: opção b). Tag desconhecida
 * (fora de KNOWN_HTML_TAGS, inclusive custom element com hífen) com esquema
 * perigoso em href/src/action/formaction/xlink:href é tratada como HTML e vai
 * ao sanitizador. Texto puro continua intacto.
 */
describe('sanitizeTicketDescription: tag desconhecida com esquema perigoso (GH-379)', () => {
  const DANGEROUS_RE = /javascript|vbscript|data:|<foo|<custom-el|<x-|alert/i;

  it.each([
    ['javascript: sem aspas', '<foo href=javascript:alert(1)>x</foo>'],
    ['javascript: com aspas duplas', '<foo href="javascript:alert(1)">x</foo>'],
    ['javascript: com aspas simples', "<foo href='javascript:alert(1)'>x</foo>"],
    ['caixa mista', '<foo href="JaVaScRiPt:alert(1)">x</foo>'],
    ['quebra de linha no esquema', '<foo href="java\nscript:alert(1)">x</foo>'],
    ['tab no esquema', '<foo href="java\tscript:alert(1)">x</foo>'],
    ['espaço antes do esquema', '<foo href="  javascript:alert(1)">x</foo>'],
    ['entidade numérica', '<foo href="&#106;avascript:alert(1)">x</foo>'],
    ['entidade hexadecimal', '<foo href="&#x6A;avascript:alert(1)">x</foo>'],
    ['entidade &colon;', '<foo href="javascript&colon;alert(1)">x</foo>'],
    ['entidade &Tab; no esquema', '<foo href="java&Tab;script:alert(1)">x</foo>'],
    ['vbscript:', '<foo href="vbscript:msgbox(1)">x</foo>'],
    ['data:', '<foo src="data:text/html,<b>alert(1)</b>">x</foo>'],
    ['atributo src', '<foo src="javascript:alert(1)">x</foo>'],
    ['atributo action', '<foo action="javascript:alert(1)">x</foo>'],
    ['atributo formaction', '<foo formaction="javascript:alert(1)">x</foo>'],
    ['atributo xlink:href', '<foo xlink:href="javascript:alert(1)">x</foo>'],
    ['nome de atributo em maiúsculas', '<foo HREF="javascript:alert(1)">x</foo>'],
    ['espaços em volta do =', '<foo href = "javascript:alert(1)">x</foo>'],
    ['custom element com hífen', '<custom-el href="javascript:alert(1)">x</custom-el>'],
    ['custom element sem aspas', '<x-btn href=javascript:alert(1)>x</x-btn>'],
    ['texto antes e depois', 'antes <foo href="javascript:alert(1)">x</foo> depois'],
    ['tag desconhecida sem fechamento', '<foo href="javascript:alert(1)">'],
  ])('%s: a tag e o esquema não são gravados', (_nome, input) => {
    expect(hasHtmlMarkup(input)).toBe(true);
    expect(sanitize(input)).not.toMatch(DANGEROUS_RE);
  });

  it('mantém o conteúdo legítimo ao redor', () => {
    expect(
      sanitize('<p>ok</p><foo href="javascript:alert(1)">x</foo><p>fim</p>'),
    ).toBe('<p>ok</p>x<p>fim</p>');
  });

  it('tag desconhecida perigosa aninhada em tag conhecida também sai', () => {
    const out = sanitize('<p>ok <foo href="javascript:alert(1)">x</foo></p>');
    expect(out).not.toMatch(DANGEROUS_RE);
    expect(out).toContain('ok');
  });

  it('tag desconhecida perigosa aninhada em outra desconhecida sai', () => {
    const out = sanitize('<foo><bar href=javascript:alert(1)>x</bar></foo>');
    expect(out).not.toMatch(DANGEROUS_RE);
  });

  it('é idempotente nesses casos', () => {
    for (const input of [
      '<foo href=javascript:alert(1)>x</foo>',
      '<custom-el href="&#106;avascript:alert(1)">x</custom-el>',
    ]) {
      const once = sanitize(input);
      expect(sanitize(once)).toBe(once);
    }
  });

  it('&#111;nclick em nome de atributo segue inerte (texto puro)', () => {
    expect(hasHtmlMarkup('&#111;nclick=alert(1)')).toBe(false);
    expect(sanitize('&#111;nclick=alert(1)')).toBe('&#111;nclick=alert(1)');
  });

  describe('texto puro não muda', () => {
    it.each([
      'a < b',
      'a < b && c > d',
      '<3',
      '<fulano@exemplo.com>',
      '<foo>',
      '<foo>texto</foo>',
      '<custom-el href="https://exemplo.com">x</custom-el>',
      '<custom-el href="/relativo">x</custom-el>',
      '<foo href="mailto:a@exemplo.com">x</foo>',
      '<foo title="javascript:isso é só título">x</foo>',
      'escreva href=javascript:x como texto',
      'usar javascript: no link',
      '<foo data-x="data:abc">x</foo>',
    ])('%j', (input) => {
      expect(hasHtmlMarkup(input)).toBe(false);
      expect(sanitize(input)).toBe(input);
    });
  });

  describe('coerência com descriptionText', () => {
    it('htmlToSearchText usa a mesma decisão e não devolve tag nem esquema', () => {
      const out = htmlToSearchText('<foo href="javascript:alert(1)">visível</foo>');
      expect(out).toBe('visível');
    });

    it('ticketDescriptionFields grava descrição sanitizada e texto coerente', () => {
      const input = '<foo href=javascript:alert(1)>visível</foo>';
      const fields = ticketDescriptionFields(input);
      expect(fields.description).toBe('visível');
      expect(fields.descriptionText).toBe('visível');
    });
  });

  describe('desempenho com entrada hostil', () => {
    const measure = (input: string) => {
      const start = process.hrtime.bigint();
      sanitize(input);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    it.each([
      ['muitos "<a" abertos', '<a'.repeat(20000)],
      ['uma tag longa sem fechar', '<foo ' + 'href=x '.repeat(10000)],
      ['atributos repetidos sem esquema', '<foo ' + 'a=b '.repeat(10000) + '>'],
      ['espaços longos', '<foo href=' + ' '.repeat(50000) + 'x>'],
      ['aspas sem fechar', '<foo href="' + 'java script '.repeat(5000)],
      ['muitos "<" e ">"', '<>'.repeat(20000)],
    ])('%s: menos de 30 ms', (_nome, input) => {
      measure(input); // aquecimento do JIT
      expect(measure(input)).toBeLessThan(30);
    });
  });
});
