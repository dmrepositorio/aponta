import { sanitizeTicketDescription as sanitize } from './sanitize-ticket-description';

/**
 * QA da GH-368: a decisão "isto parece HTML?" não pode depender de listas
 * curtas de tags. Qualquer tag HTML5 conhecida ou atributo on* dentro de tag
 * manda a entrada pelo sanitizador.
 */
describe('sanitizeTicketDescription: HTML fora das listas reconhecida e perigosa', () => {
  const HANDLER_RE = /\bon[a-z]+\s*=/i;

  it.each([
    ['video', '<video src=x onerror=alert(1)>'],
    ['details', '<details open ontoggle=alert(1)>x</details>'],
    ['input', '<input autofocus onfocus=alert(1)>'],
    ['body', '<body onload=alert(1)>'],
    ['marquee', '<marquee onstart=alert(1)>x</marquee>'],
    ['audio', '<audio src=x onerror=alert(1)>'],
    ['maiúsculas', '<VIDEO SRC=x ONERROR=alert(1)>'],
    ['aspas ausentes e espaço em volta do =', '<video src=x onerror = alert(1)>'],
    ['aspas simples', "<details open ontoggle='alert(1)'>x</details>"],
    ['quebra de linha antes do handler', '<details\nopen\nontoggle=alert(1)>x</details>'],
    ['tab antes do handler', '<video\tsrc=x\tonerror=alert(1)>'],
    ['barra no lugar do espaço', '<video/onerror=alert(1)>'],
    ['svg com filho aninhado', '<svg><g onload=alert(1)></g></svg>'],
    ['math com filho aninhado', '<math><mi onclick=alert(1)>x</mi></math>'],
    ['tag desconhecida com handler', '<custom-el onfocus=alert(1)>x</custom-el>'],
    ['texto antes e depois', 'antes <video src=x onerror=alert(1)> depois'],
  ])('%s: remove o handler', (_nome, input) => {
    const out = sanitize(input);
    expect(out).not.toMatch(HANDLER_RE);
    expect(out).not.toMatch(/alert\(1\)/);
  });

  it.each([
    ['<video src=x onerror=alert(1)>', '<video'],
    ['<input autofocus onfocus=alert(1)>', '<input'],
    ['<body onload=alert(1)>', '<body'],
    ['<audio src=x onerror=alert(1)>', '<audio'],
  ])('descarta a tag fora da lista permitida: %s', (input, tag) => {
    expect(sanitize(input).toLowerCase()).not.toContain(tag);
  });

  it('mantém o conteúdo legítimo ao redor', () => {
    expect(sanitize('<p>ok</p><video src=x onerror=alert(1)></video><p>fim</p>')).toBe(
      '<p>ok</p><p>fim</p>',
    );
  });

  it('é idempotente nesses casos', () => {
    for (const input of ['<video src=x onerror=alert(1)>', '<details\nopen\nontoggle=alert(1)>x</details>']) {
      const once = sanitize(input);
      expect(sanitize(once)).toBe(once);
    }
  });

  describe('texto puro sem tag nem atributo continua intacto', () => {
    it.each([
      'onerror=alert(1) escrito como texto',
      'o botão onclick = salvar não é tag',
      'a < b e c > d',
      'x <5 y> z',
    ])('%j', (input) => {
      expect(sanitize(input)).toBe(input);
    });
  });

  describe('limite aceito (decisão do usuário, SPEC GH-368 seção Riscos)', () => {
    // Caracterização, não correção: `<b ` colado ao texto é tag reconhecida,
    // igual ao HTML_TAG_RE do front. O editor rico grava `<` do texto como
    // `&lt;`; só texto puro antigo de outro cliente com `<b ` solto sofre.
    it('texto puro com "<b " solto é tratado como HTML e perde conteúdo', () => {
      expect(sanitize('a<b && c>d')).toBe('a<b>d</b>');
    });
  });
});
