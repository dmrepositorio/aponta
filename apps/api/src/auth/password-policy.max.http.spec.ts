import request from 'supertest';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';

/** Achado do code-review (DMTE-551): o máximo de 128 caracteres vale no cadastro e na troca, e a recusa diz "10 caracteres" em português. */
const STRONG = 'Cavalo#Azul-7418';
const TOO_LONG = `Aa#1${'x'.repeat(125)}`; // 129 caracteres

describe('Tamanho da senha no cadastro e na troca (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); });

  const register = (password: string) =>
    request(h.app.getHttpServer()).post('/auth/register').send({ name: 'Novo Cliente', email: 'novo@cliente.test', password });
  const change = (newPassword: string) => h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: OLD_PASSWORD, newPassword });

  it('AC-03: senha de 129 caracteres é recusada no cadastro e na troca; a de 128 passa', async () => {
    expect(TOO_LONG).toHaveLength(129);
    expect((await register(TOO_LONG)).status).toBe(400);
    expect((await change(TOO_LONG)).status).toBe(400);
    expect(h.prisma.tables.user.some((u) => u.email === 'novo@cliente.test')).toBe(false);

    expect((await register(TOO_LONG.slice(0, 128))).status).toBe(201);
    expect((await change(`Bb#2${'y'.repeat(124)}`)).status).toBe(201);
  });

  it('AC-03: senha muito curta também recebe a lista em português, dizendo que faltam 10 caracteres', async () => {
    for (const res of [await register('abc'), await change('abc')]) {
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toMatch(/pelo menos 10 caracteres/);
    }
  });
});
