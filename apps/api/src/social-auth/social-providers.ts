export interface SocialProfile {
  subject: string;
  email?: string;
  emailVerified: boolean;
}

export interface ProfileContext {
  clientId: string;
  nonce: string;
  nowMs: number;
}

export interface SocialProvider {
  id: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Provedor OpenID Connect: o pedido leva `nonce` e o perfil vem no `id_token`. */
  oidc: boolean;
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

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  {
    id: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email',
    oidc: true,
    profile: googleProfile,
  },
];
