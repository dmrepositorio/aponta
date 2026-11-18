import { buildHarness, Harness, ID } from '../testing/users-http-harness';
import { totpAt } from './totp';

/** Seam 1 (HTTP): a tela de usuários sabe quem tem segundo fator, sem receber segredo nem código (DMTE-551, T6). */
const NOW = 1_800_000_000_000;

describe('Quem tem segundo fator na lista e no detalhe de usuários (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => NOW);
    h = await buildHarness();
    const { body } = await h.as('post', '/auth/2fa/setup', ID.ana);
    await h.as('post', '/auth/2fa/confirm', ID.ana).send({ code: totpAt(body.secret, NOW) });
  });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  it('AC-16: o detalhe diz se o usuário tem segundo fator ativo, e só isso', async () => {
    const ana = await h.as('get', `/users/${ID.ana}`);
    const bruno = await h.as('get', `/users/${ID.bruno}`);

    expect(ana.body.twoFactorEnabled).toBe(true);
    expect(bruno.body.twoFactorEnabled).toBe(false);
    expect(ana.body.twoFactor).toBeUndefined();
    expect(JSON.stringify(ana.body)).not.toMatch(/secretEnc|recovery|codeHash/i);
  });

  it('AC-16: a lista traz a mesma informação em cada linha', async () => {
    const res = await h.as('get', '/users?q=ana');
    const rows: { id: string; twoFactorEnabled?: boolean; twoFactor?: unknown }[] = res.body.data;

    expect(rows.find((u) => u.id === ID.ana)?.twoFactorEnabled).toBe(true);
    expect(rows.every((u) => typeof u.twoFactorEnabled === 'boolean' && u.twoFactor === undefined)).toBe(true);
  });

  it('AC-16: segundo fator só pedido (ainda não confirmado) não conta como ativo', async () => {
    await h.as('post', '/auth/2fa/setup', ID.bruno);

    expect((await h.as('get', `/users/${ID.bruno}`)).body.twoFactorEnabled).toBe(false);
  });
});
