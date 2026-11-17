import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';

/** Seam 1 (HTTP) da regra de senha única (DMTE-551, T1): cadastro, troca e definição pelo link. */
const SEND = 'SEND_USER_INVITES_AND_RESETS';
const STRONG = 'Cavalo#Azul-7418';
const WEAK = 'senha1234';

describe('Regra de senha nas três portas (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); });

  const pub = (url: string) => request(h.app.getHttpServer()).post(url);
  const register = (password: string, email = 'novo@cliente.test', name = 'Novo Cliente') =>
    pub('/auth/register').send({ name, email, password });

  it('AC-03: o cadastro recusa senha fraca com 400 e diz o que falta, sem criar o usuário', async () => {
    const res = await register(WEAK);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/pelo menos 10 caracteres/);
    expect(h.prisma.tables.user.some((u) => u.email === 'novo@cliente.test')).toBe(false);
  });

  it('AC-03: o cadastro recusa senha com o nome ou o e-mail, e aceita a forte', async () => {
    expect((await register('Novo2026#Zz9')).status).toBe(400);
    expect((await register('Cliente!123456')).status).toBe(400);
    expect((await register(STRONG)).status).toBe(201);
    expect(h.prisma.tables.user.some((u) => u.email === 'novo@cliente.test')).toBe(true);
  });

  it('AC-03: a troca de senha recusa a fraca (a senha antiga segue valendo) e aceita a forte', async () => {
    const weak = await h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: OLD_PASSWORD, newPassword: WEAK });
    expect(weak.status).toBe(400);
    expect(await bcrypt.compare(OLD_PASSWORD, h.row(ID.ana).password)).toBe(true);

    const nameBased = await h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: OLD_PASSWORD, newPassword: 'Souza2026#Xy' });
    expect(nameBased.status).toBe(400);

    const ok = await h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: OLD_PASSWORD, newPassword: STRONG });
    expect(ok.status).toBe(201);
    expect(await bcrypt.compare(STRONG, h.row(ID.ana).password)).toBe(true);
  });

  it('AC-03: definir a senha pelo link recusa a fraca sem queimar o link, e aceita a forte', async () => {
    h.grant(ID.gestor, SEND);
    expect([200, 201]).toContain((await h.as('post', `/users/${ID.elisa}/invite`, ID.gestor)).status);
    const token = h.sentToken()!;

    const weak = await pub('/auth/password/set').send({ token, password: WEAK });
    expect(weak.status).toBe(400);
    expect(JSON.stringify(weak.body.message)).toMatch(/pelo menos 10 caracteres/);
    expect(h.validTokens(ID.elisa)).toHaveLength(1);

    const byEmail = await pub('/auth/password/set').send({ token, password: 'Elisa2026#Zz9' });
    expect(byEmail.status).toBe(400);
    expect(h.validTokens(ID.elisa)).toHaveLength(1);

    const ok = await pub('/auth/password/set').send({ token, password: STRONG });
    expect(ok.status).toBe(201);
    expect(h.validTokens(ID.elisa)).toHaveLength(0);
    expect((await pub('/auth/login').send({ email: 'elisa@aponta.test', password: STRONG })).status).toBe(201);
  });

  it('AC-03: link inexistente com senha fraca responde o mesmo "link inválido", sem revelar a regra', async () => {
    const res = await pub('/auth/password/set').send({ token: 'a'.repeat(64), password: WEAK });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Link inválido ou expirado.');
  });

  it('AC-03: senha antiga de 8 caracteres continua entrando', async () => {
    h.row(ID.bruno).password = bcrypt.hashSync('abc12345', 4);
    const res = await pub('/auth/login').send({ email: 'bruno@aponta.test', password: 'abc12345' });
    expect(res.status).toBe(201);
    expect(res.body.access_token).toBeDefined();
  });
});
