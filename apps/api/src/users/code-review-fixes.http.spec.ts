import request from 'supertest';
import { buildHarness, Harness, ID } from '../testing/users-http-harness';

/**
 * Achados do code-review da DMTE-550 (SPEC D12, D14 e D18): cada teste falhava contra o código
 * anterior à correção (SHA 2ac6b26), conferido em um checkout limpo desse commit.
 */
describe('DMTE-550 code-review: flag antes da validação e convite só para pendente ativo', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  it('D14: com a flag desligada as rotas respondem 404 também para corpo ou id malformado', async () => {
    h.grant(ID.gestor, 'SEND_USER_INVITES_AND_RESETS');
    h.setFlag(false);

    expect((await request(h.app.getHttpServer()).post('/auth/password/set').send({ token: 'curto', password: 1 })).status).toBe(404);
    expect((await request(h.app.getHttpServer()).post('/auth/forgot-password').send({ email: { $ne: '' } })).status).toBe(404);
    expect((await h.as('post', '/users/nao-e-uuid/invite', ID.gestor)).status).toBe(404);
    expect((await h.as('post', '/users/nao-e-uuid/password-reset', ID.gestor)).status).toBe(404);

    h.setFlag(true);
    expect((await h.as('post', '/users/nao-e-uuid/invite', ID.gestor)).status).toBe(400); // controle: ligada, a validação responde
  });

  it('D18: convite pendente de usuário inativo não recebe convite (409, sem token e sem e-mail)', async () => {
    h.grant(ID.gestor, 'SEND_USER_INVITES_AND_RESETS');

    const res = await h.as('post', `/users/${ID.gabi}/invite`, ID.gestor);

    expect(res.status).toBe(409);
    expect(h.prisma.tables.passwordToken).toHaveLength(0);
    expect(h.mail.sendEmail).not.toHaveBeenCalled();
  });
});
