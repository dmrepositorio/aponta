import { Logger } from '@nestjs/common';
import { ticketDescriptionFields } from './ticket-description-fields';

/**
 * GH-390 item 1: entrada hostil no limite do DTO (100000 caracteres) precisa
 * passar por `ticketDescriptionFields` inteira (sanitizador, log, texto
 * buscável) em tempo linear. `withoutVoidSlash` usava `\s*\/>` sem âncora,
 * quadrática em corridas de espaço (centenas de ms a segundos por requisição).
 *
 * O orçamento de 500 ms dá margem para runner compartilhado e lento (o pior
 * caso legítimo mede 20 a 75 ms), e uma regressão quadrática continua pega: o
 * defeito antigo levava 8 a 12 s neste mesmo limite de 100000 caracteres.
 */
const DTO_LIMIT = 100000;
const BUDGET_MS = 500;

const fill = (unit: string, prefix = '', suffix = '') =>
  (prefix + unit.repeat(DTO_LIMIT) + suffix).slice(0, DTO_LIMIT);

const HOSTILE: Array<[string, string]> = [
  ['espaços sozinhos', ' '.repeat(DTO_LIMIT)],
  ['<foo + espaços + href=x>', '<foo' + ' '.repeat(DTO_LIMIT - 12) + 'href=x>'],
  ['"/>" repetido', '/>'.repeat(DTO_LIMIT / 2)],
  ['espaços + "/>"', ' '.repeat(DTO_LIMIT - 2) + '/>'],
  ['"<br />" repetido', '<br />'.repeat(Math.floor(DTO_LIMIT / 7))],
  ['"<a" repetido', '<a'.repeat(DTO_LIMIT / 2)],
  ['atributos sem fechar', fill('a=b ', '<foo ')],
  ['quebras de linha', '\n'.repeat(DTO_LIMIT)],
  ['"< " repetido', '< '.repeat(DTO_LIMIT / 2)],
  // GH-390 item 2: o parser agora decide os portões de atributo.
  ['aspa sem fechar', '<foo title="' + 'a>'.repeat(DTO_LIMIT / 2 - 6)],
  ['title com ">" repetido', fill('<x title=">" ')],
  ['href desconhecido repetido', fill('<x href=a ')],
  ['onclick repetido', fill('<x onclick=a ')],
  // GH-390 item 3: referências numéricas sem ";" passam por um regex a mais.
  ['"&#" + dígitos longos', '<x href="&#' + '1'.repeat(DTO_LIMIT - 20) + ';">'],
  ['"&#1" repetido', fill('<x href="&#1&#1&#x1&#x', '')],
  ['"&#x" + hexa longo', '<x href="&#x' + 'a'.repeat(DTO_LIMIT - 20) + ';">'],
];

describe('ticketDescriptionFields: entrada hostil no limite do DTO (GH-390 item 1)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const measure = (input: string) => {
    const start = process.hrtime.bigint();
    ticketDescriptionFields(input);
    return Number(process.hrtime.bigint() - start) / 1e6;
  };

  it.each(HOSTILE)('%s: menos de 500 ms', (_nome, input) => {
    expect(input.length).toBeLessThanOrEqual(DTO_LIMIT);
    measure(input); // aquecimento do JIT
    const ms = measure(input);
    if (process.env.GH390_MEDIDAS) {
      process.stdout.write(`GH390 ${_nome}: ${ms.toFixed(1)} ms\n`);
    }
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
