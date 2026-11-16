import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { Role } from '@prisma/client';
import { JwtStrategy } from '../auth/jwt.strategy';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserScreenPreferencesController } from './user-screen-preferences.controller';
import { UserScreenPreferencesService } from './user-screen-preferences.service';

/**
 * DMTE-527 T2, HTTP real (JWT verdadeiro, ValidationPipe como em main.ts, service real, Prisma falso com estado):
 * prova autenticação, telas aceitas, formato validado e isolamento entre usuários nas rotas, não só nas funções.
 */
describe('Preferências de tela por usuário (HTTP)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const users = [
    { id: 'u-1', email: 'um@dm.test', role: Role.AGENT, organizationId: null },
    { id: 'u-2', email: 'dois@dm.test', role: Role.AGENT, organizationId: null },
  ];
  const rows = new Map<string, any>();
  const keyOf = (k: { userId: string; screen: string }) => `${k.userId}|${k.screen}`;
  const prisma = {
    apiToken: { findFirst: jest.fn().mockResolvedValue(null) },
    userScreenPreference: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(keyOf(where.userId_screen)) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = keyOf(where.userId_screen);
        const row = rows.has(key) ? { ...rows.get(key), ...update } : { ...create };
        rows.set(key, row);
        return row;
      }),
    },
  };
  const usersService = { findById: jest.fn((id: string) => Promise.resolve(users.find((u) => u.id === id) ?? null)) };

  const tokenOf = (id: string) => `Bearer ${jwt.sign({ sub: id, email: `${id}@dm.test` })}`;
  const as = (id: string) => ({ Authorization: tokenOf(id) });
  const http = () => request(app.getHttpServer());

  const valid = {
    grid: { columnVisibility: { protocol: true, title: false }, density: 'compact', columnOrder: ['protocol', 'title'] },
    form: { layout: 'CASCADE' },
    viewMode: 'GRID',
    savedFilters: [{ id: 'f-1', name: 'VIP', criteria: { status: 'ACTIVE' } }],
    groupBy: 'stage',
    collapsed: { RESOLVED: false, CLOSED: true },
  };
  const map = (n: number, value: unknown = true, idLength = 8) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i).padStart(idLength, 'k'), value]));

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(),
        PassportModule,
        JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1d' } }),
      ],
      controllers: [UserScreenPreferencesController],
      providers: [
        JwtStrategy,
        UserScreenPreferencesService,
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
  });

  describe('AC-11: autenticação, telas aceitas e preferência vazia', () => {
    it('AC-11: sem token, GET e PUT respondem 401 e não tocam o banco', async () => {
      expect((await http().get('/me/screen-preferences/tickets-kanban')).status).toBe(401);
      expect((await http().put('/me/screen-preferences/tickets-kanban').send(valid)).status).toBe(401);
      expect(prisma.userScreenPreference.findUnique).not.toHaveBeenCalled();
      expect(prisma.userScreenPreference.upsert).not.toHaveBeenCalled();
    });

    it('AC-11: token inválido responde 401', async () => {
      const res = await http().get('/me/screen-preferences/tickets-kanban').set('Authorization', 'Bearer lixo');
      expect(res.status).toBe(401);
    });

    it('AC-11: GET sem linha devolve 200 com preferência vazia (JSON {})', async () => {
      const res = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-1'));
      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json');
      expect(res.body).toEqual({});
      expect(prisma.userScreenPreference.findUnique).toHaveBeenCalledWith({
        where: { userId_screen: { userId: 'u-1', screen: 'tickets-kanban' } },
      });
    });

    it.each(['organizations', 'contracts', 'service-desks', 'tickets-list', 'tickets-kanban'])(
      'AC-11: a tela %s é aceita no PUT e relida no GET',
      async (screen) => {
        expect((await http().put(`/me/screen-preferences/${screen}`).set(as('u-1')).send({ groupBy: 'x' })).status).toBe(200);
        const res = await http().get(`/me/screen-preferences/${screen}`).set(as('u-1'));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ groupBy: 'x' });
      },
    );

    it.each(['dashboard', 'tickets', 'ORGANIZATIONS', 'users'])('AC-11: a tela %s devolve 404 e não grava', async (screen) => {
      expect((await http().get(`/me/screen-preferences/${screen}`).set(as('u-1'))).status).toBe(404);
      expect((await http().put(`/me/screen-preferences/${screen}`).set(as('u-1')).send(valid)).status).toBe(404);
      expect(prisma.userScreenPreference.upsert).not.toHaveBeenCalled();
      expect(rows.size).toBe(0);
    });
  });

  describe('AC-12: formato validado no servidor', () => {
    it('AC-12: um corpo válido é gravado (200) e relido igual', async () => {
      const put = await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send(valid);
      expect(put.status).toBe(200);
      const get = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-1'));
      expect(get.body).toEqual(valid);
    });

    it('AC-12: o PUT substitui o corpo anterior (vale a última gravação)', async () => {
      await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send(valid);
      await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send({ groupBy: 'status' });
      const get = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-1'));
      expect(get.body).toEqual({ groupBy: 'status' });
    });

    it('AC-12: aceita os limites exatos (collapsed com 100 entradas, ids de 64 caracteres, 200 colunas, 50 filtros)', async () => {
      const body = {
        collapsed: map(100, true, 64),
        grid: { columnVisibility: map(200), columnOrder: Array.from({ length: 200 }, (_, i) => `c${i}`) },
        savedFilters: Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: 'n'.repeat(120), criteria: {} })),
        groupBy: 'g'.repeat(64),
      };
      const res = await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send(body);
      expect(res.status).toBe(200);
      const get = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-1'));
      expect(get.body).toEqual(body);
    });

    const tooLongId = 'i'.repeat(65);
    const bad: Array<[string, unknown]> = [
      ['campo desconhecido na raiz', { foo: 1 }],
      ['campo desconhecido dentro de grid', { grid: { foo: 1 } }],
      ['id de usuário no corpo', { userId: 'u-2', groupBy: 'x' }],
      ['corpo que não é objeto (lista)', []],
      ['groupBy com tipo errado', { groupBy: 5 }],
      ['groupBy com mais de 64 caracteres', { groupBy: 'g'.repeat(65) }],
      ['density fora de compact/comfortable', { grid: { density: 'huge' } }],
      ['columnVisibility com valor que não é booleano', { grid: { columnVisibility: { protocol: 'sim' } } }],
      ['columnVisibility com mais de 200 entradas', { grid: { columnVisibility: map(201) } }],
      ['columnOrder com mais de 200 ids', { grid: { columnOrder: Array.from({ length: 201 }, (_, i) => `c${i}`) } }],
      ['form.layout desconhecido', { form: { layout: 'DIAGONAL' } }],
      ['viewMode desconhecido', { viewMode: 'CARDS' }],
      ['savedFilters com mais de 50 itens', { savedFilters: Array.from({ length: 51 }, (_, i) => ({ id: `f${i}`, name: 'n', criteria: {} })) }],
      ['savedFilter com name acima de 120 caracteres', { savedFilters: [{ id: 'f', name: 'n'.repeat(121), criteria: {} }] }],
      ['collapsed com valor que não é booleano', { collapsed: { RESOLVED: 'sim' } }],
      ['collapsed com mais de 100 entradas', { collapsed: map(101) }],
      ['collapsed com id de mais de 64 caracteres', { collapsed: { [tooLongId]: true } }],
      ['collapsed que não é mapa (lista)', { collapsed: ['RESOLVED'] }],
    ];
    it.each(bad)('AC-12: 400 e nada gravado para %s', async (_name, body) => {
      const res = await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send(body as object);
      expect(res.status).toBe(400);
      expect(prisma.userScreenPreference.upsert).not.toHaveBeenCalled();
      expect(rows.size).toBe(0);
    });

    it('AC-12: corpo acima de 64 KB (e abaixo do limite padrão do Express) devolve 400 e não grava', async () => {
      const body = { savedFilters: Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: 'n', criteria: { texto: 'x'.repeat(1500) } })) };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(64 * 1024);
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(100 * 1024);
      const res = await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send(body);
      expect(res.status).toBe(400);
      expect(prisma.userScreenPreference.upsert).not.toHaveBeenCalled();
    });

    it('AC-12: corpo perto de 64 KB, mas dentro do limite, é aceito', async () => {
      const body = { savedFilters: Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: 'n', criteria: { texto: 'x'.repeat(1000) } })) };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(64 * 1024);
      const res = await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send(body);
      expect(res.status).toBe(200);
      const get = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-1'));
      expect(get.body).toEqual(body);
    });
  });

  describe('AC-13: isolamento entre usuários', () => {
    it('AC-13: duas contas gravam a mesma tela e cada uma lê só a sua', async () => {
      await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send({ groupBy: 'status', collapsed: { OPEN: true } });
      await http().put('/me/screen-preferences/tickets-kanban').set(as('u-2')).send({ groupBy: 'priority', collapsed: { OPEN: false } });
      const one = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-1'));
      const two = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-2'));
      expect(one.body).toEqual({ groupBy: 'status', collapsed: { OPEN: true } });
      expect(two.body).toEqual({ groupBy: 'priority', collapsed: { OPEN: false } });
      expect(prisma.userScreenPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_screen: { userId: 'u-2', screen: 'tickets-kanban' } } }),
      );
    });

    it('AC-13: nenhuma rota aceita id de usuário (na URL ou no corpo); só a rota por tela funciona, com o id do token', async () => {
      await http().put('/me/screen-preferences/tickets-kanban').set(as('u-1')).send({ groupBy: 'status' });
      expect((await http().get('/me/screen-preferences/u-1/tickets-kanban').set(as('u-2'))).status).toBe(404);
      expect((await http().put('/me/screen-preferences/u-1/tickets-kanban').set(as('u-2')).send({ groupBy: 'x' })).status).toBe(404);
      expect((await http().put('/me/screen-preferences/tickets-kanban').set(as('u-2')).send({ userId: 'u-1', groupBy: 'x' })).status).toBe(400);
      const other = await http().get('/me/screen-preferences/tickets-kanban').set(as('u-2'));
      expect(other.status).toBe(200);
      expect(other.body).toEqual({});
      expect(rows.get('u-1|tickets-kanban').data).toEqual({ groupBy: 'status' });
    });
  });
});
