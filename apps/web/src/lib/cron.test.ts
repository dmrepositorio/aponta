import { describe, expect, it } from 'vitest';
import { validateCron } from './cron';

describe('validateCron (JOB-02)', () => {
  it.each(['* * * * *', '*/5 * * * *', '0 3 * * 1-5', '0,30 8-18 1 1 *', '15 10 * jan mon', '0 0 * * 7', '  0   3 * * *  '])(
    'aceita %j',
    (expression) => {
      expect(validateCron(expression)).toBeNull();
    },
  );

  it('recusa expressão com menos ou mais de 5 campos, dizendo quais são os campos', () => {
    expect(validateCron('* * * *')).not.toBeNull();
    expect(validateCron('* * * *')).toMatch(/5 campos/i);
    expect(validateCron('* * * * * *')).toMatch(/5 campos/i);
    expect(validateCron('')).toMatch(/5 campos/i);
  });

  it.each(['60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 13 *', '* * * * 8', 'abc * * * *', '*/0 * * * *', '5-1 * * * *', '* * * foo *', '1,,2 * * * *'])(
    'recusa %j apontando o campo inválido',
    (expression) => {
      expect(validateCron(expression)).not.toBeNull();
      expect(validateCron(expression)).toMatch(/campo|passo|intervalo/i);
    },
  );
});
