import request from 'supertest';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';
import { totpAt } from './totp';

/**
 * Achado do code-review (DMTE-551): duas requisições simultâneas com o mesmo código TOTP não podem passar as duas
 * (AC-11, "código TOTP repetido na mesma janela é recusado"). Seam 1 (HTTP), Prisma em memória.
 */
const STEP = 30_000;
const NOW = 1_800_000_000_000;

describe('Código TOTP usado em requisições simultâneas (DMTE-551, achado do code-review)', () => {
  let h: Harness;
  let now = NOW;
  beforeEach(async () => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    h = await buildHarness();
  });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const pub = (url: string, ip: string) => request(h.app.getHttpServer()).post(url).set('X-Forwarded-For', ip);

  /** As duas requisições leem o estado do segundo fator antes de qualquer uma gravar: a corrida que um banco real permite. */
  const bothReadBeforeEitherWrites = () => {
    const read = h.prisma.userTwoFactor.findUnique.bind(h.prisma.userTwoFactor);
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    jest.spyOn(h.prisma.userTwoFactor, 'findUnique').mockImplementation(async (args: unknown) => {
      const row = await read(args);
      arrived += 1;
      if (arrived === 2) release();
      if (arrived <= 2) await gate;
      return row;
    });
  };

  it('AC-11: dois logins ao mesmo tempo com o mesmo código: só um entra', async () => {
    const { body } = await h.as('post', '/auth/2fa/setup', ID.ana);
    await h.as('post', '/auth/2fa/confirm', ID.ana).send({ code: totpAt(body.secret, now) });
    const challenges = await Promise.all(
      [1, 2].map(async (i) => (await pub('/auth/login', `198.51.100.${i}`).send({ email: 'ana@aponta.test', password: OLD_PASSWORD })).body.challengeToken as string),
    );
    now += 2 * STEP;
    const code = totpAt(body.secret, now);
    bothReadBeforeEitherWrites();

    const results = await Promise.all(challenges.map((token, i) => pub('/auth/login/2fa', `198.51.100.${10 + i}`).send({ challengeToken: token, code })));

    expect(results.map((r) => r.status).sort()).toEqual([201, 401]);
  });

  it('AC-11: dois pedidos simultâneos de desativar com o mesmo código: só um desativa', async () => {
    const { body } = await h.as('post', '/auth/2fa/setup', ID.ana);
    await h.as('post', '/auth/2fa/confirm', ID.ana).send({ code: totpAt(body.secret, now) });
    now += 2 * STEP;
    const code = totpAt(body.secret, now);
    bothReadBeforeEitherWrites();

    const results = await Promise.all([1, 2].map(() => h.as('post', '/auth/2fa/disable', ID.ana).send({ password: OLD_PASSWORD, code })));

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });
});
