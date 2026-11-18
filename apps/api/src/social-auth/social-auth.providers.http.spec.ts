import request from 'supertest';
import { buildHarness, Harness } from '../testing/users-http-harness';

/**
 * Seam 1 (HTTP) da lista de provedores de login social (DMTE-551, rodada 2): o Facebook saiu desta entrega porque o Graph
 * não informa se o e-mail foi confirmado. Com a flag ligada e as variáveis configuradas, ele continua fora.
 */
describe('Provedores de login social (DMTE-551)', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); jest.restoreAllMocks(); });

  const get = (url: string) => request(h.app.getHttpServer()).get(url).set('X-Forwarded-For', '203.0.113.7');

  it('AC-22: só Google e GitHub são oferecidos; o Facebook, mesmo com flag e variáveis, não é oferecido e a rota recusa', async () => {
    h.setSocialFlag('facebook', true);

    expect((await get('/auth/social/providers')).body).toEqual({ providers: ['google', 'github'] });
    expect((await get('/auth/social/facebook/start')).status).toBe(404);
    expect((await get('/auth/social/facebook/callback?code=x&state=y')).status).toBe(404);
  });
});
