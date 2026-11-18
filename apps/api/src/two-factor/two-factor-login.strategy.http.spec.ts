import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { ApiTokenStrategy } from '../auth/api-token.strategy';
import { JwtOrTokenAuthGuard } from '../auth/guards/jwt-or-token-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { createFakePrisma, FakePrisma } from '../testing/fake-prisma';
import { ID, seedTables } from '../testing/users-http-harness';
import { UsersService } from '../users/users.service';
import { totpAt } from './totp';
import { TwoFactorService } from './two-factor.service';

/** Seam 1 (HTTP) com as estratégias reais: o desafio não abre rota nenhuma e o token de API não passa pelo segundo fator (DMTE-551, T5). */
@Controller('probe')
class ProbeController {
  @UseGuards(JwtOrTokenAuthGuard)
  @Get()
  get() {
    return { ok: true };
  }
}

describe('Desafio e token de API com as estratégias reais (DMTE-551)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;
  let twoFactor: TwoFactorService;

  beforeEach(async () => {
    prisma = createFakePrisma(seedTables());
    const apiToken = 'apta_0123456789abcdef0123456789abcdef';
    const prefix = apiToken.slice(0, 12);
    const apiTokenRow = { id: 't1', prefix, tokenHash: bcrypt.hashSync(apiToken, 4), userId: ID.ana };
    prisma.apiToken = { findFirst: jest.fn(async () => apiTokenRow), update: jest.fn(async () => apiTokenRow) };
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'test-secret' })],
      controllers: [ProbeController],
      providers: [
        JwtStrategy, ApiTokenStrategy, UsersService, TwoFactorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => ({ JWT_SECRET: 'test-secret', TWO_FACTOR_ENCRYPTION_KEY: 'chave-de-teste' } as Record<string, string>)[key] } },
        { provide: FeatureFlagsService, useValue: { isEnabled: () => true } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    twoFactor = moduleRef.get(TwoFactorService);
  });
  afterEach(async () => { await app.close(); });

  const probe = (token: string) => request(app.getHttpServer()).get('/probe').set('Authorization', `Bearer ${token}`);

  it('AC-10: o token de desafio não abre nenhuma rota autenticada', async () => {
    const { secret } = await twoFactor.begin(ID.ana);
    await twoFactor.confirm(ID.ana, totpAt(secret, Date.now()));
    const challenge = await twoFactor.challengeFor({ id: ID.ana, passwordVersion: 0 });

    expect(challenge?.challengeToken).toEqual(expect.any(String));
    expect((await probe(challenge!.challengeToken)).status).toBe(401);
  });

  it('AC-15: o token de API de quem tem segundo fator continua autenticando, sem desafio', async () => {
    const { secret } = await twoFactor.begin(ID.ana);
    await twoFactor.confirm(ID.ana, totpAt(secret, Date.now()));

    expect((await probe('apta_0123456789abcdef0123456789abcdef')).status).toBe(200);
  });
});
