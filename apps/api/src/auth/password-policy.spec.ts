import { checkPassword } from './password-policy';

const owner = { name: 'João da Silva Prado', email: 'joao.prado@empresa-exemplo.com.br' };
const STRONG = 'Cavalo#Azul-7418';

describe('Regra de senha (DMTE-551)', () => {
  it('AC-01: aceita uma senha que cumpre tudo', () => {
    expect(checkPassword(STRONG, owner)).toEqual([]);
  });

  it.each([
    ['menos de 10 caracteres', 'Ab#1xyzQw', 'pelo menos 10 caracteres'],
    ['sem maiúscula', 'cavalo#azul-7418', 'letra maiúscula'],
    ['sem minúscula', 'CAVALO#AZUL-7418', 'letra minúscula'],
    ['sem número', 'Cavalo#Azul-Verde', 'número'],
    ['sem símbolo', 'CavaloAzul74181', 'símbolo'],
  ])('AC-01: recusa senha %s e diz o que falta', (_label, password, expected) => {
    const problems = checkPassword(password, owner);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' | ')).toContain(expected);
  });

  it('AC-01: lista todos os requisitos que faltam, não só o primeiro', () => {
    expect(checkPassword('abc', owner).length).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ['parte do nome com números colados', 'Prado2026#xx'],
    ['nome com símbolo e número', 'Joao!1234567'],
    ['nome em maiúsculas e com acento', 'JOÃO_1abcdefg'],
    ['sobrenome no meio', 'Zz9#silvaQwerty'],
    ['parte local do e-mail inteira', 'joao.prado#A9bcd'],
    ['domínio do e-mail', 'Empresa-exemplo#9Az'],
  ])('AC-02: recusa senha com %s', (_label, password) => {
    expect(checkPassword(password, owner).join(' | ')).toMatch(/nome|e-mail/);
  });

  it('AC-02: não recusa pedaços curtos nem comuns de nome, e-mail ou domínio', () => {
    // "da" tem 2 letras e "com"/"br" são rótulos curtos do domínio: não contam.
    expect(checkPassword('Cavalo#da#com#br9', owner)).toEqual([]);
  });

  it('AC-02: a regra de nome vale também para nome sem acento e e-mail simples', () => {
    expect(checkPassword('Maria2026#Zz9', { name: 'Maria', email: 'm@x.io' }).join(' ')).toMatch(/nome/);
  });
});
