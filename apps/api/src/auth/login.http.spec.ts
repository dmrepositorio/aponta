import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { buildHarness, Harness, ID, OLD_PASSWORD } from '../testing/users-http-harness';

/** E-mail de formato válido (parte local de 64, rótulos de até 63) com exatamente `length` caracteres. */
const emailOfLength = (length: number) => `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - 65 - 132)}.com`;

/** Seam 1 (HTTP): POST /auth/login com LocalAuthGuard e LocalStrategy reais e Prisma em memória. */
describe('POST /auth/login (DMTE-550)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); });

  const login = (payload: unknown) => request(h.app.getHttpServer()).post('/auth/login').send(payload as object);

  describe('AC-08: usuário sem senha', () => {
    it('AC-08: o login recusa usuário sem senha com a mesma resposta 401 de credencial inválida', async () => {
      expect((await login({ email: 'ana@aponta.test', password: OLD_PASSWORD })).status).toBe(201); // controle

      const pending = await login({ email: 'elisa@aponta.test', password: OLD_PASSWORD });
      const wrong = await login({ email: 'ana@aponta.test', password: 'senha-errada' });
      const unknown = await login({ email: 'ninguem@aponta.test', password: OLD_PASSWORD });

      expect(pending.status).toBe(401);
      expect(pending.body).toEqual(wrong.body);
      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.status).toBe(401);
    });

    it('AC-08: nem senha vazia nem o texto "null" entram como senha de quem não tem senha', async () => {
      expect((await login({ email: 'ana@aponta.test', password: OLD_PASSWORD })).status).toBe(201); // controle

      for (const password of ['null', 'undefined', ' ']) {
        expect((await login({ email: 'elisa@aponta.test', password })).status).toBe(401);
      }
    });

    it('AC-08: a coluna password aceita nulo (schema.prisma)', () => {
      const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
      const user = /model User \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? '';
      expect(user).toMatch(/\n\s+password\s+String\?/);
    });
  });

  describe('AC-25: o corpo é validado antes de consultar o banco', () => {
    it('AC-25: credencial correta continua entrando; e-mail em maiúsculas é normalizado', async () => {
      const ok = await login({ email: 'ANA@Aponta.Test', password: OLD_PASSWORD });
      expect(ok.status).toBe(201);
      expect(typeof ok.body.access_token).toBe('string');
    });

    it('AC-25: credencial errada continua 401 com a mensagem atual', async () => {
      const res = await login({ email: 'ana@aponta.test', password: 'senha-errada' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it.each([
      ['e-mail como objeto', { email: { $ne: '' }, password: OLD_PASSWORD }, '$ne'],
      ['e-mail como lista', { email: ['ana@aponta.test'], password: OLD_PASSWORD }, 'ana@aponta.test'],
      ['e-mail como número', { email: 12345, password: OLD_PASSWORD }, '12345'],
      ['e-mail enorme', { email: `${'a'.repeat(300)}@aponta.test`, password: OLD_PASSWORD }, 'aaaaaaaaaa'],
      ['e-mail com 255 caracteres', { email: emailOfLength(255), password: OLD_PASSWORD }, 'aaaaaaaaaa'],
      ['e-mail sem formato', { email: 'sem-arroba', password: OLD_PASSWORD }, 'sem-arroba'],
      ['senha como objeto', { email: 'ana@aponta.test', password: { $ne: '' } }, '$ne'],
      ['senha como lista', { email: 'ana@aponta.test', password: [OLD_PASSWORD] }, OLD_PASSWORD],
      ['senha como número', { email: 'ana@aponta.test', password: 123456789 }, '123456789'],
      ['senha enorme', { email: 'ana@aponta.test', password: 'p'.repeat(129) }, 'pppppppppp'],
      ['senha vazia', { email: 'ana@aponta.test', password: '' }, 'ana@aponta.test'],
      ['sem corpo', {}, 'Missing'],
      ['campo extra', { email: 'ana@aponta.test', password: OLD_PASSWORD, admin: true }, 'admin'],
    ])('AC-25: %s responde 400 sem eco e sem tocar no banco', async (_label, payload, echo) => {
      expect((await login({ email: 'ana@aponta.test', password: OLD_PASSWORD })).status).toBe(201); // controle
      h.prisma.calls.length = 0;

      const res = await login(payload);

      expect(res.status).toBe(400);
      expect(res.text).not.toContain(echo);
      expect(h.prisma.calls).toEqual([]);
    });

    it('AC-25: e-mail de 254 caracteres passa pela validação (limite inclusivo)', async () => {
      const email = emailOfLength(254);
      expect(email).toHaveLength(254);
      h.prisma.tables.user.push({ id: ID.missing, name: 'Longo', email, password: null, role: 'AGENT', active: true });

      const res = await login({ email, password: OLD_PASSWORD });

      expect(res.status).toBe(401);
    });
  });
});
