import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LocalStrategy } from '../auth/local.strategy';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { MailService } from '../mail/mail.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordFlowService } from '../users/password-flow.service';
import { PasswordTokensService } from '../users/password-tokens.service';
import { SocialAuthController } from '../social-auth/social-auth.controller';
import { OAUTH_FETCH, OAuthFetch, SocialAuthService } from '../social-auth/social-auth.service';
import { TwoFactorController } from '../two-factor/two-factor.controller';
import { TWO_FACTOR_FLAG, TwoFactorService } from '../two-factor/two-factor.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { createFakePrisma, FakePrisma, Tables } from './fake-prisma';

export const FLAG_KEY = 'convite-e-redefinicao-usuario';
export const OLD_PASSWORD = 'Senha#Antiga1';
export const NEW_PASSWORD = 'NovaSenha#2026';
const OLD_HASH = bcrypt.hashSync(OLD_PASSWORD, 4);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ID = {
  admin: uuid(1), gestor: uuid(2), ana: uuid(3), bruno: uuid(4), carla: uuid(5), diego: uuid(6),
  elisa: uuid(7), fabio: uuid(8), gabi: uuid(9),
  pgA: uuid(101), pgB: uuid(102), tgUm: uuid(201), tgDois: uuid(202), org: uuid(301),
  missing: uuid(999),
};

const user = (id: string, name: string, email: string, extra: Record<string, any> = {}) => ({
  id, name, email, password: OLD_HASH, passwordVersion: 0, role: 'AGENT', active: true, phone: null, extension: null,
  organizationId: null, technicalGroupId: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...extra,
});

/** Usuários sintéticos. Pendente = senha nula; Diego e Gabi estão inativos. */
export function seedTables(): Partial<Tables> {
  return {
    user: [
      user(ID.admin, 'Admin Aponta', 'admin@aponta.test', { role: 'ADMIN' }),
      user(ID.gestor, 'Gestor Aponta', 'gestor@aponta.test', { role: 'AGENT_MASTER' }),
      user(ID.ana, 'Ana Souza', 'ana@aponta.test', { technicalGroupId: ID.tgUm }),
      user(ID.bruno, 'Bruno Lima', 'bruno@aponta.test'),
      user(ID.carla, 'Carla Nunes', 'carla@cliente.test', { role: 'CLIENT', organizationId: ID.org }),
      user(ID.diego, 'Diego Alves', 'diego@aponta.test', { active: false }),
      user(ID.elisa, 'Elisa Prado', 'elisa@aponta.test', { password: null }),
      user(ID.fabio, 'Fábio Reis', 'fabio@aponta.test', { role: 'ADMIN' }),
      user(ID.gabi, 'Gabi Rocha', 'gabi@cliente.test', { role: 'CLIENT', active: false, password: null }),
    ],
    permissionGroup: [
      { id: ID.pgA, name: 'Grupo A', permissions: [] },
      { id: ID.pgB, name: 'Grupo B', permissions: [] },
    ],
    permissionGroupUser: [
      { permissionGroupId: ID.pgA, userId: ID.ana, createdAt: new Date() },
      { permissionGroupId: ID.pgA, userId: ID.bruno, createdAt: new Date() },
    ],
    technicalGroup: [{ id: ID.tgUm, name: 'Time 1' }, { id: ID.tgDois, name: 'Time 2' }],
    organization: [{ id: ID.org, name: 'Cliente 1' }],
  };
}

export const GOOGLE_CLIENT_ID = 'google-client-id-test';
export const GOOGLE_CLIENT_SECRET = 'google-secret-test';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FACEBOOK_CLIENT_ID = 'facebook-client-id-test';
export const FACEBOOK_CLIENT_SECRET = 'facebook-secret-test';
export const GITHUB_CLIENT_ID = 'github-client-id-test';
export const GITHUB_CLIENT_SECRET = 'github-secret-test';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

/** Provedor OAuth simulado em memória: o teste diz o que foi pedido (`authorize`) e o que o provedor devolve (`claims`). */
export interface FakeOAuth {
  /** Preenchido pelo teste a partir da URL de autorização que o servidor montou. */
  authorize?: { codeChallenge: string; nonce: string; redirectUri: string };
  /** Sobrescreve campos do id_token (sub, email, email_verified, aud, iss, exp, nonce). */
  claims: Record<string, unknown>;
  tokenStatus: number;
  requests: { url: string; body: URLSearchParams; headers: Record<string, string> }[];
  /** GitHub simulado: perfil, e-mails, e o que o endpoint de e-mails responde. */
  github: { user: Record<string, unknown>; emails: unknown; emailsStatus: number; tokenError: boolean };
}

