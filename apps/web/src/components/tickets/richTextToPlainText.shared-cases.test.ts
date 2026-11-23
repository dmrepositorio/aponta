import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { richTextToPlainText } from './richTextToPlainText';

/**
 * GH-370 AC-03: tabela de casos compartilhada com a API
 * (apps/api/src/tickets/__fixtures__/ticket-html-text-cases.json), lida por
 * caminho de repositório com fs (sem importar entre projetos Nx), para a
 * conversão do front e `htmlToSearchText` do servidor não divergirem. O front
 * preserva quebras para o textarea e prefixa `li` com "- ", então a comparação
 * é feita após colapsar espaços e fora os casos só-servidor (`li`, `code`,
 * `table` e o legado cru).
 */
interface SharedCase {
  nome: string;
  html: string;
  expected: string;
  somenteServidor?: boolean;
}

const TABLE = resolve(
  __dirname,
  '../../../../api/src/tickets/__fixtures__/ticket-html-text-cases.json',
);
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const cases: SharedCase[] = JSON.parse(readFileSync(TABLE, 'utf8'));
const shared = cases.filter((c) => !c.somenteServidor);

describe('richTextToPlainText: tabela compartilhada com a API', () => {
  it('lê a tabela e há casos comparáveis', () => {
    expect(shared.length).toBeGreaterThanOrEqual(10);
  });

  it.each(shared.map((c) => [c.nome, c] as const))('%s', (_nome, c) => {
    expect(collapse(richTextToPlainText(c.html))).toBe(collapse(c.expected));
  });
});
