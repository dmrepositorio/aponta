import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';

/** Seam 1 (HTTP): login, troca de senha e definição pelo link mexem na versão da senha (DMTE-551, T2). */
const SEND = 'SEND_USER_INVITES_AND_RESETS';
const STRONG = 'Cavalo#Azul-7418';

describe('Versão da senha nas portas que mudam a senha (DMTE-551)', () => {
  let h: Harness;
  let jwt: JwtService;
  beforeEach(async () => { h = await buildHarness(); jwt = h.app.get(JwtService); });
  afterEach(async () => { await h.close(); });

  const pub = (url: string) => request(h.app.getHttpServer()).post(url);
  const version = (id: string) => h.row(id).passwordVersion;
  const claim = (token: string, name: string) => (jwt.decode(token) as Record<string, unknown>)[name];

  it('AC-04: o login emite um token com a versão atual da senha do usuário', async () => {
    h.row(ID.bruno).passwordVersion = 3;
    const res = await pub('/auth/login').send({ email: 'bruno@aponta.test', password: OLD_PASSWORD });

    expect(res.status).toBe(201);
    expect(claim(res.body.access_token, 'pv')).toBe(3);
  });

  it('AC-04: a troca de senha sobe a versão e devolve um token novo, válido, para a sessão que trocou', async () => {
    const res = await h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: OLD_PASSWORD, newPassword: STRONG });

    expect(res.status).toBe(201);
    expect(version(ID.ana)).toBe(1);
    expect(claim(res.body.access_token, 'sub')).toBe(ID.ana);
    expect(claim(res.body.access_token, 'pv')).toBe(1);
  });

  it('AC-04: troca de senha que falha (senha atual errada ou senha fraca) não mexe na versão', async () => {
    await h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: 'errada', newPassword: STRONG });
    await h.as('post', '/auth/change-password', ID.ana).send({ currentPassword: OLD_PASSWORD, newPassword: 'fraca12345' });

    expect(version(ID.ana)).toBe(0);
  });

  it('AC-04: definir a senha pelo link sobe a versão só do dono do link', async () => {
    h.grant(ID.gestor, SEND);
    await h.as('post', `/users/${ID.elisa}/invite`, ID.gestor);
    const token = h.sentToken()!;

    const res = await pub('/auth/password/set').send({ token, password: STRONG });

    expect(res.status).toBe(201);
    expect(version(ID.elisa)).toBe(1);
    expect(version(ID.ana)).toBe(0);
  });
});
