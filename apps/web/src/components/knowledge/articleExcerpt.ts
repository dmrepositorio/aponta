const BLOCK_TAGS = /<\/?(?:p|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|div|br)\b[^>]*>/gi;

/**
 * Texto simples de um artigo para o card recolhido. Lê só `textContent` de um
 * documento inerte (sem scripts nem imagens carregadas), separa blocos com
 * espaço e corta em limite de palavra, com "…" dentro do limite `max`.
 */
export function articleExcerpt(html: string, max = 240): string {
  const doc = new DOMParser().parseFromString(html.replace(BLOCK_TAGS, ' $&'), 'text/html');
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const end = text[max - 1] === ' ' ? head.length : head.lastIndexOf(' ');
  return `${head.slice(0, end > 0 ? end : head.length).trimEnd()}…`;
}
