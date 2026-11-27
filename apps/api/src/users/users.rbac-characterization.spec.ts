import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';

/**
 * Caracterização por perfil de usuários (#527, Fase 0b-3 do tracker #523):
 * findAgents, filtro `roles`, proteção do último ADMIN ativo e troca de tipo.
 * Trava o comportamento ATUAL; nenhuma mudança de produção. Helper local ao
 * spec (não usa fake-prisma nem o harness HTTP compartilhado).
 */
const actors = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
  client: { id: 'u-client', role: Role.CLIENT },
};

const userRow = (id: string, role: Role, extra: Record<string, unknown> = {}) => ({
  id, name: id, email: `${id}@exemplo.test`, role, active: true, password: 'hash-de-fixture', ...extra,
});

describe('UsersService: caracterização por perfil', () => {
  let prisma: any;
  let tx: any;
  let service: UsersService;

  beforeEach(() => {
    tx = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      serviceDesk: { findMany: jest.fn().mockResolvedValue([]) },
      permissionGroup: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    service = new UsersService(prisma);
  });

  describe('findAgents', () => {
    const roleFilter = { role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] }, active: true, password: { not: null } };

    it('ADMIN: todos os atendentes ativos com senha, sem escopo de mesa e sem consultar mesas', async () => {
      await service.findAgents(actors.admin);
      expect(prisma.serviceDesk.findMany).not.toHaveBeenCalled();
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual(roleFilter);
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
    ])('%s: só colegas das mesas que acessa (escopo getServiceDeskWhere)', async (_label, user) => {
      prisma.serviceDesk.findMany.mockResolvedValue([
        { agents: [{ id: 'colega-1' }], agentGroups: [{ members: [{ id: 'colega-2' }, { id: 'colega-1' }] }] },
      ]);
      await service.findAgents(user);
      expect(prisma.serviceDesk.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { agents: { some: { id: user.id } } },
          { agentGroups: { some: { members: { some: { id: user.id } } } } },
          { allowCrossDeskInteraction: true, active: true },
        ],
      });
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject(roleFilter);
      expect([...where.id.in].sort()).toEqual(['colega-1', 'colega-2']);
    });

    it('AGENT sem mesa alcançável: lista vazia (id in [])', async () => {
      await service.findAgents(actors.agent);
      expect(prisma.user.findMany.mock.calls[0][0].where.id).toEqual({ in: [] });
    });

    it.each([
      ['CLIENT_MASTER', actors.clientMaster],
      ['CLIENT', actors.client],
    ])('%s: cai no escopo de mesas de cliente (ativas, abertas, sem uso interno), nunca no escopo ADMIN', async (_label, user) => {
      await service.findAgents(user);
      const deskWhere = prisma.serviceDesk.findMany.mock.calls[0][0].where;
      expect(deskWhere).toMatchObject({ active: true, acceptingNewTickets: true, internalUse: false });
      expect(prisma.user.findMany.mock.calls[0][0].where.id).toEqual({ in: [] });
    });
  });

  describe('findAll: filtro roles', () => {
    it('sem parâmetros: lista sem paginação e sem filtro de tipo', async () => {
      await service.findAll({} as any);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({});
      expect(prisma.user.findMany.mock.calls[0][0]).not.toHaveProperty('take');
    });

    it('roles: aplica role in [...] e ativa a paginação', async () => {
      const res: any = await service.findAll({ roles: [Role.AGENT, Role.CLIENT] } as any);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: { in: [Role.AGENT, Role.CLIENT] } });
      expect(res.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('roles vazio: não filtra por tipo (lista vazia equivale a todos)', async () => {
      await service.findAll({ roles: [] } as any);
      expect(prisma.user.findMany.mock.calls[0][0].where).not.toHaveProperty('role');
    });
  });

  describe('setActiveMany: proteção do último ADMIN ativo', () => {
    it('inativar o último ADMIN ativo: 409 e nada é gravado', async () => {
      tx.user.findMany.mockResolvedValue([userRow('adm-2', Role.ADMIN)]);
      tx.user.count.mockResolvedValue(0);
      await expect(service.setActiveMany(['adm-2'], false, 'u-admin')).rejects.toThrow(ConflictException);
      expect(tx.user.count.mock.calls[0][0].where).toEqual({ role: Role.ADMIN, active: true, id: { notIn: ['adm-2'] } });
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it('inativar um ADMIN quando sobra outro ADMIN ativo: permitido', async () => {
      tx.user.findMany.mockResolvedValueOnce([userRow('adm-2', Role.ADMIN)]).mockResolvedValueOnce([userRow('adm-2', Role.ADMIN, { active: false })]);
      tx.user.count.mockResolvedValue(1);
      await service.setActiveMany(['adm-2'], false, 'u-admin');
      expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['adm-2'] } }, data: { active: false } });
    });

    it('lote que inativa todos os ADMIN ativos: 409 (a regra olha o conjunto inteiro)', async () => {
      tx.user.findMany.mockResolvedValue([userRow('adm-1', Role.ADMIN), userRow('adm-2', Role.ADMIN)]);
      tx.user.count.mockResolvedValue(0);
      await expect(service.setActiveMany(['adm-1', 'adm-2'], false, 'u-admin')).rejects.toThrow(ConflictException);
      expect(tx.user.count.mock.calls[0][0].where.id).toEqual({ notIn: ['adm-1', 'adm-2'] });
    });

    it('inativar quem não é ADMIN não consulta a contagem de ADMIN', async () => {
      tx.user.findMany.mockResolvedValue([userRow('ag-1', Role.AGENT)]);
      await service.setActiveMany(['ag-1'], false, 'u-admin');
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('ADMIN já inativo não conta como "último ativo" a proteger', async () => {
      tx.user.findMany.mockResolvedValue([userRow('adm-3', Role.ADMIN, { active: false })]);
      await service.setActiveMany(['adm-3'], false, 'u-admin');
      expect(tx.user.count).not.toHaveBeenCalled();
    });

    it('ninguém inativa a si mesmo, nem sendo ADMIN: 409 antes de consultar a contagem', async () => {
      tx.user.findMany.mockResolvedValue([userRow('u-admin', Role.ADMIN)]);
      await expect(service.setActiveMany(['u-admin'], false, 'u-admin')).rejects.toThrow(ConflictException);
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it('ativar não sofre as proteções (reativar a si mesmo ou ADMIN é permitido)', async () => {
      tx.user.findMany.mockResolvedValue([userRow('u-admin', Role.ADMIN, { active: false })]);
      await service.setActiveMany(['u-admin'], true, 'u-admin');
      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['u-admin'] } }, data: { active: true } });
    });

    it('usuário inexistente no lote: 404 e nada é gravado', async () => {
      tx.user.findMany.mockResolvedValue([]);
      await expect(service.setActiveMany(['nao-existe'], false, 'u-admin')).rejects.toThrow(NotFoundException);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('update: troca de tipo (Role) depende da permissão CHANGE_USER_ROLE', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(userRow('alvo', Role.AGENT));
    });

    it('sem a permissão: trocar o tipo é 403 e nada é gravado', async () => {
      await expect(service.update('alvo', { role: Role.ADMIN } as any, false)).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('sem a permissão: reenviar o mesmo tipo não conta como troca', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({ ...userRow('alvo', Role.AGENT), organization: null, twoFactor: null, technicalGroup: null, permissionGroupLinks: [] });
      await expect(service.update('alvo', { role: Role.AGENT } as any, false)).resolves.toBeDefined();
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('com a permissão: a troca de tipo é gravada', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({ ...userRow('alvo', Role.AGENT), organization: null, twoFactor: null, technicalGroup: null, permissionGroupLinks: [] });
      await service.update('alvo', { role: Role.AGENT_MASTER } as any, true);
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ role: Role.AGENT_MASTER });
    });
  });
});
