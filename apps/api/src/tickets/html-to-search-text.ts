import { Parser } from 'htmlparser2';
import { hasHtmlMarkup } from './sanitize-ticket-description';

/**
 * Texto buscável derivado da descrição do ticket (GH-370). Fonte única no
 * servidor; recebe a descrição como gravada (já sanitizada pela #368).
 *
 * - Sem markup (mesma decisão `hasHtmlMarkup` da escrita): devolve o texto como
 *   está, só com espaços colapsados (`a < b & c` e `![x](u)` permanecem).
 * - Com markup: percorre com htmlparser2. Bloco e `br` viram espaço, inline
 *   some sem espaço, atributos são descartados, `script`/`style` e seu
 *   conteúdo são descartados e as entidades são decodificadas.
 * - Legado cru com tag colada (`a<b && c>d`, limite aceito na #368) é tratado
 *   como HTML e vira `ad`, igual ao que o DOMParser do front exibe.
 *
 * O parser não executa nada; o valor só é comparado em SQL parametrizado e
 * nunca renderizado como HTML.
 */

// D4 (blocos da SPEC) mais os blocos do sanitizador que o editor também gera
// (h4-h6, pre, hr, tabela): sem espaço, células vizinhas colariam palavras.
const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const DISCARDED_TAGS = new Set(['script', 'style']);

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export function htmlToSearchText(html: string): string {
  if (!hasHtmlMarkup(html)) return collapse(html);

  const out: string[] = [];
  let discarding = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (DISCARDED_TAGS.has(name)) discarding++;
        else if (BLOCK_TAGS.has(name)) out.push(' ');
      },
      ontext(text) {
        if (discarding === 0) out.push(text);
      },
      onclosetag(name) {
        if (DISCARDED_TAGS.has(name)) discarding = Math.max(0, discarding - 1);
        else if (BLOCK_TAGS.has(name)) out.push(' ');
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return collapse(out.join(''));
}
