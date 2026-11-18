import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { createFakePrisma, FakePrisma } from '../testing/fake-prisma';
import { ID, seedTables } from '../testing/users-http-harness';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

/** Seam 1 (HTTP) com a JwtStrategy real: o token leva a versão da senha e a perde de valor quando a senha muda (DMTE-551, T2). */
describe('Versão da senha no JWT (DMTE-551)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;
  let jwt: JwtService;

  beforeEach(async () => {
    prisma = createFakePrisma(seedTables());
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1d' } })],
      controllers: [AuthController],
      providers: [
        AuthService, JwtStrategy, UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined) } },
        { provide: TwoFactorService, useValue: { challengeFor: jest.fn().mockResolvedValue(null), completeChallenge: jest.fn() } },
        {
          provide: PermissionsService,
          useValue: {
            getEffectivePermissions: jest.fn(async () => new Set<string>()),
            canViewTicketValues: jest.fn(async () => false),
            canEditWorklogStartTime: jest.fn(async () => false),
            canReleaseWorklogWithoutSchedule: jest.fn(async () => false),
            canReleaseWorklogs: jest.fn(async () => false),
            canDeleteTickets: jest.fn(async () => false),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });
  afterEach(async () => { await app.close(); });

  const bearer = (token: string) => request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);
  const tokenFor = (pv?: number) => jwt.sign({ sub: ID.ana, email: 'ana@aponta.test', role: 'AGENT', ...(pv === undefined ? {} : { pv }) });

  it('AC-04: o token com a versão atual da senha entra', async () => {
    expect((await bearer(tokenFor(0))).status).toBe(200);
  });

  it('AC-04: depois que a senha muda, o token de versão antiga é recusado e o de versão nova entra', async () => {
    const old = tokenFor(0);
    expect((await bearer(old)).status).toBe(200); // controle: antes da troca, entra

    prisma.tables.user.find((u) => u.id === ID.ana)!.passwordVersion = 1;

    expect((await bearer(old)).status).toBe(401);
    expect((await bearer(tokenFor(1))).status).toBe(200);
  });

  it('AC-04: token emitido antes desta entrega (sem versão) vale como versão 0, para ninguém ser deslogado no deploy', async () => {
    expect((await bearer(tokenFor())).status).toBe(200);

    prisma.tables.user.find((u) => u.id === ID.ana)!.passwordVersion = 1;
    expect((await bearer(tokenFor())).status).toBe(401);
  });
});
