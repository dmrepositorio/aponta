import { withoutVoidSlash } from './ticket-description-fields';

/**
 * GH-390 item 1: `withoutVoidSlash` virou varredura linear e precisa devolver
 * exatamente o que a regex antiga (`/\s*\/>/g` -> `>`) devolvia.
 */
const OLD = (html: string) => html.replace(/\s*\/>/g, '>');

// Gerador determinístico (mulberry32) para o corpus aleatório.
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('withoutVoidSlash equivale à regex antiga (GH-390)', () => {
  const CORPUS = [
    '',
    ' ',
    '/',
    '>',
    '/>',
    ' />',
    '  \t\n/>',
    '<br />',
    '<br/>',
    '<br>',
    '<img src="x" />texto<br />',
    'a / > b',
    'a /> b />',
    '/> />',
    '//>',
    '/ />',
    '/>>',
    '   />x',
    ' />',
    'texto  \n  ',
    'a  /b  />c  /  >',
    '<p>ok</p>\n\n<hr />\n',
    '   ',
    '/>/>/>',
    ' /> /> />',
  ];

  it.each(CORPUS.map((c) => [JSON.stringify(c), c]))('corpus fixo %s', (_n, input) => {
    expect(withoutVoidSlash(input)).toBe(OLD(input));
  });

  it('corpus aleatório com semente fixa (20000 entradas curtas)', () => {
    const alphabet = [' ', ' ', '\n', '\t', ' ', '/', '/', '>', '>', '<', 'a', 'b', '=', '"', ' '];
    const next = rng(390);
    for (let k = 0; k < 20000; k++) {
      const len = Math.floor(next() * 14);
      let s = '';
      for (let c = 0; c < len; c++) s += alphabet[Math.floor(next() * alphabet.length)];
      const got = withoutVoidSlash(s);
      if (got !== OLD(s)) {
        throw new Error(`divergência para ${JSON.stringify(s)}: ${JSON.stringify(got)} != ${JSON.stringify(OLD(s))}`);
      }
    }
  });

  it('entradas longas moderadas (regex antiga ainda é viável) são idênticas', () => {
    for (const input of [
      ' '.repeat(3000) + '/>',
      ' '.repeat(3000),
      '/>'.repeat(3000),
      ('a  ' + ' '.repeat(50) + '/>').repeat(100),
    ]) {
      expect(withoutVoidSlash(input)).toBe(OLD(input));
    }
  });
});
