import request from 'supertest';
import { buildHarness, Harness, ID } from '../testing/users-http-harness';

/**
 * Rodada 2 da DMTE-550 (achado do QA no SHA 10daa4a): e-mail único sem diferença de caixa
 * também em `POST /auth/register` (público) e `PATCH /auth/me`, e a corrida entre duas
 * requisições com caixas diferentes termina em 409, não em duas contas.
 */
describe('DMTE-550 r2: e-mail em minúsculas em toda escrita (SPEC D5)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const register = (email: string, ip: string) =>
    request(h.app.getHttpServer()).post('/auth/register').set('X-Forwarded-For', ip).send({ name: 'Nova Pessoa', email, password: 'senha-forte-123' });
  const emails = () => h.prisma.tables.user.map((u) => u.email);

  it('r2: POST /auth/register guarda o e-mail aparado e em minúsculas', async () => {
    const res = await register('  Nova.Pessoa@Aponta.Test ', '203.0.113.10');

    expect([200, 201]).toContain(res.status);
    expect(emails()).toContain('nova.pessoa@aponta.test');
    expect(emails()).not.toContain('Nova.Pessoa@Aponta.Test');
  });

  it('r2: duas contas simultâneas com caixas diferentes viram uma conta e um 409', async () => {
    const [a, b] = await Promise.all([register('Dupla@Aponta.Test', '203.0.113.11'), register('dupla@aponta.test', '203.0.113.12')]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(emails().filter((e) => e.toLowerCase() === 'dupla@aponta.test')).toHaveLength(1);
  });

  it('r2: PATCH /auth/me guarda o novo e-mail em minúsculas', async () => {
    const res = await h.as('patch', '/auth/me', ID.ana).send({ name: 'Ana Souza', email: 'Ana.Nova@Aponta.Test' });

    expect(res.status).toBe(200);
    expect(h.row(ID.ana).email).toBe('ana.nova@aponta.test');
  });
});
