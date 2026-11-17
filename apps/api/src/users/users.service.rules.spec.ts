import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { createFakePrisma, FakePrisma } from '../testing/fake-prisma';
import { ID, seedTables } from '../testing/users-http-harness';
import { UsersService } from './users.service';

/** Seam 2: regras de serviço com Prisma em memória (sem HTTP). */
describe('Regras de serviço do cadastro de usuário (DMTE-550)', () => {
  let prisma: FakePrisma;
  let users: UsersService;

  beforeEach(async () => {
    prisma = createFakePrisma(seedTables());
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    users = moduleRef.get(UsersService);
  });

  describe('AC-13: findAgents', () => {
    const agentNames = (list: { name: string }[]) => list.map((u) => u.name);

    it('AC-13: ADMIN vê só atendentes ativos com senha (sem inativos, pendentes ou clientes)', async () => {
      const list = await users.findAgents({ id: ID.admin, role: Role.ADMIN } as never);
      expect(agentNames(list)).toEqual(['Admin Aponta', 'Ana Souza', 'Bruno Lima', 'Fábio Reis', 'Gestor Aponta']);
    });

    it('AC-13: atendente de mesa vê só colegas das suas mesas que estão ativos e com senha', async () => {
      prisma.serviceDesk.findMany = jest.fn().mockResolvedValue([
        { agents: [{ id: ID.bruno }, { id: ID.diego }, { id: ID.elisa }], agentGroups: [{ members: [{ id: ID.ana }, { id: ID.gabi }] }] },
      ]);

      const list = await users.findAgents({ id: ID.gestor, role: Role.AGENT_MASTER } as never);

      expect(agentNames(list)).toEqual(['Ana Souza', 'Bruno Lima']);
    });
  });

  describe('AC-08: senha nula nunca é lida como hash', () => {
    it('AC-08: changePassword de quem não tem senha responde 401 como senha atual errada (sem erro interno)', async () => {
      await expect(users.changePassword(ID.elisa, 'qualquer-senha', 'NovaSenha#2026')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.tables.user.find((u) => u.id === ID.elisa)?.password).toBeNull();
    });

    it('AC-08: toSafeUser nunca devolve a senha, nem nula', () => {
      const [row] = prisma.tables.user;
      expect(users.toSafeUser({ ...row, password: null } as never)).not.toHaveProperty('password');
      expect(users.toSafeUser(row as never)).not.toHaveProperty('password');
    });
  });
});

describe('AC-20: e-mail de notificação do sistema não sai para convite pendente (DMTE-550)', () => {
  it('AC-20: usersWithPermission (destinatários dos avisos) não devolve quem está pendente nem inativo', async () => {
    const prisma = createFakePrisma(seedTables());
    prisma.tables.permissionGroup.push({ id: ID.missing, name: 'Avisos', permissions: ['RECEIVE_WORKLOG_AUTOCLOSE_ALERT'] });
    for (const userId of [ID.ana, ID.elisa, ID.diego]) {
      prisma.tables.permissionGroupUser.push({ permissionGroupId: ID.missing, userId, createdAt: new Date() });
    }
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    const recipients = await moduleRef.get(PermissionsService).usersWithPermission('RECEIVE_WORKLOG_AUTOCLOSE_ALERT');

    expect(recipients.map((u) => u.email)).toEqual(['ana@aponta.test']);
  });
});
