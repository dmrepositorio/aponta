import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { legacyContractAccess } from './contract-access.testing';
import { Role } from '@prisma/client';
import { ContractsService } from './contracts.service';
import { CostRatesService } from './cost-rates.service';

/**
 * Caracterização por perfil de contratos e custos individuais (#527, Fase 0b-3 do tracker #523).
 * Trava o comportamento ATUAL; nenhuma mudança de produção.
 */
const actors = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
  clientMasterNoOrg: { id: 'u-client-master-2', role: Role.CLIENT_MASTER },
  client: { id: 'u-client', role: Role.CLIENT },
};

const FINANCE_FIELDS = ['monthlyValue', 'lastAmendmentValue', 'adjustmentDate', 'excessHourlyRateCents', 'hourlyRateCents', 'monthlyFeeCents', 'fixedPriceCents'];

const financialContract = () => ({
  id: 'c1',
  name: 'Contrato',
  organizationId: 'org-1',
  type: 'MONTHLY_HOURS',
  scope: 'escopo visível',
  includedMinutes: 600,
  monthlyValue: 1000,
  lastAmendmentValue: 900,
  adjustmentDate: new Date('2026-01-01'),
  excessHourlyRateCents: 15000,
  hourlyRateCents: 12000,
  monthlyFeeCents: 100000,
  fixedPriceCents: 500000,
  terms: [{ id: 't1', includedMinutes: 600, hourlyRateCents: 12000, monthlyFeeCents: 100000, fixedPriceCents: 500000, excessHourlyRateCents: 15000 }],
});

