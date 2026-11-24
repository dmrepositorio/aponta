import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// #398: arquivo de verificação de propriedade do Google Search Console, servido na raiz do site.
// Não pode ser removido depois da verificação.

describe('google-site-verification (#398)', () => {
  it('serves the exact one-line token from public/', () => {
    const raw = readFileSync(resolve(__dirname, '../public/google920dde4ab533fa62.html'), 'utf8');
    expect(raw.replace(/\n$/, '')).toBe('google-site-verification: google920dde4ab533fa62.html');
  });
});
