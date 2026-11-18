import { Logger } from '@nestjs/common';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';
import { totpAt } from './totp';

/**
 * Seam 1 (HTTP) da ativação e da desativação do segundo fator em Minha Conta (DMTE-551, T4).
 * TwoFactorController e TwoFactorService reais sobre o Prisma em memória.
 */
const STEP = 30_000;
const NOW = 1_800_000_000_000;
const RECOVERY = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/;

describe('Segundo fator em Minha Conta (DMTE-551)', () => {
  let h: Harness;
  let now = NOW;
  beforeEach(async () => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    h = await buildHarness();
  });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const setup = (userId = ID.ana) => h.as('post', '/auth/2fa/setup', userId);
  const confirm = (code: string, userId = ID.ana) => h.as('post', '/auth/2fa/confirm', userId).send({ code });
  const disable = (body: object, userId = ID.ana) => h.as('post', '/auth/2fa/disable', userId).send(body);
  const status = (userId = ID.ana) => h.as('get', '/auth/2fa/status', userId);
  const row = (userId = ID.ana) => h.prisma.tables.userTwoFactor.find((r) => r.userId === userId);

  /** Ativa o segundo fator da Ana e devolve o segredo e os códigos de recuperação. */
  const activate = async () => {
    const { body } = await setup();
    const res = await confirm(totpAt(body.secret, now));
    return { secret: body.secret as string, codes: res.body.recoveryCodes as string[] };
  };

  it('AC-08: a ativação gera um segredo pendente e a URI para o aplicativo autenticador', async () => {
    const res = await setup();

    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.otpauthUri).toBe(`otpauth://totp/Aponta:ana%40aponta.test?secret=${res.body.secret}&issuer=Aponta`);
    expect(row()).toMatchObject({ userId: ID.ana, enabled: false });
    expect((await status()).body).toEqual({ enabled: false });
  });

  it('AC-08: código errado não ativa; código válido ativa e mostra 10 códigos de recuperação', async () => {
    const { body } = await setup();
    const wrong = await confirm('000000');
    expect(wrong.status).toBe(400);
    expect(row()?.enabled).toBe(false);

    const res = await confirm(totpAt(body.secret, now));

    expect(res.status).toBe(201);
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(new Set(res.body.recoveryCodes).size).toBe(10);
    for (const code of res.body.recoveryCodes) expect(code).toMatch(RECOVERY);
    expect(row()?.enabled).toBe(true);
    expect((await status()).body).toEqual({ enabled: true });
  });

  it('AC-08: sem ter pedido a ativação, confirmar não faz nada; já ativo, pedir de novo dá 409 e não troca o segredo', async () => {
    expect((await confirm('123456')).status).toBe(400);
    const { secret } = await activate();
    const before = row()?.secretEnc;

    expect((await setup()).status).toBe(409);
    expect((await confirm(totpAt(secret, now + STEP))).status).toBe(409);
    expect(row()?.secretEnc).toBe(before);
  });

  it('AC-08: segredo e códigos de recuperação nunca aparecem em respostas seguintes nem em log', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m));
    const { secret, codes } = await activate();

    const later = JSON.stringify([(await status()).body, (await setup()).body]);
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));

    for (const secretValue of [secret, ...codes]) {
      expect(later).not.toContain(secretValue);
      expect(logged).not.toContain(secretValue);
    }
  });

  it('AC-09: o segredo fica cifrado e os códigos de recuperação ficam como hash', async () => {
    const { secret, codes } = await activate();

    expect(row()?.secretEnc).toBeTruthy();
    expect(row()?.secretEnc).not.toContain(secret);
    const stored = h.prisma.tables.twoFactorRecoveryCode.filter((r) => r.userId === ID.ana);
    expect(stored).toHaveLength(10);
    for (const code of codes) {
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(JSON.stringify(stored)).not.toContain(code.replace('-', ''));
    }
    expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.codeHash))).toBe(true);
  });

  it('AC-09: sem a chave de cifra a ativação é recusada, nada é gravado e o login de quem não tem segundo fator segue normal', async () => {
    await h.close();
    h = await buildHarness({ twoFactorKey: null });

    const res = await setup();
    expect(res.status).toBe(503);
    expect(h.prisma.tables.userTwoFactor).toHaveLength(0);

    const login = await h.as('post', '/auth/login', ID.ana).send({ email: 'ana@aponta.test', password: OLD_PASSWORD });
    expect(login.status).toBe(201);
    expect(login.body.access_token).toBeDefined();
  });

  it('AC-12: desativar exige a senha atual e um código válido; com os dois, desativa e apaga tudo', async () => {
    const { secret } = await activate();
    now += 2 * STEP; // o código da ativação já foi usado; vale um passo mais novo
    const code = totpAt(secret, now);

    expect((await disable({ password: 'errada', code })).status).toBe(400);
    expect((await disable({ password: OLD_PASSWORD, code: '000000' })).status).toBe(400);
    expect((await disable({ password: OLD_PASSWORD })).status).toBe(400);
    expect((await status()).body).toEqual({ enabled: true });

    const ok = await disable({ password: OLD_PASSWORD, code });

    expect(ok.status).toBe(201);
    expect((await status()).body).toEqual({ enabled: false });
    expect(row()).toBeUndefined();
    expect(h.prisma.tables.twoFactorRecoveryCode.filter((r) => r.userId === ID.ana)).toHaveLength(0);
  });

  it('AC-12: um código de recuperação também serve para desativar, uma vez só', async () => {
    const { codes } = await activate();

    expect((await disable({ password: OLD_PASSWORD, code: codes[0] })).status).toBe(201);
    expect((await disable({ password: OLD_PASSWORD, code: codes[0] })).status).toBe(409); // já desativado
  });

  it('AC-12: sem segundo fator ativo, desativar responde 409', async () => {
    expect((await disable({ password: OLD_PASSWORD, code: '123456' })).status).toBe(409);
  });

  it('AC-11: o código da ativação não serve de novo para desativar no mesmo passo', async () => {
    const { secret } = await activate();

    const replay = await disable({ password: OLD_PASSWORD, code: totpAt(secret, now) });

    expect(replay.status).toBe(400);
    expect((await status()).body).toEqual({ enabled: true });
  });

  it('AC-14: com a flag desligada a ativação some (404) e nada é gravado, mas o estado continua visível', async () => {
    h.setTwoFactorFlag(false);

    expect((await setup(ID.bruno)).status).toBe(404);
    expect((await confirm('123456', ID.bruno)).status).toBe(404);
    expect(h.prisma.tables.userTwoFactor).toHaveLength(0);
    expect((await status(ID.bruno)).status).toBe(200);
  });

  it('AC-14: já ativo e com a flag desligada, a pessoa ainda consegue desativar', async () => {
    const { secret } = await activate();
    h.setTwoFactorFlag(false);
    now += 2 * STEP;

    expect((await disable({ password: OLD_PASSWORD, code: totpAt(secret, now) })).status).toBe(201);
  });

  it('AC-06: payloads de injeção nos campos de código e senha dão erro de validação, nunca 500', async () => {
    await setup();
    for (const code of ["' OR '1'='1", "123456'; DROP TABLE \"User\";--", '1'.repeat(5000), { $ne: null }, ['123456']]) {
      const res = await h.as('post', '/auth/2fa/confirm').send({ code });
      expect(res.status).toBe(400);
    }
    const res = await disable({ password: { $ne: null }, code: "' OR 1=1 --" });
    expect(res.status).toBe(400);
  });

  it('AC-11: mais de 5 tentativas por minuto de confirmação recebem 429', async () => {
    await h.close();
    h = await buildHarness({ limit: 1000 });
    await setup(ID.bruno);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await confirm('000000', ID.bruno)).status);

    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses).toContain(429);
  });
});