const unsigned = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.assinatura`;

export interface Harness {
  oauth: FakeOAuth;
  /** Liga ou desliga a flag login-social-<provedor> (começa ligada). */
  setSocialFlag(provider: string, on: boolean): void;
  app: INestApplication;
  prisma: FakePrisma;
  mail: { sendEmail: jest.Mock };
  tokens: PasswordTokensService;
  /** Liga ou desliga a flag convite-e-redefinicao-usuario (começa ligada). */
  setFlag(on: boolean): void;
  /** Liga ou desliga a flag autenticacao-dois-fatores (começa ligada). */
  setTwoFactorFlag(on: boolean): void;
  grant(userId: string, ...keys: string[]): void;
  /** Requisição autenticada como `userId` (cabeçalho lido pelo guard de teste). */
  as(method: 'get' | 'post' | 'patch', url: string, userId?: string): request.Test;
  row(userId: string): Record<string, any>;
  /** Tokens ainda utilizáveis (não usados e não expirados) agora. */
  validTokens(userId?: string): Record<string, any>[];
  /** Último token cru enviado por e-mail, lido do link `/definir-senha#t=`. */
  sentToken(call?: number): string | undefined;
  close(): Promise<void>;
}

export async function buildHarness(options: { flag?: boolean; limit?: number; twoFactorKey?: string | null; googleConfigured?: boolean; githubConfigured?: boolean } = {}): Promise<Harness> {
  const prisma = createFakePrisma(seedTables());
  const state = { flag: options.flag ?? true, twoFactor: true, social: { google: true, github: true, facebook: true } as Record<string, boolean> };
  const oauth: FakeOAuth = {
    claims: {}, tokenStatus: 200, requests: [],
    github: { user: { id: 4242, login: 'ana' }, emails: [{ email: 'ana@aponta.test', primary: true, verified: true }], emailsStatus: 200, tokenError: false },
  };
  const fakeFetch: OAuthFetch = async (url, init) => {
    const body = new URLSearchParams(init?.body ?? '');
    oauth.requests.push({ url, body, headers: init?.headers ?? {} });
    const refuse = (status: number) => ({ ok: false, status, json: async () => ({}) });
    const reply = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    const sent = oauth.authorize;
    const challenge = createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url');
    const pkceAndRedirectOk = !!sent && body.get('code') === 'code-ok' && body.get('redirect_uri') === sent.redirectUri && challenge === sent.codeChallenge;
    if (url === GOOGLE_TOKEN_URL) {
      if (oauth.tokenStatus !== 200) return refuse(oauth.tokenStatus);
      if (!pkceAndRedirectOk || body.get('client_secret') !== GOOGLE_CLIENT_SECRET || body.get('client_id') !== GOOGLE_CLIENT_ID) return refuse(400);
      const claims = { iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT_ID, sub: 'google-sub-1', email: 'ana@aponta.test', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600, nonce: sent!.nonce, ...oauth.claims };
      return reply({ id_token: unsigned(claims), access_token: 'token-de-acesso' });
    }
    if (url === GITHUB_TOKEN_URL) {
      if (oauth.tokenStatus !== 200) return refuse(oauth.tokenStatus);
      // O GitHub responde 200 com `error` quando o código é recusado.
      if (oauth.github.tokenError || !pkceAndRedirectOk || body.get('client_secret') !== GITHUB_CLIENT_SECRET || body.get('client_id') !== GITHUB_CLIENT_ID) return reply({ error: 'bad_verification_code' });
      return reply({ access_token: 'gh-token', token_type: 'bearer', scope: 'read:user,user:email' });
    }
    if (url === GITHUB_USER_URL || url === GITHUB_EMAILS_URL) {
      if (init?.headers?.['authorization'] !== 'Bearer gh-token' || !init?.headers?.['user-agent']) return refuse(401);
      if (url === GITHUB_EMAILS_URL && oauth.github.emailsStatus !== 200) return refuse(oauth.github.emailsStatus);
      return reply(url === GITHUB_USER_URL ? oauth.github.user : oauth.github.emails);
    }
    throw new Error(`Chamada inesperada ao provedor: ${url}`);
  };
  const twoFactorKey = options.twoFactorKey === undefined ? 'chave-de-teste-do-segundo-fator' : options.twoFactorKey;
  const grants = new Map<string, Set<string>>([[ID.gestor, new Set(['MANAGE_USERS'])]]);
  const mail = { sendEmail: jest.fn().mockResolvedValue(true) };
  const previousUrl = process.env['PUBLIC_APP_URL'];
  process.env['PUBLIC_APP_URL'] = 'https://aponta.test';

  const testJwtGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      const row = prisma.tables.user.find((u) => u.id === req.headers['x-test-user']);
      if (!row) throw new UnauthorizedException();
      req.user = { id: row.id, email: row.email, role: row.role, organizationId: row.organizationId };
      return true;
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule,
      JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1d' } }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: options.limit ?? 1000 }]),
    ],
    controllers: [UsersController, AuthController, TwoFactorController, SocialAuthController],
    providers: [
      AuthService, LocalStrategy, UsersService, PasswordTokensService, PasswordFlowService, TwoFactorService, SocialAuthService,
      { provide: OAUTH_FETCH, useValue: fakeFetch },
      { provide: PrismaService, useValue: prisma },
      { provide: MailService, useValue: mail },
      { provide: FeatureFlagsService, useValue: { isEnabled: jest.fn((key: string) => (key === FLAG_KEY && state.flag) || (key === TWO_FACTOR_FLAG && state.twoFactor) || (key.startsWith('login-social-') && state.social[key.slice('login-social-'.length)] === true)) } },
      {
        provide: PermissionsService,
        useValue: {
          hasPermission: jest.fn(async (id: string, ...keys: string[]) => keys.some((k) => grants.get(id)?.has(k))),
          getEffectivePermissions: jest.fn(async () => new Set<string>()),
        },
      },
      { provide: ConfigService, useValue: { get: (key: string) => ({ PUBLIC_APP_URL: 'https://aponta.test', JWT_SECRET: 'test-secret', ...(twoFactorKey ? { TWO_FACTOR_ENCRYPTION_KEY: twoFactorKey } : {}), ...(options.googleConfigured === false ? {} : { OAUTH_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID, OAUTH_GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET }), ...(options.githubConfigured === false ? {} : { OAUTH_GITHUB_CLIENT_ID: GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET: GITHUB_CLIENT_SECRET }), OAUTH_FACEBOOK_CLIENT_ID: FACEBOOK_CLIENT_ID, OAUTH_FACEBOOK_CLIENT_SECRET: FACEBOOK_CLIENT_SECRET } as Record<string, string>)[key] } },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(testJwtGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();

  const valid = (row: Record<string, any>) => row.usedAt == null && new Date(row.expiresAt).getTime() > Date.now();
  return {
    app, prisma, mail, oauth,
    setSocialFlag: (provider, on) => { state.social[provider] = on; },
    tokens: app.get(PasswordTokensService),
    setFlag: (on) => { state.flag = on; },
    setTwoFactorFlag: (on) => { state.twoFactor = on; },
    grant: (id, ...keys) => { grants.set(id, new Set([...(grants.get(id) ?? []), ...keys])); },
    as: (method, url, userId = ID.admin) => request(app.getHttpServer())[method](url).set('x-test-user', userId),
    row: (id) => prisma.tables.user.find((u) => u.id === id)!,
    validTokens: (id) => prisma.tables.passwordToken.filter((t) => (id ? t.userId === id : true) && valid(t)),
    sentToken: (call = -1) => {
      const sent = mail.sendEmail.mock.calls.at(call)?.[0];
      return /\/definir-senha#t=([0-9a-f]{64})/.exec(`${sent?.text ?? ''} ${sent?.html ?? ''}`)?.[1];
    },
    close: async () => {
      await app.close();
      if (previousUrl === undefined) delete process.env['PUBLIC_APP_URL'];
      else process.env['PUBLIC_APP_URL'] = previousUrl;
    },
  };
}

export const names = (res: { body: any }): string[] => (res.body?.data ?? []).map((u: { name: string }) => u.name);
