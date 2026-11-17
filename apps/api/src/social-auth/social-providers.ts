export type OAuthFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export interface SocialProfile {
  subject: string;
  email?: string;
  emailVerified: boolean;
}

export interface ProfileContext {
  clientId: string;
  nonce: string;
  nowMs: number;
  http: OAuthFetch;
}

export interface SocialProvider {
  id: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Provedor OpenID Connect: o pedido leva `nonce` e o perfil vem no `id_token`. */
  oidc: boolean;
  /** O provedor aceita PKCE (S256); o Facebook não o documenta, então não recebe code_challenge nem code_verifier. */
  pkce: boolean;
  /** Lê o perfil na resposta do endpoint de token; `null` se ela não for confiável. */
  profile(tokens: Record<string, unknown>, context: ProfileContext): Promise<SocialProfile | null> | SocialProfile | null;
}

const asString = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/**
 * O id_token vem direto do endpoint de token do Google, por TLS, na troca do código: o OIDC Core (3.1.3.7)
 * dispensa conferir a assinatura nesse caso. Confere emissor, audiência, validade e nonce.
 */
function googleProfile(tokens: Record<string, unknown>, { clientId, nonce, nowMs }: ProfileContext): SocialProfile | null {
  const parts = asString(tokens['id_token'])?.split('.') ?? [];
  if (parts.length !== 3) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const audience = Array.isArray(claims['aud']) ? claims['aud'] : [claims['aud']];
  const valid =
    ['https://accounts.google.com', 'accounts.google.com'].includes(String(claims['iss'])) &&
    audience.includes(clientId) &&
    typeof claims['exp'] === 'number' && claims['exp'] * 1000 > nowMs &&
    claims['nonce'] === nonce;
  const subject = asString(claims['sub']);
  if (!valid || !subject) return null;
  return { subject, email: asString(claims['email']), emailVerified: claims['email_verified'] === true || claims['email_verified'] === 'true' };
}

const GITHUB_API = 'https://api.github.com';

/** O GitHub não tem id_token: o perfil vem da API, com o token de acesso; vale só o e-mail principal e verificado. */
async function githubProfile(tokens: Record<string, unknown>, { http }: ProfileContext): Promise<SocialProfile | null> {
  // Com o código recusado o GitHub responde 200 com `error` e sem `access_token`.
  const accessToken = asString(tokens['access_token']);
  if (!accessToken) return null;
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'Aponta' };
  const [user, emails] = await Promise.all([http(`${GITHUB_API}/user`, { headers }), http(`${GITHUB_API}/user/emails`, { headers })]);
  if (!user.ok || !emails.ok) return null;
  const id = (await user.json())?.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const list = await emails.json();
  const primary = Array.isArray(list) ? list.find((entry) => entry?.primary === true) : undefined;
  return { subject: String(id), email: asString(primary?.email), emailVerified: primary?.verified === true };
}

const FACEBOOK_GRAPH = 'https://graph.facebook.com/v24.0';

/**
 * O Graph só devolve `email` quando o usuário tem um e-mail válido e confirmado; sem ele (ou sem id) o login falha.
 * shortcut: o Facebook não traz um campo "verificado" como Google e GitHub, então a presença do e-mail vale como confirmação; revisar se a Meta mudar isso.
 */
async function facebookProfile(tokens: Record<string, unknown>, { http }: ProfileContext): Promise<SocialProfile | null> {
  const accessToken = asString(tokens['access_token']);
  if (!accessToken) return null;
  const response = await http(`${FACEBOOK_GRAPH}/me?fields=id,email`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const me = await response.json();
  const id = me?.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const email = asString(me?.email);
  return { subject: String(id), email, emailVerified: !!email };
}

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  {
    id: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email',
    oidc: true,
    pkce: true,
    profile: googleProfile,
  },
  {
    id: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    oidc: false,
    pkce: true,
    profile: githubProfile,
  },
  {
    id: 'facebook',
    authorizeUrl: 'https://www.facebook.com/v24.0/dialog/oauth',
    tokenUrl: `${FACEBOOK_GRAPH}/oauth/access_token`,
    scope: 'email',
    oidc: false,
    pkce: false,
    profile: facebookProfile,
  },
];
