import request from 'supertest';
import { buildHarness, Harness, ID, NEW_PASSWORD, OLD_PASSWORD } from '../testing/users-http-harness';

/**
 * AC-26: entrada hostil nos endpoints públicos, no login e no cadastro. Cada valor deve dar 400,
 * sem eco do que foi enviado, sem erro 500, sem e-mail e sem nenhuma chamada ao banco.
 * Cada endpoint tem um controle (pedido bem formado): prova que a rota existe e consulta o banco,
 * para "o banco não foi tocado" nos casos hostis querer dizer algo.
 */
type Probe = { label: string; value: unknown; echo?: string };
const text = (label: string, value: string, echo: string): Probe => ({ label, value, echo });
const STRINGS: Probe[] = [
  text('<script>', '<script>alert(1)</script>', '<script>'),
  text('HTML com atributo', '"><img src=x onerror=alert(1)>', 'onerror'),
  text("aspas e '; DROP TABLE", `'; DROP TABLE "User"; --`, 'DROP TABLE'),
  text('CR/LF com cabeçalho Bcc', 'a@b.com\r\nBcc: vitima@evil.test', 'Bcc'),
  text('LF com cabeçalho Subject', 'a@b.com\nSubject: oi', 'Subject: oi'),
  text('texto enorme', 'x'.repeat(20_000), 'xxxxxxxxxx'),
];
const STRUCTURED: Probe[] = [
  { label: 'objeto', value: { $ne: '' }, echo: '$ne' },
  { label: 'lista', value: ['a@b.com'], echo: 'a@b.com' },
  { label: 'número', value: 12345, echo: '12345' },
  { label: 'booleano', value: true },
  { label: 'nulo', value: null },
];

interface Endpoint {
  label: string;
  probes: Probe[];
  send: (h: Harness, value: unknown, ip: string) => request.Test;
  control: (h: Harness, ip: string) => request.Test;
}
const pub = (h: Harness, url: string, ip: string) => request(h.app.getHttpServer()).post(url).set('X-Forwarded-For', ip);
// Na query, 5.000 caracteres já é enorme: acima de ~16 KB o Node responde 431 antes de a aplicação ver o pedido.
const query = (h: Harness, name: string, value: unknown, ip: string) => {
  const qs = typeof value === 'string' ? `${name}=${encodeURIComponent(value.slice(0, 5_000))}` : `${name}[$ne]=x`;
  return h.as('get', `/users?${qs}`).set('X-Forwarded-For', ip);
};