describe('ContractsService: matriz por perfil (caracterização)', () => {
  let prisma: any;
  let service: ContractsService;

  beforeEach(() => {
    prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([financialContract()]),
        findFirst: jest.fn().mockResolvedValue(financialContract()),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    service = new ContractsService(prisma, legacyContractAccess());
  });

  const expectMasked = (c: any) => {
    for (const field of FINANCE_FIELDS) expect(c[field]).toBeNull();
    for (const term of c.terms) for (const field of FINANCE_FIELDS) expect(term[field]).toBeNull();
  };

  describe('máscara de financeiro (contracts.service.ts mask)', () => {
    it.each([
      ['AGENT_MASTER', actors.agentMaster],
      ['AGENT', actors.agent],
    ])('%s: findAll e findOne zeram os campos financeiros do contrato e das vigências, mantendo o resto', async (_label, user) => {
      const [listed] = await service.findAll(user);
      expectMasked(listed);
      expect(listed).toMatchObject({ scope: 'escopo visível', includedMinutes: 600, type: 'MONTHLY_HOURS' });

      const one = await service.findOne('c1', user);
      expectMasked(one);
      expect(one.terms[0]).toMatchObject({ id: 't1', includedMinutes: 600 });
    });

    it.each([
      ['ADMIN', actors.admin],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s: vê o financeiro completo (sem máscara)', async (_label, user) => {
      const [listed] = await service.findAll(user);
      expect(listed.monthlyFeeCents).toBe(100000);
      expect(listed.hourlyRateCents).toBe(12000);
      expect(listed.terms[0].fixedPriceCents).toBe(500000);
      const one = await service.findOne('c1', user);
      expect(one.monthlyValue).toBe(1000);
    });
  });

  describe('escopo de leitura por perfil (TenantHelper.getContractWhere)', () => {
    it('ADMIN: sem filtro de tenant', async () => {
      await service.findAll(actors.admin);
      expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('CLIENT_MASTER com organização: só contratos da própria organização', async () => {
      await service.findAll(actors.clientMaster);
      expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
    });

    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
    ])('%s: só contratos ativos ligados a mesas que ele acessa', async (_label, user) => {
      await service.findAll(user);
      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.active).toBe(true);
      expect(where.serviceDesks.some.OR).toEqual([
        { agents: { some: { id: user.id } } },
        { agentGroups: { some: { members: { some: { id: user.id } } } } },
        { allowCrossDeskInteraction: true },
      ]);
    });

    it.each([
      ['CLIENT', actors.client],
      ['CLIENT_MASTER sem organização', actors.clientMasterNoOrg],
    ])('%s: 403 em findAll e findOne, sem consultar contratos', async (_label, user) => {
      await expect(service.findAll(user)).rejects.toThrow(ForbiddenException);
      await expect(service.findOne('c1', user)).rejects.toThrow(ForbiddenException);
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
    });

    it('findOne: contrato fora do escopo do perfil responde 404, não 403 (sem enumeração)', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(service.findOne('alheio', actors.agent)).rejects.toThrow(NotFoundException);
    });
  });

  describe('escrita ADMIN-only (contracts.service.ts create, update, remove, preflight)', () => {
    const writes: Array<[string, (u: any) => Promise<unknown>]> = [
      ['create', (u) => service.create({ organizationId: 'org-1', name: 'Novo' } as any, u)],
      ['update', (u) => service.update('c1', { name: 'Novo' } as any, u)],
      ['remove', (u) => service.remove('c1', u)],
      ['preflight', (u) => service.preflight(u)],
    ];

    describe.each(writes)('%s', (_name, run) => {
      it.each([
        ['AGENT_MASTER', actors.agentMaster],
        ['AGENT', actors.agent],
        ['CLIENT_MASTER', actors.clientMaster],
        ['CLIENT', actors.client],
      ])('%s: 403 sem tocar em contratos', async (_label, user) => {
        await expect(run(user)).rejects.toThrow(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        for (const fn of Object.values(prisma.contract)) expect((fn as jest.Mock).mock.calls).toHaveLength(0);
      });
    });

    it('ADMIN: create (não comercial) chega ao banco', async () => {
      await service.create({ organizationId: 'org-1', name: 'Novo' } as any, actors.admin);
      expect(prisma.contract.create).toHaveBeenCalledTimes(1);
    });

    it('ADMIN: remove chega ao banco', async () => {
      await service.remove('c1', actors.admin);
      expect(prisma.contract.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('ADMIN: update abre a transação; preflight lê os contratos', async () => {
      prisma.$transaction.mockResolvedValue({});
      await service.update('c1', { name: 'Novo' } as any, actors.admin);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      prisma.contract.findMany.mockResolvedValue([]);
      await expect(service.preflight(actors.admin)).resolves.toEqual([]);
    });
  });
});

describe('CostRatesService: custo individual ADMIN-only (cost-rates.service.ts)', () => {
  let tx: any;
  let prisma: any;
  let service: CostRatesService;
  const dto = { userId: 'tech-1', effectiveFrom: '2030-01-01T00:00:00Z', hourlyCostCents: 5000 };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'tech-1', role: Role.AGENT }) },
      technicianCostRate: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      worklog: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma = {
      technicianCostRate: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    service = new CostRatesService(prisma, legacyContractAccess());
  });

  it.each([
    ['AGENT_MASTER', actors.agentMaster],
    ['AGENT', actors.agent],
    ['CLIENT_MASTER', actors.clientMaster],
    ['CLIENT', actors.client],
  ])('%s: 403 em list e create, sem ler nem gravar custos', async (_label, user) => {
    await expect(service.list(user)).rejects.toThrow(ForbiddenException);
    await expect(service.create(dto, user)).rejects.toThrow(ForbiddenException);
    expect(prisma.technicianCostRate.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ADMIN: list lê custos e create grava com createdBy do admin', async () => {
    await service.list(actors.admin);
    expect(prisma.technicianCostRate.findMany).toHaveBeenCalledTimes(1);
    await service.create(dto, actors.admin);
    expect(tx.technicianCostRate.create.mock.calls[0][0].data).toMatchObject({ userId: 'tech-1', hourlyCostCents: 5000, createdBy: 'u-admin' });
  });

  it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT])('create: custo permitido para técnico %s', async (role) => {
    tx.user.findUnique.mockResolvedValue({ id: 'tech-1', role });
    await expect(service.create(dto, actors.admin)).resolves.toBeDefined();
  });

  it.each([Role.CLIENT_MASTER, Role.CLIENT])('create: custo recusado (400) para alvo %s, que não é técnico', async (role) => {
    tx.user.findUnique.mockResolvedValue({ id: 'tech-1', role });
    await expect(service.create(dto, actors.admin)).rejects.toMatchObject({ status: 400 });
    expect(tx.technicianCostRate.create).not.toHaveBeenCalled();
  });
});
