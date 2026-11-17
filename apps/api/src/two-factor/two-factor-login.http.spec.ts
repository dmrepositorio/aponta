import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';
import { totpAt } from './totp';

/**
 * Seam 1 (HTTP) do desafio do segundo fator no login (DMTE-551, T5).
 * AuthController, TwoFactorController e serviços reais sobre o Prisma em memória.
 */
const STEP = 30_000;
const NOW = 1_800_000_000_000;

describe('Desafio do segundo fator no login (DMTE-551)', () => {
  let h: Harness;
  let now = NOW;
  beforeEach(async () => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    h = await buildHarness();
  });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const pub = (url: string, ip = '203.0.113.1') => request(h.app.getHttpServer()).post(url).set('X-Forwarded-For', ip);
  const login = (email = 'ana@aponta.test', password = OLD_PASSWORD, ip?: string) => pub('/auth/login', ip).send({ email, password });
  const second = (challengeToken: string, code: string, ip?: string) => pub('/auth/login/2fa', ip).send({ challengeToken, code });
  const claim = (token: string, name: string) => (h.app.get(JwtService).decode(token) as Record<string, unknown>)[name];

  /** Ativa o segundo fator da Ana (bypassando o limite do login) e devolve o segredo e os códigos de recuperação. */
  const activate = async () => {
    const { body } = await h.as('post', '/auth/2fa/setup', ID.ana);
    const res = await h.as('post', '/auth/2fa/confirm', ID.ana).send({ code: totpAt(body.secret, now) });
    return { secret: body.secret as string, codes: res.body.recoveryCodes as string[] };
  };
  const challenge = async () => (await login()).body.challengeToken as string;

  it('AC-10: quem não tem segundo fator entra direto, como antes', async () => {
    const res = await login();

    expect(res.status).toBe(201);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.twoFactorRequired).toBeUndefined();
  });

  it('AC-10: quem tem segundo fator recebe só o desafio, sem JWT, ao acertar a senha', async () => {
    await activate();

    const res = await login();

    expect(res.status).toBe(201);
    expect(res.body.twoFactorRequired).toBe(true);
    expect(res.body.challengeToken).toEqual(expect.any(String));
    expect(res.body.access_token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(h.row(ID.ana).password);
  });

  it('AC-10: senha errada continua dando 401, com ou sem segundo fator, e não devolve desafio', async () => {
    await activate();

    const res = await login('ana@aponta.test', 'errada');

    expect(res.status).toBe(401);
    expect(res.body.challengeToken).toBeUndefined();
  });

  it('AC-10: o código do aplicativo troca o desafio pelo JWT completo, com a versão da senha', async () => {
    const { secret } = await activate();
    const token = await challenge();
    now += 2 * STEP;

    const res = await second(token, totpAt(secret, now));

    expect(res.status).toBe(201);
    expect(claim(res.body.access_token, 'sub')).toBe(ID.ana);
    expect(claim(res.body.access_token, 'pv')).toBe(0);
  });

  it('AC-10: código errado, vazio ou de outro formato dá 401 e não emite JWT', async () => {
    await activate();
    const token = await challenge();

    for (const code of ['000000', '', 'abcdef', "' OR '1'='1"]) {
      const res = await second(token, code);
      expect([400, 401]).toContain(res.status);
      expect(res.body.access_token).toBeUndefined();
    }
  });

  it('AC-10: desafio adulterado, de outro formato ou vencido (5 min) é recusado', async () => {
    const { secret } = await activate();
    const token = await challenge();
    now += 2 * STEP;
    const code = totpAt(secret, now);

    expect((await second(token.slice(0, -2) + 'xx', code)).status).toBe(401);
    expect((await second('lixo', code)).status).toBe(401);
    now += 6 * 60_000;
    expect((await second(token, totpAt(secret, now))).status).toBe(401);
  });

  it('AC-10: o desafio perde o valor quando a senha muda depois dele', async () => {
    const { secret } = await activate();
    const token = await challenge();
    h.row(ID.ana).passwordVersion = 1;
    now += 2 * STEP;

    expect((await second(token, totpAt(secret, now))).status).toBe(401);
  });

  it('AC-11: o mesmo código do aplicativo não vale duas vezes, nem em outro desafio', async () => {
    const { secret } = await activate();
    now += 2 * STEP;
    const code = totpAt(secret, now);
    const first = await challenge();
    expect((await second(first, code)).status).toBe(201);

    expect((await second(await challenge(), code)).status).toBe(401);
  });

  it('AC-11: um código de recuperação entra uma vez e depois é recusado', async () => {
    const { codes } = await activate();

    expect((await second(await challenge(), codes[0])).status).toBe(201);
    expect((await second(await challenge(), codes[0])).status).toBe(401);
    expect((await second(await challenge(), codes[1].toLowerCase().replace('-', ''))).status).toBe(201); // sem traço e em minúsculas
  });

  it('AC-11: mais de 5 tentativas por minuto recebem 429', async () => {
    await activate();
    const token = await challenge();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await second(token, '000000')).status);

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses).toContain(429);
  });

  it('AC-11: o limite vale por usuário também quando as tentativas vêm de origens diferentes', async () => {
    const { secret } = await activate();
    const token = await challenge();
    now += 2 * STEP;
    const code = totpAt(secret, now); // calculado antes: o tempo não passa de 1 minuto entre as tentativas
    for (let i = 0; i < 5; i += 1) await second(token, '000000', `198.51.100.${i + 1}`);

    const res = await second(token, code, '198.51.100.99');

    expect(res.status).toBe(429);
  });

  it('AC-14: com a flag desligada quem já ativou continua sendo desafiado no login', async () => {
    await activate();
    h.setTwoFactorFlag(false);

    const res = await login();

    expect(res.body.twoFactorRequired).toBe(true);
    expect(res.body.access_token).toBeUndefined();
  });
});
