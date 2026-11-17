import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildHarness, GOOGLE_CLIENT_SECRET, Harness, ID } from '../testing/users-http-harness';
import { totpAt } from '../two-factor/totp';

/**
 * Seam 1 (HTTP) do login com Google (DMTE-551, T7). SocialAuthController e serviços reais sobre o Prisma
 * em memória; o Google é simulado em memória (`h.oauth`), com a checagem de PKCE, de segredo e de redirect.
 */
const NOW = 1_800_000_000_000;
const BASE = 'https://aponta.test';
const CALLBACK = `${BASE}/api/auth/social/google/callback`;

describe('Login com Google (DMTE-551)', () => {
  let h: Harness;
  let now = NOW;
  beforeEach(async () => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    h = await buildHarness();
  });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const http = () => request(h.app.getHttpServer());
  const get = (url: string, cookie?: string) => {
    const req = http().get(url).set('X-Forwarded-For', '203.0.113.5');
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const exchange = (code: unknown) => http().post('/auth/social/exchange').set('X-Forwarded-For', '203.0.113.5').send({ code });
  const fragment = (location: string) => new URLSearchParams(new URL(location).hash.slice(1));

  /** Faz o navegador ir ao início, ensina o Google simulado o que foi pedido e devolve o que o retorno precisa. */
  const start = async () => {
    const res = await get('/auth/social/google/start');
    const url = new URL(res.headers.location);
    h.oauth.authorize = {
      codeChallenge: url.searchParams.get('code_challenge') ?? '',
      nonce: url.searchParams.get('nonce') ?? '',
      redirectUri: url.searchParams.get('redirect_uri') ?? '',
    };
    return { res, url, state: url.searchParams.get('state') ?? '', cookie: String(res.headers['set-cookie']?.[0] ?? '').split(';')[0] };
  };
  const callback = (s: { state: string; cookie: string }, code = 'code-ok') =>
    get(`/auth/social/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(s.state)}`, s.cookie);
  /** Fluxo completo até o redirecionamento final; devolve a resposta do retorno. */
  const signIn = async (claims: Record<string, unknown> = {}) => {
    Object.assign(h.oauth.claims, claims);
    return callback(await start());
  };
  const linked = () => h.prisma.tables.externalIdentity;
  const failure = (res: { headers: Record<string, any> }) => fragment(res.headers.location).get('social_error');
  const claim = (token: string, name: string) => (h.app.get(JwtService).decode(token) as Record<string, unknown>)[name];

  describe('quais provedores o login oferece', () => {
    it('AC-22: só oferece o Google com a flag ligada e as variáveis do provedor configuradas', async () => {
      expect((await get('/auth/social/providers')).body).toEqual({ providers: ['google'] });

      h.setSocialFlag('google', false);
      expect((await get('/auth/social/providers')).body).toEqual({ providers: [] });

      await h.close();
      h = await buildHarness({ googleConfigured: false });
      expect((await get('/auth/social/providers')).body).toEqual({ providers: [] });
    });

    it('AC-22: sem a flag, sem as variáveis ou com provedor desconhecido, início e retorno respondem 404', async () => {
      h.setSocialFlag('google', false);
      expect((await get('/auth/social/google/start')).status).toBe(404);
      expect((await get('/auth/social/google/callback?code=x&state=y')).status).toBe(404);

      h.setSocialFlag('google', true);
      expect((await get('/auth/social/orkut/start')).status).toBe(404);

      await h.close();
      h = await buildHarness({ googleConfigured: false });
      expect((await get('/auth/social/google/start')).status).toBe(404);
    });
  });

  describe('início', () => {
    it('AC-17: leva ao Google com state, nonce, PKCE S256 e o redirect da API, sem o segredo, e prende o navegador por cookie', async () => {
      const { res, url, state } = await start();

      expect(res.status).toBe(302);
      expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('google-client-id-test');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email');
      expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url.searchParams.get('nonce')).toMatch(/^[0-9a-f]{32}$/);
      expect(state.length).toBeGreaterThan(40);
      expect(res.headers.location).not.toContain(GOOGLE_CLIENT_SECRET);
      const cookie = String(res.headers['set-cookie']?.[0]);
      expect(cookie).toMatch(/^aponta_oauth=[0-9a-f]+;/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/auth\/social/);
      expect(cookie).toMatch(/Secure/i);
    });
  });

  describe('retorno e troca do código', () => {
    it('AC-17: conta existente e ativa com e-mail verificado entra: liga a identidade e devolve um código de troca, sem JWT na URL', async () => {
      const res = await signIn();

      expect(res.status).toBe(302);
      expect(res.headers.location.startsWith(`${BASE}/login#social=`)).toBe(true);
      expect(res.headers.location).not.toMatch(/access_token|eyJ|token/i);
      expect(linked()).toEqual([expect.objectContaining({ provider: 'google', subject: 'google-sub-1', userId: ID.ana })]);

      const done = await exchange(fragment(res.headers.location).get('social'));
      expect([200, 201]).toContain(done.status);
      expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
      expect(claim(done.body.access_token, 'pv')).toBe(0);
    });

    it('AC-19: o código de troca vale uma vez só', async () => {
      const code = fragment((await signIn()).headers.location).get('social');

      expect([200, 201]).toContain((await exchange(code)).status);
      expect((await exchange(code)).status).toBe(401);
    });

    it('AC-19: o código de troca vence em 60 segundos', async () => {
      const code = fragment((await signIn()).headers.location).get('social');
      now += 61_000;

      expect((await exchange(code)).status).toBe(401);
    });

    it('AC-19: código de troca desconhecido ou de outro formato é recusado, sem erro 500', async () => {
      for (const code of ['inexistente', '', "' OR '1'='1", 'a'.repeat(5000), { $ne: null }, ['x']]) {
        expect([400, 401]).toContain((await exchange(code)).status);
      }
    });

    it('AC-18: nunca cria usuário: e-mail desconhecido volta com "not_found" e nada é gravado', async () => {
      const before = h.prisma.tables.user.length;
      const res = await signIn({ email: 'desconhecida@exemplo.test' });

      expect(failure(res)).toBe('not_found');
      expect(h.prisma.tables.user).toHaveLength(before);
      expect(linked()).toHaveLength(0);
    });

    it('AC-18: conta inativa volta com "inactive" e convite pendente com "not_found", sem ligar identidade', async () => {
      expect(failure(await signIn({ email: 'diego@aponta.test' }))).toBe('inactive');
      expect(failure(await signIn({ email: 'elisa@aponta.test' }))).toBe('not_found');
      expect(linked()).toHaveLength(0);
    });

    it.each([[false], ['false'], [undefined]])('AC-18: e-mail não verificado (%s) volta com "unverified" e nada é ligado', async (verified) => {
      const res = await signIn({ email_verified: verified });

      expect(failure(res)).toBe('unverified');
      expect(linked()).toHaveLength(0);
    });

    it('AC-18: sem e-mail no token volta com "unverified"', async () => {
      expect(failure(await signIn({ email: undefined }))).toBe('unverified');
    });

    it('AC-20: depois de ligada, a entrada é pelo identificador do provedor: trocar o e-mail da conta não muda quem entra', async () => {
      await signIn();
      h.row(ID.ana).email = 'ana.nova@aponta.test';

      const res = await signIn({ email: 'qualquer@exemplo.test' });
      const done = await exchange(fragment(res.headers.location).get('social'));

      expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
      expect(linked()).toHaveLength(1);
    });

    it('AC-20: o identificador ligado a uma conta nunca entra na conta de outra, mesmo que o e-mail do token seja o dela', async () => {
      await signIn();

      const res = await signIn({ email: 'bruno@aponta.test' });
      const done = await exchange(fragment(res.headers.location).get('social'));

      expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
    });

    it('AC-20: o login social não muda o papel nem a organização do usuário', async () => {
      const before = { role: h.row(ID.carla).role, organizationId: h.row(ID.carla).organizationId };
      await signIn({ email: 'carla@cliente.test', sub: 'google-sub-carla' });

      expect({ role: h.row(ID.carla).role, organizationId: h.row(ID.carla).organizationId }).toEqual(before);
    });

    it('AC-21: quem tem segundo fator recebe o desafio, não o JWT, depois do login social', async () => {
      const { body } = await h.as('post', '/auth/2fa/setup', ID.ana);
      await h.as('post', '/auth/2fa/confirm', ID.ana).send({ code: totpAt(body.secret, now) });

      const res = await signIn();
      const done = await exchange(fragment(res.headers.location).get('social'));

      expect(done.body.twoFactorRequired).toBe(true);
      expect(done.body.challengeToken).toEqual(expect.any(String));
      expect(done.body.access_token).toBeUndefined();
    });

    it('AC-19: conta inativada depois do retorno e antes da troca não entra', async () => {
      const code = fragment((await signIn()).headers.location).get('social');
      h.row(ID.ana).active = false;

      expect((await exchange(code)).status).toBe(401);
    });
  });

  describe('validações do retorno', () => {
    it('AC-19: state adulterado, de outro formato ou reutilizado é recusado', async () => {
      const first = await start();
      expect(failure(await callback({ ...first, state: `${first.state.slice(0, -3)}xyz` }))).toBe('failed');
      expect(failure(await callback({ ...first, state: 'lixo' }))).toBe('failed');

      const ok = await callback(first);
      expect(ok.headers.location).toContain('#social=');
      expect(failure(await callback(first))).toBe('failed'); // o mesmo state não vale duas vezes
    });

    it('AC-19: state vencido (10 minutos) é recusado', async () => {
      const s = await start();
      now += 11 * 60_000;

      expect(failure(await callback(s))).toBe('failed');
    });

    it('AC-19: sem o cookie, ou com o cookie de outra sessão, o retorno é recusado', async () => {
      const first = await start();
      const second = await start();
      h.oauth.authorize = { ...h.oauth.authorize! }; // o Google responde ao último pedido

      expect(failure(await callback({ ...first, cookie: '' }))).toBe('failed');
      expect(failure(await callback({ state: first.state, cookie: second.cookie }))).toBe('failed');
      expect(linked()).toHaveLength(0);
    });

    it.each([
      ['nonce diferente do pedido', { nonce: 'outro' }],
      ['audiência de outro aplicativo', { aud: 'outro-aplicativo' }],
      ['emissor desconhecido', { iss: 'https://evil.example' }],
      ['token já vencido', { exp: Math.floor(NOW / 1000) - 10 }],
      ['sem identificador (sub)', { sub: undefined }],
    ])('AC-19: id_token com %s é recusado e nada é ligado', async (_label, claims) => {
      expect(failure(await signIn(claims))).toBe('failed');
      expect(linked()).toHaveLength(0);
    });

    it('AC-19: recusa do usuário no Google (error), código recusado e falha do provedor voltam com "failed"', async () => {
      const s = await start();
      expect(failure(await get('/auth/social/google/callback?error=access_denied&state=' + encodeURIComponent(s.state), s.cookie))).toBe('failed');

      expect(failure(await callback(await start(), 'codigo-ruim'))).toBe('failed');

      h.oauth.tokenStatus = 500;
      expect(failure(await callback(await start()))).toBe('failed');
      expect(linked()).toHaveLength(0);
    });

    it('AC-06: entrada hostil em code e state volta com "failed", sem erro 500 e sem tocar o provedor', async () => {
      const s = await start();
      h.oauth.requests.length = 0;
      const attempts = [
        `/auth/social/google/callback?code=${encodeURIComponent("' OR '1'='1")}&state=${encodeURIComponent("'; DROP TABLE \"User\";--")}`,
        `/auth/social/google/callback?code=${'a'.repeat(5000)}&state=${'b'.repeat(5000)}`,
        '/auth/social/google/callback?code[$ne]=x&state[$ne]=y',
        '/auth/social/google/callback',
      ];
      for (const url of attempts) {
        const res = await get(url, s.cookie);
        expect(res.status).toBe(302);
        expect(failure(res)).toBe('failed');
      }
      expect(h.oauth.requests).toHaveLength(0);
    });
  });

  it('AC-23: o segredo do provedor não aparece em nenhuma resposta nem em log', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m));
    const s = await start();
    const res = await callback(s);
    const done = await exchange(fragment(res.headers.location).get('social'));
    await signIn({ email: 'desconhecida@exemplo.test' });

    const seen = JSON.stringify([s.res.headers, res.headers, res.text, done.body, spies.flatMap((spy) => spy.mock.calls)]);
    expect(seen).not.toContain(GOOGLE_CLIENT_SECRET);
  });
});
