import { HTML_TAG_RE } from './RichContentView';

// Teto de segurança, em pontos de código, aplicado sobre o texto já convertido.
const MAX_CODE_POINTS = 2000;

const DROPPED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'img']);
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'li']);

function collect(node: Node, out: string[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push((child.textContent ?? '').replace(/[ \t\r\n]+/g, ' '));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (child as Element).tagName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) return;
    if (tag === 'br') {
      out.push('\n');
      return;
    }
    if (tag === 'li') out.push('- ');
    collect(child, out);
    if (BLOCK_TAGS.has(tag)) out.push('\n');
  });
}

function capText(text: string): string {
  const points = Array.from(text);
  if (points.length <= MAX_CODE_POINTS) return text;
  return `${points.slice(0, MAX_CODE_POINTS).join('').trim()}…`;
}

/**
 * Converte a descrição de um ticket (HTML do editor rico ou texto puro legado)
 * em texto puro para um campo textarea. Sem HTML, devolve a entrada como está
 * (só com o teto). O DOMParser cria um documento inerte: nada é executado.
 */
export function richTextToPlainText(content: string): string {
  if (!HTML_TAG_RE.test(content)) return capText(content);

  const doc = new DOMParser().parseFromString(content, 'text/html');
  const out: string[] = [];
  collect(doc.body, out);

  const text = out
    .join('')
    .replace(/ /g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return capText(text);
}
