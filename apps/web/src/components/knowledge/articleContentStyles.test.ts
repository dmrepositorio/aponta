import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// O `?raw` de CSS volta vazio no vitest; lê o arquivo direto do disco.
const css = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, ' ') : '';
}

// DMTE-534 (AC-07): o jsdom não aplica o CSS do Tailwind; este teste confere que
// as regras escopadas existem. Os valores calculados são medidos em Chromium.
describe('.article-content styles', () => {
  it('restores list markers, including nested lists', () => {
    expect(rule('.article-content ul')).toContain('list-style-type: disc');
    expect(rule('.article-content ol')).toContain('list-style-type: decimal');
    expect(rule('.article-content ul ul')).toContain('list-style-type: circle');
    expect(rule('.article-content ol ol')).toContain('list-style-type: lower-alpha');
  });

  it('gives headings a hierarchy below the card title', () => {
    expect(rule('.article-content h1')).toMatch(/font-size: 1rem/);
    expect(rule('.article-content h2')).toMatch(/font-weight: 600/);
    expect(rule('.article-content h3')).toMatch(/font-size: 0\.875rem/);
  });

  it('styles blockquote and links', () => {
    expect(rule('.article-content blockquote')).toContain('border-left');
    expect(rule('.article-content a')).toContain('text-decoration: underline');
  });

  it('keeps tables and images inside the card', () => {
    expect(rule('.article-content table')).toContain('overflow-x: auto');
    expect(rule('.article-content table')).toContain('max-width: 100%');
    expect(rule('.article-content img')).toContain('max-width: 100%');
    expect(rule('.article-content img')).toContain('max-height: 24rem');
  });

  it('styles inline code and code blocks', () => {
    expect(rule('.article-content code')).toContain('background-color');
    expect(rule('.article-content pre')).toContain('overflow-x: auto');
  });
});
