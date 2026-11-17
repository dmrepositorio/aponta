import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildHarness, FACEBOOK_CLIENT_SECRET, Harness, ID } from '../testing/users-http-harness';

/** Seam 1 (HTTP) do login com Facebook (DMTE-551, T9): mesmo fluxo, com o Facebook simulado e sem PKCE. */
const BASE = 'https://aponta.test';

describe('Login com Facebook (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness({ googleConfigured: false, githubConfigured: false }); });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const get = (url: string, cookie?: string) => {
    const req = request(h.app.getHttpServer()).get(url).set('X-Forwarded-For', '203.0.113.7');
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const exchange = (code: unknown) => request(h.app.getHttpServer()).post('/auth/social/exchange').set('X-Forwarded-For', '203.0.113.7').send({ code });
  const fragment = (location: string) => new URLSearchParams(new URL(location).hash.slice(1));
  const start = async () => {
    const res = await get('/auth/social/facebook/start');
    const url = new URL(res.headers.location);
    h.oauth.authorize = { codeChallenge: '', nonce: '', redirectUri: url.searchParams.get('redirect_uri') ?? '' };
    return { res, url, state: url.searchParams.get('state') ?? '', cookie: String(res.headers['set-cookie']?.[0] ?? '').split(';')[0] };
  };
  const signIn = async () => {
    const s = await start();
    return get(`/auth/social/facebook/callback?code=code-ok&state=${encodeURIComponent(s.state)}`, s.cookie);
  };
  const linked = () => h.prisma.tables.externalIdentity;
  const failure = (res: { headers: Record<string, any> }) => fragment(res.headers.location).get('social_error');
  const claim = (token: string, name: string) => (h.app.get(JwtService).decode(token) as Record<string, unknown>)[name];

  it('AC-22: o Facebook é oferecido só com a flag ligada e as variáveis configuradas, independente dos outros provedores', async () => {
    expect((await get('/auth/social/providers')).body).toEqual({ providers: ['facebook'] });

    h.setSocialFlag('facebook', false);
    expect((await get('/auth/social/providers')).body).toEqual({ providers: [] });
    expect((await get('/auth/social/facebook/start')).status).toBe(404);

    await h.close();
    h = await buildHarness({ googleConfigured: false, githubConfigured: false, facebookConfigured: false });
    expect((await get('/auth/social/providers')).body).toEqual({ providers: [] });
    expect((await get('/auth/social/facebook/start')).status).toBe(404);
  });

  it('AC-17: o início leva ao Facebook com escopo de e-mail, state e o redirect da API; sem PKCE (o Facebook não o documenta) nem nonce', async () => {
    const { res, url } = await start();

    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v24.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('facebook-client-id-test');
    expect(url.searchParams.get('scope')).toBe('email');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/social/facebook/callback`);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('nonce')).toBe(false);
    expect(res.headers.location).not.toContain(FACEBOOK_CLIENT_SECRET);
    expect(String(res.headers['set-cookie']?.[0])).toMatch(/HttpOnly/i);
  });

  it('AC-17: e-mail de conta existente e ativa entra: liga o id do Facebook e devolve o código de troca, sem JWT na URL', async () => {
    const res = await signIn();

    expect(res.headers.location.startsWith(`${BASE}/login#social=`)).toBe(true);
    expect(res.headers.location).not.toMatch(/access_token|eyJ/i);
    expect(linked()).toEqual([expect.objectContaining({ provider: 'facebook', subject: '777', userId: ID.ana })]);
    const done = await exchange(fragment(res.headers.location).get('social'));
    expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
  });

  it.each([
    ['sem e-mail na resposta do Graph', { id: '777' }],
    ['e-mail vazio', { id: '777', email: '' }],
    ['e-mail que não é texto', { id: '777', email: { x: 1 } }],
  ])('AC-18: Facebook %s volta com "unverified", com mensagem clara, e nada é ligado', async (_label, me) => {
    h.oauth.facebook.me = me;

    expect(failure(await signIn())).toBe('unverified');
    expect(linked()).toHaveLength(0);
  });

  it('AC-18: nunca cria usuário, e inativo ou convite pendente não entram', async () => {
    const before = h.prisma.tables.user.length;
    h.oauth.facebook.me = { id: '777', email: 'desconhecida@exemplo.test' };
    expect(failure(await signIn())).toBe('not_found');
    expect(h.prisma.tables.user).toHaveLength(before);

    h.oauth.facebook.me = { id: '777', email: 'diego@aponta.test' };
    expect(failure(await signIn())).toBe('inactive');
    h.oauth.facebook.me = { id: '777', email: 'elisa@aponta.test' };
    expect(failure(await signIn())).toBe('not_found');
    expect(linked()).toHaveLength(0);
  });

  it('AC-19: código recusado, falha do Graph e perfil sem id voltam com "failed"', async () => {
    h.oauth.facebook.tokenError = true;
    expect(failure(await signIn())).toBe('failed');

    h.oauth.facebook.tokenError = false;
    h.oauth.facebook.meStatus = 500;
    expect(failure(await signIn())).toBe('failed');

    h.oauth.facebook.meStatus = 200;
    h.oauth.facebook.me = { email: 'ana@aponta.test' };
    expect(failure(await signIn())).toBe('failed');
    expect(linked()).toHaveLength(0);
  });

  it('AC-20: depois de ligada, a entrada é pelo id do Facebook, mesmo com outro e-mail', async () => {
    await signIn();
    h.oauth.facebook.me = { id: '777', email: 'bruno@aponta.test' };

    const done = await exchange(fragment((await signIn()).headers.location).get('social'));

    expect(claim(done.body.access_token, 'sub')).toBe(ID.ana);
    expect(linked()).toHaveLength(1);
  });

  it('AC-23: o segredo do Facebook não aparece em resposta nem em log', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m));
    const s = await start();
    const res = await get(`/auth/social/facebook/callback?code=code-ok&state=${encodeURIComponent(s.state)}`, s.cookie);
    h.oauth.facebook.tokenError = true;
    const failed = await signIn();

    expect(JSON.stringify([s.res.headers, res.headers, failed.headers, spies.flatMap((spy) => spy.mock.calls)])).not.toContain(FACEBOOK_CLIENT_SECRET);
  });
});
