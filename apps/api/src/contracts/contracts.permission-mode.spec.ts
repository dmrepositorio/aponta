import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ContractAccess } from './contract-access';
import { ContractsService } from './contracts.service';
import { CostRatesService } from './cost-rates.service';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a3 (#543): contratos e custos individuais nos dois modos da flag
 * `rbac-permission-only`. Com os grupos padrao o resultado ligado e igual ao desligado
 * (matriz da Fase 0); com grupos customizados so a flag ligada segue as permissoes.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;
const FINANCE = ['monthlyValue', 'lastAmendmentValue', 'adjustmentDate', 'excessHourlyRateCents', 'hourlyRateCents', 'monthlyFeeCents', 'fixedPriceCents'];

const actors = {
  [Role.ADMIN]: { id: 'u-ADMIN', role: Role.ADMIN },
  [Role.AGENT_MASTER]: { id: 'u-AGENT_MASTER', role: Role.AGENT_MASTER },
  [Role.AGENT]: { id: 'u-AGENT', role: Role.AGENT },
  [Role.CLIENT_MASTER]: { id: 'u-CLIENT_MASTER', role: Role.CLIENT_MASTER, organizationId: 'org-1' },
} as const;

const contract = () => ({
  id: 'c1', name: 'C', organizationId: 'org-1', type: 'MONTHLY_HOURS', scope: 'escopo',
  monthlyValue: 1, lastAmendmentValue: 2, adjustmentDate: new Date('2026-01-01'),
  excessHourlyRateCents: 3, hourlyRateCents: 4, monthlyFeeCents: 5, fixedPriceCents: 6,
  terms: [{ id: 't1', hourlyRateCents: 4, monthlyFeeCents: 5 }],
});

const setup = (flagOn: boolean, grants: Record<string, string[]>) => {
  const prisma: any = {
    contract: {
      findMany: jest.fn().mockResolvedValue([contract()]),
      findFirst: jest.fn().mockResolvedValue(contract()),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    technicianCostRate: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue({}),
  };
  const permissions = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
  const access = new ContractAccess({ isRbacPermissionOnly: () => flagOn } as any, permissions as any);
  return { prisma, contracts: new ContractsService(prisma, access), costs: new CostRatesService(prisma, access) };
};

const defaultGrants = () => Object.fromEntries(roles.map((r) => [`u-${r}`, DEFAULT_PERMISSION_GROUPS[r].permissions]));
const isMasked = (c: any) => FINANCE.every((f) => c[f] === null) && c.terms.every((t: any) => FINANCE.every((f) => t[f] === null));
const newContract = { organizationId: 'org-1', name: 'N' } as any;

describe.each(modes)('contratos e custos com grupos padrao: %s', (_label, flagOn) => {
  it.each(roles)('%s: financeiro mascarado so para AGENT e AGENT_MASTER', async (role) => {
    const { contracts } = setup(flagOn, defaultGrants());
    const masked = role === Role.AGENT || role === Role.AGENT_MASTER;
    expect(isMasked((await contracts.findAll(actors[role]))[0])).toBe(masked);
    expect(isMasked(await contracts.findOne('c1', actors[role]))).toBe(masked);
  });

  it.each(roles)('%s: escrita de contratos e custos so para ADMIN', async (role) => {
    const { contracts, costs, prisma } = setup(flagOn, defaultGrants());
    const admin = role === Role.ADMIN;
    const calls = [
      () => contracts.create(newContract, actors[role]),
      () => contracts.update('c1', { name: 'N' } as any, actors[role]),
      () => contracts.remove('c1', actors[role]),
      () => costs.list(actors[role]),
    ];
    for (const run of calls) {
      if (admin) await expect(run()).resolves.toBeDefined();
      else await expect(run()).rejects.toThrow(ForbiddenException);
    }
    if (!admin) {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.contract.create).not.toHaveBeenCalled();
      expect(prisma.contract.delete).not.toHaveBeenCalled();
      expect(prisma.technicianCostRate.findMany).not.toHaveBeenCalled();
    }
  });
});

describe('contratos e custos: grupos customizados so valem com a flag ligada', () => {
  const custom = { 'u-AGENT': ['MANAGE_CONTRACTS', 'MANAGE_BILLING', 'VIEW_CONTRACT_FINANCIALS'], 'u-ADMIN': [], 'u-CLIENT_MASTER': [] };

  it('ligada: AGENT com as chaves gere contratos, custos e ve valores; ADMIN sem chaves e barrado; CLIENT_MASTER sem chave e mascarado', async () => {
    const { contracts, costs, prisma } = setup(true, custom);
    await expect(contracts.create(newContract, actors[Role.AGENT])).resolves.toBeDefined();
    await expect(contracts.remove('c1', actors[Role.AGENT])).resolves.toBeDefined();
    await expect(costs.list(actors[Role.AGENT])).resolves.toEqual([]);
    expect(isMasked((await contracts.findAll(actors[Role.AGENT]))[0])).toBe(false);

    prisma.contract.create.mockClear();
    await expect(contracts.create(newContract, actors[Role.ADMIN])).rejects.toThrow(ForbiddenException);
    await expect(contracts.preflight(actors[Role.ADMIN])).rejects.toThrow(ForbiddenException);
    await expect(costs.create({ userId: 't', effectiveFrom: '2030-01-01', hourlyCostCents: 1 }, actors[Role.ADMIN])).rejects.toThrow(ForbiddenException);
    expect(prisma.contract.create).not.toHaveBeenCalled();
    expect(isMasked((await contracts.findAll(actors[Role.CLIENT_MASTER]))[0])).toBe(true);
  });

  it('desligada: as mesmas chaves nao mudam nada (AGENT barrado e mascarado, ADMIN gere, CLIENT_MASTER ve)', async () => {
    const { contracts, costs } = setup(false, custom);
    await expect(contracts.create(newContract, actors[Role.AGENT])).rejects.toThrow(ForbiddenException);
    await expect(costs.list(actors[Role.AGENT])).rejects.toThrow(ForbiddenException);
    expect(isMasked((await contracts.findAll(actors[Role.AGENT]))[0])).toBe(true);
    await expect(contracts.create(newContract, actors[Role.ADMIN])).resolves.toBeDefined();
    expect(isMasked((await contracts.findAll(actors[Role.CLIENT_MASTER]))[0])).toBe(false);
  });
});
