import { readFileSync } from 'fs';
import { join } from 'path';
import { htmlToSearchText } from './html-to-search-text';
import { sanitizeTicketDescription } from './sanitize-ticket-description';

interface Case {
  nome: string;
  html: string;
  expected: string;
  somenteServidor?: boolean;
}

const cases: Case[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/ticket-html-text-cases.json'), 'utf8'),
);

describe('htmlToSearchText (GH-370 AC-03)', () => {
  it.each(cases.map((c) => [c.nome, c] as const))('tabela compartilhada: %s', (_nome, c) => {
    expect(htmlToSearchText(c.html)).toBe(c.expected);
  });

  it('a tabela compartilhada cobre os casos do contrato (guarda contra tabela vazia)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.some((c) => c.somenteServidor)).toBe(true);
  });

  it('nunca devolve tag vinda da entrada quando há markup', () => {
    const out = htmlToSearchText('<div class="x"><p onclick="y">a</p><strong>b</strong></div>');
    expect(out).not.toMatch(/[<>]/);
    expect(out).toBe('a b');
  });

  it('nome de tag e de atributo não entram no texto (busca por strong, div, href)', () => {
    const out = htmlToSearchText('<p><strong>Erro</strong> <a href="https://exemplo.test">x</a></p>');
    expect(out).not.toMatch(/strong|href|exemplo/);
  });

  it('colapsa espaços e quebras e apara as pontas', () => {
    expect(htmlToSearchText('<p>  a \n\t b  </p>\n<p> c </p>')).toBe('a b c');
  });

  it('é estável sobre HTML já sanitizado (decisão HTML/texto igual à da escrita)', () => {
    const raw = '<p>ok <code>x</code></p><script>y</script><img src="/a.png" onerror="z">';
    const sanitized = sanitizeTicketDescription(raw);
    expect(htmlToSearchText(sanitized)).toBe('ok x');
  });

  it('descrição só com <code> não deixa o nome da tag no texto buscável', () => {
    expect(htmlToSearchText('<code>x</code>')).toBe('x');
  });
});
