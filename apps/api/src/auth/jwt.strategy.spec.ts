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

/** Seam 1 (HTTP) com a JwtStrategy real: o token continua válido, mas o usuário inativado perde o acesso na requisição seguinte. */
describe('AC-12: JwtStrategy recusa usuário inativo (DMTE-550)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;
  let token: string;

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
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = moduleRef.get(JwtService).sign({ sub: ID.ana, email: 'ana@aponta.test', role: 'AGENT' });
  });
  afterEach(async () => { await app.close(); });

  const me = () => request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);

  it('AC-12: usuário ativo com token válido entra', async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID.ana);
  });

  it('AC-12: inativado depois de receber o token, a requisição seguinte responde 401 com o mesmo token', async () => {
    expect((await me()).status).toBe(200);
    prisma.tables.user.find((u) => u.id === ID.ana)!.active = false;

    expect((await me()).status).toBe(401);
  });

  it('AC-12: reativado, o mesmo token volta a valer', async () => {
    const row = prisma.tables.user.find((u) => u.id === ID.ana)!;
    row.active = false;
    expect((await me()).status).toBe(401);
    row.active = true;

    expect((await me()).status).toBe(200);
  });
});
