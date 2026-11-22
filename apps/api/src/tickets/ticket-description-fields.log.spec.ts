import { Logger } from '@nestjs/common';
import { ticketDescriptionFields } from './ticket-description-fields';

/** Nomes de tag vêm do cliente: o log não pode usá-los como chave livre. */
describe('ticketDescriptionFields: chaves do log limitadas', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const removed = () => logSpy.mock.calls[0][0].removido as Record<string, number>;

  it('agrupa nome de tag desconhecido em "outros", sem usar o nome como chave', () => {
    ticketDescriptionFields('<p>ok</p><senhaAbc123>x</senhaAbc123><tokenXyz987>y</tokenXyz987>');
    expect(removed()).toEqual({ outros: 2 });
    expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(/senhaAbc123|tokenXyz987/i);
  });

  it('mantém o nome de tags HTML conhecidas', () => {
    ticketDescriptionFields('<p>ok</p><script>x</script><video src=x></video>');
    expect(removed()).toEqual({ script: 1, video: 1 });
  });

  it('limita o número de chaves e preserva o total em "outros"', () => {
    const many = Array.from({ length: 300 }, (_, i) => `<tag${i}>x</tag${i}>`).join('');
    ticketDescriptionFields(`<p>ok</p>${many}`);
    const counts = removed();
    expect(Object.keys(counts).length).toBeLessThanOrEqual(21);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(300);
  });

  it('limita as chaves também com muitas tags conhecidas distintas', () => {
    const known = [
      'video', 'audio', 'input', 'body', 'marquee', 'details', 'summary', 'button',
      'select', 'textarea', 'canvas', 'dialog', 'embed', 'fieldset', 'figure', 'footer',
      'header', 'main', 'nav', 'section', 'article', 'aside', 'label', 'legend', 'meter',
      'progress', 'template',
    ];
    ticketDescriptionFields(`<p>ok</p>${known.map((t) => `<${t}>x</${t}>`).join('')}`);
    const counts = removed();
    expect(Object.keys(counts).length).toBeLessThanOrEqual(21);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(known.length);
  });
});
