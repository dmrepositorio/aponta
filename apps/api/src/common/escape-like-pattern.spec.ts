import { escapeLikePattern } from './escape-like-pattern';

describe('escapeLikePattern', () => {
  const bs = String.fromCharCode(92);

  it.each([
    ['%', bs + '%'],
    ['_', bs + '_'],
    [bs, bs + bs],
    ['100%_ok' + bs + 'x', '100' + bs + '%' + bs + '_ok' + bs + bs + 'x'],
  ])('escapa curinga do LIKE com a barra invertida: %s', (term, escaped) => {
    expect(escapeLikePattern(term)).toBe(escaped);
  });

  it.each(["' OR 1=1 --", 'impressora', '0007', 'Maria@exemplo.test', ''])(
    'deixa intacto o que não é curinga: %s',
    (term) => {
      expect(escapeLikePattern(term)).toBe(term);
    },
  );
});
