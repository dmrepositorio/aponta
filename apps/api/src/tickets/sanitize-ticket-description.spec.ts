import { readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeTicketDescription as sanitize } from './sanitize-ticket-description';

interface CorpusCase {
  nome: string;
  html: string;
  expected: string;
}

// Saída sintética do EzRichText (contrato em EzRichText.tsx), versionada.
const corpus: CorpusCase[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/ticket-editor-corpus.json'), 'utf8'),
);

describe('sanitizeTicketDescription', () => {
  describe('AC-01: payloads de XSS não são gravados', () => {
    it.each([
      ['script', '<p>ok</p><script>alert(1)</script>', /<script|alert\(1\)/i],
      ['onerror', '<p>ok</p><img src="x" onerror="alert(1)">', /onerror/i],
      ['javascript: em href', '<p>ok</p><a href="javascript:alert(1)">l</a>', /javascript:/i],
      ['iframe', '<p>ok</p><iframe src="https://evil.test"></iframe>', /iframe/i],
      ['svg onload', '<p>ok</p><svg onload="alert(1)"><circle r="1"/></svg>', /<svg|onload/i],
      ['style (elemento)', '<p>ok</p><style>body{display:none}</style>', /<style|display:none/i],
      ['object', '<p>ok</p><object data="x.swf"></object>', /<object/i],
      ['form', '<p>ok</p><form action="https://evil.test"><input name="a"></form>', /<form|<input/i],
      ['handler on* em tag permitida', '<p onclick="alert(1)">ok</p>', /onclick/i],
    ])('%s: remove o perigoso e mantém o legítimo', (_nome, input, forbidden) => {
      const out = sanitize(input);
      expect(out).not.toMatch(forbidden);
      expect(out).toContain('ok');
    });

    it('mantém o conteúdo legítimo ao redor do script', () => {
      expect(sanitize('<p>antes</p><script>alert(1)</script><p>depois</p>')).toBe(
        '<p>antes</p><p>depois</p>',
      );
    });

    it('sanitiza mesmo sem tag reconhecida quando há tag perigosa', () => {
      expect(sanitize('texto <script>alert(1)</script> fim')).toBe('texto  fim');
    });
  });

  describe('AC-02: texto puro passa intacto', () => {
    it.each([
      'linha 1\nlinha 2',
      'a < b & c',
      '![x](u)',
      'Descrição com acentuação, ç e emoji 🚀',
      'if (a<b && c>d) { return; }',
    ])('devolve idêntico: %j', (input) => {
      expect(sanitize(input)).toBe(input);
    });
  });

  describe('AC-03: esquemas de URL', () => {
    it.each([
      ['<a href="https://exemplo.test/x">l</a>', 'href="https://exemplo.test/x"'],
      ['<a href="http://exemplo.test/x">l</a>', 'href="http://exemplo.test/x"'],
      ['<a href="mailto:a@exemplo.test">l</a>', 'href="mailto:a@exemplo.test"'],
      ['<a href="/x">l</a>', 'href="/x"'],
      ['<img src="https://exemplo.test/a.png">', 'src="https://exemplo.test/a.png"'],
      ['<img src="/uploads/a.png">', 'src="/uploads/a.png"'],
    ])('mantém %s', (input, kept) => {
      expect(sanitize(input)).toContain(kept);
    });

    it.each([
      ['javascript simples', '<a href="javascript:alert(1)">l</a>'],
      ['javascript com espaço', '<a href=" javascript:alert(1)">l</a>'],
      ['javascript em caixa mista', '<a href="JaVaScRiPt:alert(1)">l</a>'],
      ['javascript com tab em entidade', '<a href="java&#09;script:alert(1)">l</a>'],
      ['javascript com entidade de dois pontos', '<a href="javascript&colon;alert(1)">l</a>'],
      ['data', '<a href="data:text/html;base64,PHNjcmlwdD4=">l</a>'],
      ['vbscript', '<a href="vbscript:msgbox(1)">l</a>'],
      ['protocolo relativo', '<a href="//evil.test/x">l</a>'],
    ])('remove o atributo ofensivo e mantém a tag (href): %s', (_nome, input) => {
      expect(sanitize(input)).toBe('<a>l</a>');
    });

    it.each([
      ['data', '<img src="data:image/png;base64,AAAA" alt="x">'],
      ['javascript', '<img src="javascript:alert(1)" alt="x">'],
      ['protocolo relativo', '<img src="//evil.test/a.png" alt="x">'],
      ['mailto', '<img src="mailto:a@exemplo.test" alt="x">'],
      ['relativo sem barra', '<img src="relativo/a.png" alt="x">'],
    ])('remove o src ofensivo e mantém a imagem: %s', (_nome, input) => {
      expect(sanitize(input)).toBe('<img alt="x" />');
    });

    it('img aceita width e height numéricos e descarta o resto', () => {
      expect(sanitize('<img src="/a.png" width="320" height="200">')).toBe(
        '<img src="/a.png" width="320" height="200" />',
      );
      expect(sanitize('<img src="/a.png" width="100%" height="expression(1)">')).toBe(
        '<img src="/a.png" />',
      );
    });
  });

  describe('AC-04 e AC-05: conteúdo do editor sobrevive (corpus)', () => {
    it.each(corpus.map((c): [string, string, string] => [c.nome, c.html, c.expected]))(
      '%s',
      (_nome, html, expected) => {
        expect(sanitize(html)).toBe(expected);
      },
    );

    it.each(corpus.map((c): [string, string] => [c.nome, c.expected]))(
      'idempotente sobre a forma serializada: %s',
      (_nome, expected) => {
        expect(sanitize(expected)).toBe(expected);
      },
    );

    it('não achata code, pre e hr (a base de artigos achataria)', () => {
      expect(sanitize('<pre><code>x</code></pre><hr><p><code>y</code></p>')).toBe(
        '<pre><code>x</code></pre><hr /><p><code>y</code></p>',
      );
    });
  });

  describe('AC-06: style por propriedade e valor', () => {
    it('aceita color, background-color e text-align válidos', () => {
      expect(
        sanitize('<p style="text-align: right; color: #abc; background-color: rgb(1, 2, 3)">x</p>'),
      ).toBe('<p style="text-align:right;color:#abc;background-color:rgb(1, 2, 3)">x</p>');
    });

    it.each([
      ['<p style="color: expression(alert(1))">x</p>'],
      ['<p style="background-color: url(https://evil.test/x.png)">x</p>'],
      ['<p style="position: fixed; top: 0">x</p>'],
      ['<p style="color: javascript:alert(1)">x</p>'],
      ['<p style="background: url(javascript:alert(1))">x</p>'],
    ])('descarta estilo perigoso: %s', (input) => {
      expect(sanitize(input)).toBe('<p>x</p>');
    });
  });

  describe('AC-09: idempotente, determinística e nunca undefined', () => {
    const payloads = [
      '<p>a</p><script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)" target="_blank">x</a>',
      '<table><tr><td>1</td></tr></table>',
      '<div><p>aninhado <b>negrito</b></p></div>',
    ];

    it.each(payloads)('sanitize(sanitize(x)) === sanitize(x): %s', (input) => {
      const once = sanitize(input);
      expect(sanitize(once)).toBe(once);
      expect(sanitize(input)).toBe(once);
    });

    it('devolve sempre string, inclusive para entrada vazia', () => {
      expect(sanitize('')).toBe('');
      for (const input of payloads) expect(typeof sanitize(input)).toBe('string');
    });

    it('um payload que o sanitizador esvazia vira string vazia, não undefined', () => {
      expect(sanitize('<script>alert(1)</script>')).toBe('');
    });
  });

  describe('AC-10: rel em target _blank', () => {
    it('acrescenta noopener noreferrer a link sem rel', () => {
      expect(sanitize('<a href="https://exemplo.test" target="_blank">l</a>')).toBe(
        '<a href="https://exemplo.test" target="_blank" rel="noopener noreferrer">l</a>',
      );
    });

    it('não deixa rel enganoso substituir noopener noreferrer', () => {
      const out = sanitize('<a href="https://exemplo.test" target="_blank" rel="opener">l</a>');
      expect(out).toMatch(/rel="[^"]*noopener[^"]*"/);
      expect(out).toMatch(/rel="[^"]*noreferrer[^"]*"/);
    });

    it('descarta target diferente de _blank', () => {
      expect(sanitize('<a href="https://exemplo.test" target="_top">l</a>')).toBe(
        '<a href="https://exemplo.test">l</a>',
      );
    });
  });
});
