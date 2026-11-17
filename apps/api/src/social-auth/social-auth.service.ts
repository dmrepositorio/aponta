import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptText, encryptText } from '../common/secret-box';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { OAuthFetch, SOCIAL_PROVIDERS, SocialProvider } from './social-providers';

export const OAUTH_FETCH = 'OAUTH_FETCH';
export type { OAuthFetch };

export interface StartResult {
  location: string;
  cookie: { name: string; value: string; maxAgeSeconds: number; secure: boolean };
}

export const OAUTH_COOKIE = 'aponta_oauth';
const STATE_TTL_MS = 10 * 60_000;
const EXCHANGE_TTL_MS = 60_000;
const MAX_PARAM = 2048;

interface SealedState {
  /** provedor */ p: string;
  /** nonce */ n: string;
  /** verificador do PKCE */ v: string;
  /** vínculo com o navegador (cookie) */ cb: string;
  /** identificador de uso único */ j: string;
  exp: number;
}

class SocialFailure extends Error {
  constructor(readonly reason: 'failed' | 'not_found' | 'inactive' | 'unverified') {
    super(reason);
  }
}

/** Login social (DMTE-551): OAuth 2.0 com código de autorização, só em conta que já existe e está ativa. */
@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  // shortcut: estado usado e códigos de troca ficam em memória, por processo (como os contadores de tentativa); com mais de uma instância, mover para Redis.
  private readonly usedStates = new Map<string, number>();
  private readonly exchangeCodes = new Map<string, { userId: string; exp: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
    private readonly users: UsersService,
    @Inject(OAUTH_FETCH) private readonly http: OAuthFetch,
  ) {}

  /** Provedores que o botão do login pode oferecer: flag ligada e variáveis configuradas. */
  providers(): string[] {
    return SOCIAL_PROVIDERS.filter((provider) => this.enabled(provider)).map((provider) => provider.id);
  }

  start(providerId: string): StartResult {
    const provider = this.provider(providerId);
    const cb = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(16).toString('hex');
    const sealed: SealedState = { p: provider.id, n: nonce, v: verifier, cb, j: randomBytes(16).toString('hex'), exp: Date.now() + STATE_TTL_MS };
    const query = new URLSearchParams({
      client_id: this.credentials(provider).clientId,
      response_type: 'code',
      scope: provider.scope,
      redirect_uri: this.redirectUri(provider),
      state: encryptText(JSON.stringify(sealed), this.stateKey()),
    });
    if (provider.pkce) {
      query.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      query.set('code_challenge_method', 'S256');
    }
    if (provider.oidc) query.set('nonce', nonce);
    return {
      location: `${provider.authorizeUrl}?${query.toString()}`,
      cookie: { name: OAUTH_COOKIE, value: cb, maxAgeSeconds: STATE_TTL_MS / 1000, secure: this.base().startsWith('https://') },
    };
  }

  /** Processa o retorno do provedor e devolve para onde mandar o navegador (nunca com o JWT na URL). */
  async callback(providerId: string, query: { code?: unknown; state?: unknown; error?: unknown }, cookie: string | undefined): Promise<string> {
    const provider = this.provider(providerId);
    try {
      const userId = await this.resolveUser(provider, query, cookie);
      const code = randomBytes(32).toString('hex');
      this.sweep();
      this.exchangeCodes.set(code, { userId, exp: Date.now() + EXCHANGE_TTL_MS });
      return `${this.base()}/login#social=${code}`;
    } catch (error) {
      const reason = error instanceof SocialFailure ? error.reason : 'failed';
      if (!(error instanceof SocialFailure)) this.logger.warn(`Falha no login social (${provider.id}).`);
      return `${this.base()}/login#social_error=${reason}`;
    }
  }

  /** Troca o código de uso único pelo id do usuário que entrou. */
  async exchange(code: string): Promise<string> {
    this.sweep();
    const entry = this.exchangeCodes.get(code);
    this.exchangeCodes.delete(code);
    if (!entry) throw new UnauthorizedException('Código inválido.');
    return entry.userId;
  }

  private async resolveUser(provider: SocialProvider, query: { code?: unknown; state?: unknown; error?: unknown }, cookie: string | undefined): Promise<string> {
    const { code, state } = query;
    if (query.error !== undefined || typeof code !== 'string' || typeof state !== 'string' || code.length > MAX_PARAM || state.length > MAX_PARAM) {
      throw new SocialFailure('failed');
    }
    const sealed = this.openState(state, provider, cookie);
    const { clientId, clientSecret } = this.credentials(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(provider),
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (provider.pkce) body.set('code_verifier', sealed.v);
    const response = await this.http(provider.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() });
    if (!response.ok) throw new SocialFailure('failed');
    const profile = await provider.profile(await response.json(), { clientId, nonce: sealed.n, nowMs: Date.now(), http: this.http });
    if (!profile) throw new SocialFailure('failed');

    // Depois da primeira vez a entrada é pelo identificador do provedor, nunca pelo e-mail.
    const identity = await this.prisma.externalIdentity.findFirst({ where: { provider: provider.id, subject: profile.subject } });
    const user = identity ? await this.users.findById(identity.userId) : await this.userByVerifiedEmail(profile);
    if (!user || !user.password) throw new SocialFailure('not_found');
    if (!user.active) throw new SocialFailure('inactive');
    if (!identity) await this.prisma.externalIdentity.create({ data: { userId: user.id, provider: provider.id, subject: profile.subject } });
    return user.id;
  }

  private async userByVerifiedEmail(profile: { email?: string; emailVerified: boolean }) {
    if (!profile.email || !profile.emailVerified) throw new SocialFailure('unverified');
    return this.users.findByEmail(profile.email);
  }

  /** O state é cifrado e autenticado; vale uma vez, por 10 minutos, só no navegador que iniciou o fluxo (cookie). */
  private openState(state: string, provider: SocialProvider, cookie: string | undefined): SealedState {
    let sealed: SealedState;
    try {
      sealed = JSON.parse(decryptText(state, this.stateKey()));
    } catch {
      throw new SocialFailure('failed');
    }
    this.sweep();
    if (sealed.p !== provider.id || sealed.exp <= Date.now() || !cookie || sealed.cb !== cookie || this.usedStates.has(sealed.j)) {
      throw new SocialFailure('failed');
    }
    this.usedStates.set(sealed.j, sealed.exp);
    return sealed;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, exp] of this.usedStates) if (exp <= now) this.usedStates.delete(key);
    for (const [key, entry] of this.exchangeCodes) if (entry.exp <= now) this.exchangeCodes.delete(key);
  }

  private provider(id: string): SocialProvider {
    const provider = SOCIAL_PROVIDERS.find((candidate) => candidate.id === id);
    if (!provider || !this.enabled(provider)) throw new NotFoundException();
    return provider;
  }

  private enabled(provider: SocialProvider): boolean {
    const { clientId, clientSecret } = this.credentials(provider);
    return this.flags.isEnabled(`login-social-${provider.id}`) && !!clientId && !!clientSecret;
  }

  private credentials(provider: SocialProvider): { clientId: string; clientSecret: string } {
    const name = provider.id.toUpperCase();
    return {
      clientId: this.config.get<string>(`OAUTH_${name}_CLIENT_ID`) ?? '',
      clientSecret: this.config.get<string>(`OAUTH_${name}_CLIENT_SECRET`) ?? '',
    };
  }

  private base(): string {
    return (this.config.get<string>('PUBLIC_APP_URL') ?? '').replace(/\/+$/, '');
  }

  private redirectUri(provider: SocialProvider): string {
    return `${this.base()}/api/auth/social/${provider.id}/callback`;
  }

  private stateKey(): Buffer {
    return createHash('sha256').update(`${this.config.get<string>('JWT_SECRET') ?? ''}:oauth-state`).digest();
  }
}
