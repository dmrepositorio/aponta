import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

/**
 * Builds a syntactically valid (but unsigned) JWT string for testing the
 * client-side decodeJwtPayload() helper. Signature verification happens
 * server-side; the store only trusts tokens it already received from the
 * API or its own persisted storage, so a fake signature segment is fine.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it('starts logged out with no token and no user', () => {
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('login() decodes a valid token into token + user state', () => {
    const token = makeJwt({ sub: 'u1', email: 'agent@aponta.com', role: 'AGENT', organizationId: 'org-1' });

    useAuthStore.getState().login(token);

    const { token: storedToken, user } = useAuthStore.getState();
    expect(storedToken).toBe(token);
    expect(user).toEqual({ sub: 'u1', email: 'agent@aponta.com', role: 'AGENT', organizationId: 'org-1' });
  });

  it('defaults organizationId to null when the claim is absent from the token', () => {
    const token = makeJwt({ sub: 'u2', email: 'client@aponta.com', role: 'CLIENT' });

    useAuthStore.getState().login(token);

    expect(useAuthStore.getState().user).toEqual({
      sub: 'u2',
      email: 'client@aponta.com',
      role: 'CLIENT',
      organizationId: null,
    });
  });

  it('sets user to null when a required claim (role) is missing from the payload', () => {
    const token = makeJwt({ sub: 'u3', email: 'broken@aponta.com' });

    useAuthStore.getState().login(token);

    expect(useAuthStore.getState().token).toBe(token);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('sets user to null when the token has no payload segment at all', () => {
    useAuthStore.getState().login('not-a-real-jwt');

    expect(useAuthStore.getState().user).toBeNull();
  });

  it('sets user to null when the payload segment is not valid base64/JSON', () => {
    useAuthStore.getState().login('header.%%%not-base64%%%.sig');

    expect(useAuthStore.getState().user).toBeNull();
  });

  it('login() keeps the optional display name claim and ignores a blank or non-string one', () => {
    useAuthStore.getState().login(makeJwt({ sub: 'u1', email: 'a@aponta.com', role: 'AGENT', name: 'Ana Souza' }));
    expect(useAuthStore.getState().user?.name).toBe('Ana Souza');

    useAuthStore.getState().login(makeJwt({ sub: 'u1', email: 'a@aponta.com', role: 'AGENT', name: '   ' }));
    expect(useAuthStore.getState().user?.name).toBeUndefined();

    useAuthStore.getState().login(makeJwt({ sub: 'u1', email: 'a@aponta.com', role: 'AGENT', name: 42 }));
    expect(useAuthStore.getState().user?.name).toBeUndefined();
  });

  it('logout() clears both token and user', () => {
    const token = makeJwt({ sub: 'u1', email: 'agent@aponta.com', role: 'AGENT' });
    useAuthStore.getState().login(token);
    expect(useAuthStore.getState().token).not.toBeNull();

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('decodes base64url-encoded payloads (- and _ chars) correctly', () => {
    // Pick a payload whose base64 JSON encoding is long enough to plausibly
    // contain url-unsafe chars; decodeJwtPayload swaps -/_ back to +//
    // before atob() regardless, so this just exercises that branch.
    const token = makeJwt({
      sub: 'u-long-id_with-url-unsafe-chars_1234567890',
      email: 'agent@aponta.com',
      role: 'AGENT_MASTER',
    });

    useAuthStore.getState().login(token);

    expect(useAuthStore.getState().user).toEqual({
      sub: 'u-long-id_with-url-unsafe-chars_1234567890',
      email: 'agent@aponta.com',
      role: 'AGENT_MASTER',
      organizationId: null,
    });
  });

  it('GH-448: logout() apaga os rascunhos de comentário do sessionStorage (e só eles)', () => {
    window.sessionStorage.setItem('aponta:comment-draft:u1:t-1', 'rascunho');
    window.sessionStorage.setItem('aponta:comment-draft:u1:t-2', 'outro');
    window.sessionStorage.setItem('outra-chave', 'fica');

    useAuthStore.getState().logout();

    expect(window.sessionStorage.getItem('aponta:comment-draft:u1:t-1')).toBeNull();
    expect(window.sessionStorage.getItem('aponta:comment-draft:u1:t-2')).toBeNull();
    expect(window.sessionStorage.getItem('outra-chave')).toBe('fica');
    window.sessionStorage.removeItem('outra-chave');
  });
});
