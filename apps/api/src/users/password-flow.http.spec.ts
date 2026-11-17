import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { buildHarness, Harness, ID, NEW_PASSWORD, OLD_PASSWORD } from '../testing/users-http-harness';

/**
 * Seam 1 (HTTP) do fluxo de convite, redefinição e "esqueci minha senha".
 * UsersController e AuthController reais; PasswordTokensService e PasswordFlowService reais
 * sobre o Prisma em memória; MailService e FeatureFlagsService simulados.
 */
const HOUR = 3_600_000;
const GENERIC = 'Link inválido ou expirado.';
const SEND = 'SEND_USER_INVITES_AND_RESETS';

describe('Convite, redefinição e esqueci minha senha: HTTP (DMTE-550)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const pub = (url: string) => request(h.app.getHttpServer()).post(url);
  const invite = (id: string, userId = ID.gestor) => h.as('post', `/users/${id}/invite`, userId);
  const reset = (id: string, userId = ID.gestor) => h.as('post', `/users/${id}/password-reset`, userId);
  const setPassword = (payload: unknown) => pub('/auth/password/set').send(payload as object);
  const forgot = (payload: unknown, ip = '203.0.113.7') => pub('/auth/forgot-password').set('X-Forwarded-For', ip).send(payload as object);
  const login = (email: string, password: string) => pub('/auth/login').send({ email, password });
  const eventually = async (condition: () => boolean, ms = 1000) => {
    const end = Date.now() + ms;
    while (!condition() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  };
  const expiresInHours = (userId: string, hours: number, before: number, after: number) => {
    const [token] = h.validTokens(userId);
    const expires = new Date(token?.expiresAt ?? 0).getTime();
    return expires >= before + hours * HOUR && expires <= after + hours * HOUR;
  };

  describe('POST /users/:id/invite (AC-17, AC-16)', () => {
    it('AC-17: sem SEND_USER_INVITES_AND_RESETS responde 403, sem token e sem e-mail', async () => {
      expect((await invite(ID.elisa)).status).toBe(403);
      expect((await invite(ID.elisa, ID.ana)).status).toBe(403);
      h.grant(ID.gestor, SEND);
      expect([200, 201]).toContain((await invite(ID.elisa)).status); // controle: com a chave passa
      expect(h.prisma.tables.passwordToken).toHaveLength(1);
      expect(h.mail.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('AC-17: com a flag desligada responde 404 e não cria token nem manda e-mail', async () => {
      h.grant(ID.gestor, SEND);
      h.setFlag(false);

      expect((await invite(ID.elisa)).status).toBe(404);
      expect(h.prisma.tables.passwordToken).toHaveLength(0);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();

      h.setFlag(true);
      expect([200, 201]).toContain((await invite(ID.elisa)).status); // controle: ligada, funciona
    });

    it('AC-17: envia o link de 72 h montado de PUBLIC_APP_URL; só o hash fica no banco', async () => {
      h.grant(ID.gestor, SEND);
      const before = Date.now();
      const res = await invite(ID.elisa);
      const after = Date.now();

      expect([200, 201]).toContain(res.status);
      expect(res.body).toEqual({ ok: true });
      expect(h.mail.sendEmail).toHaveBeenCalledTimes(1);
      expect(h.mail.sendEmail.mock.calls[0][0].to).toBe('elisa@aponta.test');
      const raw = h.sentToken();
      expect(raw).toMatch(/^[0-9a-f]{64}$/);
      expect(h.mail.sendEmail.mock.calls[0][0].text).toContain(`https://aponta.test/definir-senha#t=${raw}`);
      expect(res.text).not.toContain(raw);
      const [stored] = h.validTokens(ID.elisa);
      expect(stored).toMatchObject({ purpose: 'INVITE', createdById: ID.gestor });
      expect(JSON.stringify(h.prisma.tables.passwordToken)).not.toContain(raw);
      expect(expiresInHours(ID.elisa, 72, before, after)).toBe(true);
    });

    it('AC-17: o nome no corpo do e-mail sai escapado', async () => {
      h.grant(ID.gestor, SEND);
      h.row(ID.elisa).name = '<b>Elisa</b>';

      await invite(ID.elisa);

      const sent = h.mail.sendEmail.mock.calls[0]?.[0];
      expect(sent).toBeDefined();
      expect(String(sent?.html ?? '')).not.toContain('<b>Elisa</b>');
    });

    it('AC-17: só convida quem está com convite pendente (409 para usuário com senha), sem token', async () => {
      h.grant(ID.gestor, SEND);
      expect([200, 201]).toContain((await invite(ID.elisa)).status); // controle
      h.prisma.tables.passwordToken.length = 0;
      h.mail.sendEmail.mockClear();

      expect((await invite(ID.ana)).status).toBe(409);
      expect(h.prisma.tables.passwordToken).toHaveLength(0);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();
    });

    it('AC-17: usuário inexistente responde 404; id que não é UUID responde 400 ou 404; nenhum e-mail sai', async () => {
      h.grant(ID.gestor, SEND);
      expect([200, 201]).toContain((await invite(ID.elisa)).status); // controle
      h.mail.sendEmail.mockClear();

      expect((await invite(ID.missing)).status).toBe(404);
      expect([400, 404]).toContain((await invite('nao-e-uuid')).status);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();
    });

    it('AC-17: reenviar invalida o link anterior; o novo vale', async () => {
      h.grant(ID.gestor, SEND);
      await invite(ID.elisa);
      const first = h.sentToken();
      await invite(ID.elisa);
      const second = h.sentToken();

      expect(first).not.toBe(second);
      expect((await setPassword({ token: first, password: NEW_PASSWORD })).status).toBe(400);
      expect([200, 201]).toContain((await setPassword({ token: second, password: NEW_PASSWORD })).status);
    });

    it('AC-16: e-mail recusado pelo SMTP (false) responde 502 e não deixa token válido', async () => {
      h.grant(ID.gestor, SEND);
      expect([200, 201]).toContain((await invite(ID.elisa)).status); // controle: com e-mail aceito, passa
      h.prisma.tables.passwordToken.length = 0;
      h.mail.sendEmail.mockResolvedValue(false);

      const res = await invite(ID.elisa);

      expect(res.status).toBe(502);
      expect(h.validTokens()).toHaveLength(0);
    });

    it('AC-16: erro ao enviar o e-mail responde 502 e não deixa token válido', async () => {
      h.grant(ID.gestor, SEND);
      h.mail.sendEmail.mockRejectedValue(new Error('smtp fora do ar'));

      const res = await invite(ID.elisa);

      expect(res.status).toBe(502);
      expect(h.validTokens()).toHaveLength(0);
    });
  });

  describe('POST /users/:id/password-reset (AC-22, AC-16)', () => {
    it('AC-22: sem a chave responde 403; com a flag desligada responde 404 e não cria token', async () => {
      expect((await reset(ID.ana, ID.ana)).status).toBe(403);
      expect((await reset(ID.ana)).status).toBe(403);
      h.grant(ID.gestor, SEND);
      h.setFlag(false);
      expect((await reset(ID.ana)).status).toBe(404);
      expect(h.prisma.tables.passwordToken).toHaveLength(0);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();
      h.setFlag(true);
      expect([200, 201]).toContain((await reset(ID.ana)).status); // controle
    });

    it('AC-22: só para usuário ativo e com senha: pendente, inativo e inexistente são recusados', async () => {
      h.grant(ID.gestor, SEND);
      expect([200, 201]).toContain((await reset(ID.bruno)).status); // controle
      h.prisma.tables.passwordToken.length = 0;
      h.mail.sendEmail.mockClear();

      expect((await reset(ID.elisa)).status).toBe(409);
      expect((await reset(ID.diego)).status).toBe(409);
      expect((await reset(ID.missing)).status).toBe(404);
      expect(h.prisma.tables.passwordToken).toHaveLength(0);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();
    });

    it('AC-22: envia o link de 24 h e a senha atual continua valendo até o uso', async () => {
      h.grant(ID.gestor, SEND);
      expect((await login('ana@aponta.test', OLD_PASSWORD)).status).toBe(201);
      const before = Date.now();

      const res = await reset(ID.ana);
      const after = Date.now();

      expect([200, 201]).toContain(res.status);
      expect(res.body).toEqual({ ok: true });
      expect(h.mail.sendEmail.mock.calls[0][0].to).toBe('ana@aponta.test');
      const raw = h.sentToken();
      expect(h.mail.sendEmail.mock.calls[0][0].text).toContain(`https://aponta.test/definir-senha#t=${raw}`);
      expect(h.validTokens(ID.ana)[0]).toMatchObject({ purpose: 'RESET', createdById: ID.gestor });
      expect(expiresInHours(ID.ana, 24, before, after)).toBe(true);
      expect((await login('ana@aponta.test', OLD_PASSWORD)).status).toBe(201);

      expect([200, 201]).toContain((await setPassword({ token: raw, password: NEW_PASSWORD })).status);
      expect((await login('ana@aponta.test', OLD_PASSWORD)).status).toBe(401);
      expect((await login('ana@aponta.test', NEW_PASSWORD)).status).toBe(201);
    });

    it('AC-22: pedir outra redefinição invalida o link anterior', async () => {
      h.grant(ID.gestor, SEND);
      await reset(ID.ana);
      const first = h.sentToken();
      await reset(ID.ana);
      const second = h.sentToken();

      expect(first).toBeDefined();
      expect((await setPassword({ token: first, password: NEW_PASSWORD })).status).toBe(400);
      expect([200, 201]).toContain((await setPassword({ token: second, password: NEW_PASSWORD })).status);
    });

    it('AC-16: envio recusado ou com erro responde 502 e não deixa token válido', async () => {
      h.grant(ID.gestor, SEND);
      expect([200, 201]).toContain((await reset(ID.ana)).status); // controle
      h.prisma.tables.passwordToken.length = 0;

      h.mail.sendEmail.mockResolvedValue(false);
      expect((await reset(ID.ana)).status).toBe(502);
      h.mail.sendEmail.mockRejectedValue(new Error('smtp fora do ar'));
      expect((await reset(ID.ana)).status).toBe(502);
      expect(h.validTokens()).toHaveLength(0);
    });
  });

  describe('POST /auth/password/set (AC-18, AC-20, AC-27)', () => {
    const inviteElisa = async () => {
      h.grant(ID.gestor, SEND);
      await invite(ID.elisa);
      return h.sentToken() as string;
    };

    it('AC-18: define a senha do dono do token, marca o token como usado e responde com no-store', async () => {
      const token = await inviteElisa();

      const res = await setPassword({ token, password: NEW_PASSWORD });

      expect([200, 201]).toContain(res.status);
      expect(res.body).toEqual({ ok: true });
      expect(res.headers['cache-control']).toContain('no-store');
      expect(bcrypt.compareSync(NEW_PASSWORD, h.row(ID.elisa).password)).toBe(true);
      expect(h.row(ID.elisa).password).not.toBe(NEW_PASSWORD);
      expect(h.validTokens()).toHaveLength(0);
      expect((await login('elisa@aponta.test', NEW_PASSWORD)).status).toBe(201);
    });

    it('AC-20: ao definir a senha o usuário deixa de ser Convite pendente e passa a Ativo', async () => {
      expect((await h.as('get', '/users?status=PENDING')).body.data?.map((u: { name: string }) => u.name)).toEqual(['Elisa Prado']);
      const token = await inviteElisa();

      await setPassword({ token, password: NEW_PASSWORD });

      const pending = await h.as('get', '/users?status=PENDING');
      const active = await h.as('get', '/users?status=ACTIVE&q=elisa');
      expect(pending.body.data).toEqual([]);
      expect(active.body.data?.map((u: { name: string }) => u.name)).toEqual(['Elisa Prado']);
    });

    it('AC-18: o mesmo token não serve duas vezes; a falha também sai com no-store', async () => {
      const token = await inviteElisa();
      expect([200, 201]).toContain((await setPassword({ token, password: NEW_PASSWORD })).status);

      const again = await setPassword({ token, password: 'OutraSenha#2027' });

      expect(again.status).toBe(400);
      expect(again.body.message).toBe(GENERIC);
      expect(again.headers['cache-control']).toContain('no-store');
      expect(bcrypt.compareSync(NEW_PASSWORD, h.row(ID.elisa).password)).toBe(true);
    });

    it('AC-18: inexistente, expirado, usado e substituído dão a mesma resposta genérica', async () => {
      const now = Date.now();
      const expired = await h.tokens.issue(ID.bruno, 'INVITE', HOUR, new Date(now - 2 * HOUR));
      const used = await h.tokens.issue(ID.carla, 'RESET', HOUR, new Date(now));
      await h.tokens.consume(used, new Date(now));
      const replaced = await h.tokens.issue(ID.ana, 'INVITE', 72 * HOUR, new Date(now));
      await h.tokens.issue(ID.ana, 'INVITE', 72 * HOUR, new Date(now));
      const live = await h.tokens.issue(ID.fabio, 'RESET', 24 * HOUR, new Date(now));

      const failures = [];
      for (const token of ['a'.repeat(64), expired, used, replaced]) {
        failures.push(await setPassword({ token, password: NEW_PASSWORD }));
      }
      const control = await setPassword({ token: live, password: NEW_PASSWORD });

      expect([200, 201]).toContain(control.status); // controle: token vivo passa
      expect(failures.map((r) => r.status)).toEqual([400, 400, 400, 400]);
      expect(failures.map((r) => r.body)).toEqual(Array(4).fill(failures[0].body));
      expect(failures[0].body.message).toBe(GENERIC);
      expect([ID.bruno, ID.carla, ID.ana].map((id) => h.row(id).password)).toEqual(Array(3).fill(h.row(ID.bruno).password));
      expect(bcrypt.compareSync(OLD_PASSWORD, h.row(ID.bruno).password)).toBe(true);
    });

    it.each([
      ['e-mail no corpo', (t: string) => ({ token: t, password: NEW_PASSWORD, email: 'ana@aponta.test' })],
      ['id de usuário no corpo', (t: string) => ({ token: t, password: NEW_PASSWORD, userId: ID.ana })],
      ['sem senha', (t: string) => ({ token: t })],
      ['sem token', () => ({ password: NEW_PASSWORD })],
      ['senha de 7 caracteres', (t: string) => ({ token: t, password: 'Abc#123' })],
      ['senha de 129 caracteres', (t: string) => ({ token: t, password: 'a'.repeat(129) })],
      ['senha como objeto', (t: string) => ({ token: t, password: { a: 1 } })],
      ['token curto', () => ({ token: 'ab'.repeat(31), password: NEW_PASSWORD })],
      ['token longo', () => ({ token: 'ab'.repeat(33), password: NEW_PASSWORD })],
      ['token não hexadecimal', () => ({ token: 'z'.repeat(64), password: NEW_PASSWORD })],
      ['token como lista', (t: string) => ({ token: [t], password: NEW_PASSWORD })],
    ])('AC-18: %s responde 400 e o token continua válido', async (_label, makeBody) => {
      const token = await inviteElisa();

      const res = await setPassword(makeBody(token));

      expect(res.status).toBe(400);
      expect(h.row(ID.elisa).password).toBeNull();
      expect(h.validTokens(ID.elisa)).toHaveLength(1);
      expect([200, 201]).toContain((await setPassword({ token, password: 'a'.repeat(128) })).status); // controle: 128 caracteres vale
    });

    it('AC-18: com a flag desligada responde 404 e a senha não muda', async () => {
      const token = await inviteElisa();
      h.setFlag(false);

      expect((await setPassword({ token, password: NEW_PASSWORD })).status).toBe(404);
      expect(h.row(ID.elisa).password).toBeNull();

      h.setFlag(true);
      expect([200, 201]).toContain((await setPassword({ token, password: NEW_PASSWORD })).status);
    });

    it('AC-18: tem limite de tentativas por origem (429)', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 30; i += 1) statuses.push((await setPassword({ token: 'a'.repeat(64), password: NEW_PASSWORD })).status);

      expect(statuses[0]).toBe(400);
      expect(statuses).toContain(429);
    });

    it('AC-18: nem o token nem a senha aparecem em log', async () => {
      const spies = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation());
      const consoleSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation());
      const token = await inviteElisa();
      await setPassword({ token, password: NEW_PASSWORD });
      await setPassword({ token, password: NEW_PASSWORD });

      const logged = JSON.stringify([...spies, ...consoleSpies].flatMap((s) => s.mock.calls));
      expect(token).toBeDefined();
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(NEW_PASSWORD);
    });

    it('AC-27: o link de A não troca a senha de B, nem com corpo alterado', async () => {
      const tokenA = await inviteElisa();

      const withEmail = await setPassword({ token: tokenA, password: NEW_PASSWORD, email: 'ana@aponta.test' });
      const withId = await setPassword({ token: tokenA, password: NEW_PASSWORD, userId: ID.ana });
      expect([withEmail.status, withId.status]).toEqual([400, 400]);
      expect(bcrypt.compareSync(OLD_PASSWORD, h.row(ID.ana).password)).toBe(true);

      expect([200, 201]).toContain((await setPassword({ token: tokenA, password: NEW_PASSWORD })).status);
      expect(bcrypt.compareSync(NEW_PASSWORD, h.row(ID.elisa).password)).toBe(true);
      expect(bcrypt.compareSync(OLD_PASSWORD, h.row(ID.ana).password)).toBe(true);
      expect(bcrypt.compareSync(OLD_PASSWORD, h.row(ID.bruno).password)).toBe(true);
    });
  });

  describe('POST /auth/forgot-password (AC-23)', () => {
    it('AC-23: responde sempre o mesmo corpo, exista a conta, esteja pendente, inativa ou não', async () => {
      const responses = [];
      for (const email of ['ana@aponta.test', 'ninguem@aponta.test', 'elisa@aponta.test', 'diego@aponta.test']) {
        responses.push(await forgot({ email }));
      }

      expect([200, 201]).toContain(responses[0].status);
      expect(responses[0].body).toEqual({ ok: true });
      expect(responses.map((r) => r.status)).toEqual(Array(4).fill(responses[0].status));
      expect(responses.map((r) => r.body)).toEqual(Array(4).fill({ ok: true }));
    });

    it('AC-23: só conta ativa com senha recebe o e-mail, com link de 1 h', async () => {
      const before = Date.now();
      for (const email of ['ninguem@aponta.test', 'elisa@aponta.test', 'diego@aponta.test', 'ana@aponta.test']) {
        await forgot({ email });
      }
      await eventually(() => h.mail.sendEmail.mock.calls.length >= 1);
      const after = Date.now();

      expect(h.mail.sendEmail).toHaveBeenCalledTimes(1);
      expect(h.mail.sendEmail.mock.calls[0][0].to).toBe('ana@aponta.test');
      expect(h.mail.sendEmail.mock.calls[0][0].text).toContain(`https://aponta.test/definir-senha#t=${h.sentToken()}`);
      expect(h.validTokens().map((t) => t.userId)).toEqual([ID.ana]);
      expect(h.validTokens()[0]).toMatchObject({ purpose: 'RESET' });
      expect(expiresInHours(ID.ana, 1, before, after)).toBe(true);
    });

    it('AC-23: o e-mail digitado é comparado sem diferença de caixa', async () => {
      h.row(ID.bruno).email = 'Bruno.Lima@Aponta.test'; // dado legado com caixa mista
      await forgot({ email: 'ANA@Aponta.TEST' });
      await forgot({ email: 'bruno.lima@aponta.test' });
      await eventually(() => h.mail.sendEmail.mock.calls.length >= 2);

      expect(h.mail.sendEmail.mock.calls.map((c) => String(c[0].to).toLowerCase()).sort()).toEqual(['ana@aponta.test', 'bruno.lima@aponta.test']);
    });

    it('AC-23: o envio não bloqueia a resposta', async () => {
      h.mail.sendEmail.mockReturnValue(new Promise(() => undefined));

      const outcome = await Promise.race([forgot({ email: 'ana@aponta.test' }), new Promise((r) => setTimeout(() => r('travou'), 1500))]);

      expect(outcome).not.toBe('travou');
      expect(h.mail.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('AC-23: envio recusado não muda a resposta', async () => {
      h.mail.sendEmail.mockResolvedValue(false);

      const res = await forgot({ email: 'ana@aponta.test' });

      expect([200, 201]).toContain(res.status);
      expect(res.body).toEqual({ ok: true });
      expect(h.mail.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('AC-23: com a flag desligada responde 404, sem e-mail e sem token', async () => {
      expect([200, 201]).toContain((await forgot({ email: 'ana@aponta.test' })).status); // controle: ligada, funciona
      h.prisma.tables.passwordToken.length = 0;
      h.mail.sendEmail.mockClear();
      h.setFlag(false);

      const res = await forgot({ email: 'ana@aponta.test' }, '203.0.113.99');

      expect(res.status).toBe(404);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();
      expect(h.prisma.tables.passwordToken).toHaveLength(0);
    });

    it('AC-23: limite de 5 por minuto por origem: a sexta, com e-mails diferentes, é 429', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await forgot({ email: `pessoa${i}@aponta.test` }, '198.51.100.1')).status);

      expect(statuses.slice(0, 5).every((s) => s === 200 || s === 201)).toBe(true);
      expect(statuses[5]).toBe(429);
    });

    it('AC-23: limite de 5 por minuto por e-mail: a sexta, de origens diferentes, é 429', async () => {
      const statuses: number[] = [];
      for (let i = 1; i <= 6; i += 1) statuses.push((await forgot({ email: 'ana@aponta.test' }, `198.51.100.${i}`)).status);

      expect(statuses.slice(0, 5).every((s) => s === 200 || s === 201)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });
});
