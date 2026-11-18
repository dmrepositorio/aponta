import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildHarness, GITHUB_CLIENT_SECRET, GITHUB_EMAILS_URL, GITHUB_USER_URL, Harness, ID } from '../testing/users-http-harness';

/** Seam 1 (HTTP) do login com GitHub (DMTE-551, T8): mesmo fluxo do Google, com o GitHub simulado em memória. */
const BASE = 'https://aponta.test';

describe('Login com GitHub (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const get = (url: string, cookie?: string) => {
    const req = request(h.app.getHttpServer()).get(url).set('X-Forwarded-For', '203.0.113.6');
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const exchange = (code: unknown) => request(h.app.getHttpServer()).post('/auth/social/exchange').set('X-Forwarded-For', '203.0.113.6').send({ code });
  const fragment = (location: string) => new URLSearchParams(new URL(location).hash.slice(1));
  const start = async () => {
    const res = await get('/auth/social/github/start');
    const url = new URL(res.headers.location);
    h.oauth.authorize = {
      codeChallenge: url.searchParams.get('code_challenge') ?? '',
      nonce: url.searchParams.get('nonce') ?? '',
      redirectUri: url.searchParams.get('redirect_uri') ?? '',
    };
    return { res, url, state: url.searchParams.get('state') ?? '', cookie: String(res.headers['set-cookie']?.[0] ?? '').split(';')[0] };
  };
  const signIn = async () => {
    const s = await start();
    return get(`/auth/social/github/callback?code=code-ok&state=${encodeURIComponent(s.state)}`, s.cookie);
  };
  const linked = () => h.prisma.tables.externalIdentity;
  const failure = (res: { headers: Record<string, any> }) => fragment(res.headers.location).get('social_error');
  const claim = (token: string, name: string) => (h.app.get(JwtService).decode(token) as Record<string, unknown>)[name];

  it('AC-22: o GitHub é oferecido só com a flag ligada e as variáveis configuradas, e as flags dos provedores são independentes', async () => {
    expect((await get('/auth/social/providers')).body).toEqual({ providers: ['google', 'github'] });

    h.setSocialFlag('github', false);
    expect((await get('/auth/social/providers')).body).toEqual({ providers: ['google'] });
    expect((await get('/auth/social/github/start')).status).toBe(404);

    h.setSocialFlag('github', true);
    h.setSocialFlag('google', false);
    expect((await get('/auth/social/providers')).body).toEqual({ providers: ['github'] });
    expect((await get('/auth/social/github/start')).status).toBe(302);

    await h.close();
    h = await buildHarness({ githubConfigured: false });
    expect((await get('/auth/social/providers')).body).toEqual({ providers: ['google'] });
    expect((await get('/auth/social/github/start')).status).toBe(404);
  });

  it('AC-17: o início leva ao GitHub com escopo de e-mail, state, PKCE S256 e o redirect da API, sem nonce nem segredo', async () => {
    const { res, url } = await start();

    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('github-client-id-test');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/social/github/callback`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.has('nonce')).toBe(false);
    expect(res.headers.location).not.toContain(GITHUB_CLIENT_SECRET);
    expect(String(res.headers['set-cookie']?.[0])).toMatch(/HttpOnly/i);
  });

  it('AC-17: e-mail principal e verificado de conta existente entra: liga o id do GitHub e devolve o código de troca', async () => {
    const res = await signIn();

    expect(res.headers.location.startsWith(`${BASE}/login#social=`)).toBe(true);
    expect(res.headers.location).not.toMatch(/access_token|eyJ/i);
    expect(linked()).toEqual([expect.objectContaining({ provider: 'github', subject: '4242', userId: ID.ana })]);
    const done = await exchange(fragment(res.headers.location).get('social'));
    expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
  });

  it('AC-17: o token de acesso vai no cabeçalho Authorization dos pedidos ao GitHub, com User-Agent', async () => {
    await signIn();

    const api = h.oauth.requests.filter((r) => [GITHUB_USER_URL, GITHUB_EMAILS_URL].includes(r.url));
    expect(api).toHaveLength(2);
    for (const r of api) {
      expect(r.headers['authorization']).toBe('Bearer gh-token');
      expect(r.headers['user-agent']).toBeTruthy();
    }
  });

  it.each([
    ['e-mail principal não verificado', [{ email: 'ana@aponta.test', primary: true, verified: false }]],
    ['nenhum e-mail', []],
    ['só e-mail verificado que não é o principal', [{ email: 'ana@aponta.test', primary: false, verified: true }, { email: 'outro@exemplo.test', primary: false, verified: false }]],
  ])('AC-18: %s volta com "unverified" e nada é ligado', async (_label, emails) => {
    h.oauth.github.emails = emails;

    expect(failure(await signIn())).toBe('unverified');
    expect(linked()).toHaveLength(0);
  });

  it('AC-18: nunca cria usuário, e inativo ou convite pendente não entram', async () => {
    const before = h.prisma.tables.user.length;
    h.oauth.github.emails = [{ email: 'desconhecida@exemplo.test', primary: true, verified: true }];
    expect(failure(await signIn())).toBe('not_found');
    expect(h.prisma.tables.user).toHaveLength(before);

    h.oauth.github.emails = [{ email: 'diego@aponta.test', primary: true, verified: true }];
    expect(failure(await signIn())).toBe('inactive');
    h.oauth.github.emails = [{ email: 'elisa@aponta.test', primary: true, verified: true }];
    expect(failure(await signIn())).toBe('not_found');
    expect(linked()).toHaveLength(0);
  });

  it('AC-19: código recusado (o GitHub responde 200 com error), falha da API de e-mails e perfil sem id voltam com "failed"', async () => {
    h.oauth.github.tokenError = true;
    expect(failure(await signIn())).toBe('failed');

    h.oauth.github.tokenError = false;
    h.oauth.github.emailsStatus = 403;
    expect(failure(await signIn())).toBe('failed');

    h.oauth.github.emailsStatus = 200;
    h.oauth.github.user = { login: 'sem-id' };
    expect(failure(await signIn())).toBe('failed');
    expect(linked()).toHaveLength(0);
  });

  it('AC-19: o state do GitHub não serve no retorno do Google, e vice-versa', async () => {
    const s = await start();

    const res = await get(`/auth/social/google/callback?code=code-ok&state=${encodeURIComponent(s.state)}`, s.cookie);

    expect(failure(res)).toBe('failed');
  });

  it('AC-20: depois de ligada, a entrada é pelo id do GitHub, mesmo com outro e-mail', async () => {
    await signIn();
    h.oauth.github.emails = [{ email: 'bruno@aponta.test', primary: true, verified: true }];

    const done = await exchange(fragment((await signIn()).headers.location).get('social'));

    expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
    expect(linked()).toHaveLength(1);
  });

  it('AC-20: o mesmo número de id em provedores diferentes são identidades diferentes', async () => {
    h.oauth.claims = { sub: '4242', email: 'bruno@aponta.test' };
    const google = await (async () => {
      const res = await get('/auth/social/google/start');
      const url = new URL(res.headers.location);
      h.oauth.authorize = { codeChallenge: url.searchParams.get('code_challenge')!, nonce: url.searchParams.get('nonce')!, redirectUri: url.searchParams.get('redirect_uri')! };
      return get(`/auth/social/google/callback?code=code-ok&state=${encodeURIComponent(url.searchParams.get('state')!)}`, String(res.headers['set-cookie']?.[0]).split(';')[0]);
    })();
    await signIn(); // github 4242 -> ana

    expect(google.headers.location).toContain('#social=');
    expect(linked().map((r) => `${r.provider}:${r.subject}:${r.userId}`).sort()).toEqual([`github:4242:${ID.ana}`, `google:4242:${ID.bruno}`]);
  });

  it('AC-23: o segredo do GitHub não aparece em resposta nem em log', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m));
    const s = await start();
    const res = await get(`/auth/social/github/callback?code=code-ok&state=${encodeURIComponent(s.state)}`, s.cookie);
    h.oauth.github.tokenError = true;
    const failed = await signIn();

    expect(JSON.stringify([s.res.headers, res.headers, failed.headers, spies.flatMap((spy) => spy.mock.calls)])).not.toContain(GITHUB_CLIENT_SECRET);
  });
});