const ENDPOINTS: Endpoint[] = [
  {
    label: 'POST /auth/forgot-password (e-mail)', probes: [...STRINGS, ...STRUCTURED],
    send: (h, value, ip) => pub(h, '/auth/forgot-password', ip).send({ email: value } as object),
    control: (h, ip) => pub(h, '/auth/forgot-password', ip).send({ email: 'ana@aponta.test' }),
  },
  {
    label: 'POST /auth/login (e-mail)', probes: [...STRINGS, ...STRUCTURED],
    send: (h, value, ip) => pub(h, '/auth/login', ip).send({ email: value, password: OLD_PASSWORD } as object),
    control: (h, ip) => pub(h, '/auth/login', ip).send({ email: 'ana@aponta.test', password: OLD_PASSWORD }),
  },
  {
    label: 'POST /auth/login (senha)', probes: [STRINGS[5], ...STRUCTURED],
    send: (h, value, ip) => pub(h, '/auth/login', ip).send({ email: 'ana@aponta.test', password: value } as object),
    control: (h, ip) => pub(h, '/auth/login', ip).send({ email: 'ana@aponta.test', password: OLD_PASSWORD }),
  },
  {
    label: 'POST /auth/password/set (token)', probes: [...STRINGS, ...STRUCTURED],
    send: (h, value, ip) => pub(h, '/auth/password/set', ip).send({ token: value, password: NEW_PASSWORD } as object),
    control: (h, ip) => pub(h, '/auth/password/set', ip).send({ token: 'a'.repeat(64), password: NEW_PASSWORD }),
  },
  {
    label: 'POST /auth/password/set (senha)', probes: [STRINGS[5], ...STRUCTURED],
    send: (h, value, ip) => pub(h, '/auth/password/set', ip).send({ token: 'a'.repeat(64), password: value } as object),
    control: (h, ip) => pub(h, '/auth/password/set', ip).send({ token: 'a'.repeat(64), password: NEW_PASSWORD }),
  },
  {
    label: 'POST /users (e-mail)', probes: [...STRINGS, ...STRUCTURED],
    send: (h, value, ip) => h.as('post', '/users', ID.admin).set('X-Forwarded-For', ip).send({ name: 'Fulano de Tal', email: value } as object),
    control: (h, ip) => h.as('post', '/users', ID.admin).set('X-Forwarded-For', ip).send({ name: 'Fulano de Tal', email: 'fulano@aponta.test' }),
  },
  {
    label: 'POST /users (grupo de permissões)', probes: [...STRINGS, ...STRUCTURED].filter((p) => p.label !== 'nulo'),
    send: (h, value, ip) => h.as('post', '/users', ID.admin).set('X-Forwarded-For', ip).send({ name: 'Fulano de Tal', email: 'fulano2@aponta.test', permissionGroupIds: [value] } as object),
    control: (h, ip) => h.as('post', '/users', ID.admin).set('X-Forwarded-For', ip).send({ name: 'Fulano de Tal', email: 'fulano3@aponta.test', permissionGroupIds: [ID.pgA] }),
  },
  {
    label: 'PATCH /users/:id (e-mail)', probes: [...STRINGS, ...STRUCTURED],
    send: (h, value, ip) => h.as('patch', `/users/${ID.bruno}`, ID.admin).set('X-Forwarded-For', ip).send({ email: value } as object),
    control: (h, ip) => h.as('patch', `/users/${ID.bruno}`, ID.admin).set('X-Forwarded-For', ip).send({ email: 'bruno.novo@aponta.test' }),
  },
  {
    label: 'PATCH /users/active (ids)', probes: [...STRINGS, ...STRUCTURED],
    send: (h, value, ip) => h.as('patch', '/users/active', ID.admin).set('X-Forwarded-For', ip).send({ ids: [value], active: false } as object),
    control: (h, ip) => h.as('patch', '/users/active', ID.admin).set('X-Forwarded-For', ip).send({ ids: [ID.diego], active: true }),
  },
  {
    label: 'GET /users?roles', probes: [...STRINGS.filter((p) => !p.label.includes('CR/LF') && !p.label.includes('LF')), STRUCTURED[0]],
    send: (h, value, ip) => query(h, 'roles', value, ip),
    control: (h, ip) => query(h, 'roles', 'AGENT,ADMIN', ip),
  },
  {
    label: 'GET /users?status', probes: [...STRINGS, STRUCTURED[0]],
    send: (h, value, ip) => query(h, 'status', value, ip),
    control: (h, ip) => query(h, 'status', 'ACTIVE', ip),
  },
];

describe('AC-26: entrada hostil (DMTE-550)', () => {
  let h: Harness;
  let n = 0;
  const ip = () => `192.0.2.${(n += 1)}`; // uma origem por pedido: o limite de tentativas não mascara a validação

  beforeAll(async () => { h = await buildHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(() => { h.prisma.calls.length = 0; h.mail.sendEmail.mockClear(); });

  describe.each(ENDPOINTS)('$label', (endpoint) => {
    it('AC-26: controle: o pedido bem formado chega ao banco e não dá erro 500', async () => {
      const res = await endpoint.control(h, ip());
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(404);
      expect(h.prisma.calls.length).toBeGreaterThan(0);
    });

    it.each(endpoint.probes.map((p) => [p.label, p] as const))('AC-26: %s responde 400 sem eco, sem e-mail e sem chamar o banco', async (_label, probe) => {
      const res = await endpoint.send(h, probe.value, ip());

      expect(res.status).toBe(400);
      if (probe.echo) expect(res.text).not.toContain(probe.echo);
      expect(h.prisma.calls).toEqual([]);
      expect(h.mail.sendEmail).not.toHaveBeenCalled();
    });
  });
});
