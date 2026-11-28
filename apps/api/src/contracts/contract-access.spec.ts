import { Role } from '@prisma/client';
import { ContractAccess } from './contract-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2a3 (#543): decisao de acesso a contratos e custos nos dois modos da flag
 * `rbac-permission-only`. Desligada: por perfil. Ligada: so por permissao.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const build = (flagOn: boolean, grants: Record<string, string[]>) => {
  const hasPermission = jest.fn(async (userId: string, ...keys: string[]) => (grants[userId] ?? []).some((k) => keys.includes(k)));
  const access = new ContractAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any);
  return { access, hasPermission };
};

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const user = (role: Role) => ({ id: `u-${role}`, role });

describe('ContractAccess: grupos padrao dao o mesmo resultado nos dois modos', () => {
  const expected = {
    manage: { ADMIN: true, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: false, CLIENT: false },
    billing: { ADMIN: true, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: false, CLIENT: false },
    financials: { ADMIN: true, AGENT_MASTER: false, AGENT: false, CLIENT_MASTER: true },
  } as const;

  describe.each(modes)('%s', (_label, flagOn) => {
    it.each(roles)('%s: gestao de contratos e de custos', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canManageContracts(user(role))).toBe(expected.manage[role]);
      expect(await access.canManageBilling(user(role))).toBe(expected.billing[role]);
    });

    // CLIENT fica de fora: o service barra o acesso antes de chegar na mascara.
    it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER] as const)('%s: visao financeira', async (role) => {
      const { access } = build(flagOn, defaultGrants());
      expect(await access.canViewFinancials(user(role))).toBe(expected.financials[role]);
    });
  });
});

describe('ContractAccess: flag ligada decide so por permissao', () => {
  it.each([
    ['canManageContracts', 'MANAGE_CONTRACTS'],
    ['canManageBilling', 'MANAGE_BILLING'],
    ['canViewFinancials', 'VIEW_CONTRACT_FINANCIALS'],
  ] as const)('%s: AGENT com %s passa; ADMIN sem a chave nao passa (sem bypass)', async (method, key) => {
    const { access, hasPermission } = build(true, { 'u-AGENT': [key], 'u-ADMIN': [] });
    expect(await access[method](user(Role.AGENT))).toBe(true);
    expect(hasPermission).toHaveBeenCalledWith('u-AGENT', key);
    expect(await access[method](user(Role.ADMIN))).toBe(false);
  });

  it.each([
    ['canManageContracts', 'MANAGE_BILLING'],
    ['canManageBilling', 'MANAGE_CONTRACTS'],
    ['canViewFinancials', 'MANAGE_CONTRACTS'],
  ] as const)('%s: a chave de outra decisao (%s) nao libera', async (method, otherKey) => {
    const { access } = build(true, { 'u-AGENT': [otherKey] });
    expect(await access[method](user(Role.AGENT))).toBe(false);
  });

  it('CLIENT_MASTER sem VIEW_CONTRACT_FINANCIALS fica mascarado; AGENT_MASTER com a chave ve', async () => {
    const { access } = build(true, { 'u-AGENT_MASTER': ['VIEW_CONTRACT_FINANCIALS'], 'u-CLIENT_MASTER': [] });
    expect(await access.canViewFinancials(user(Role.CLIENT_MASTER))).toBe(false);
    expect(await access.canViewFinancials(user(Role.AGENT_MASTER))).toBe(true);
  });
});

describe('ContractAccess: flag desligada decide so por perfil e nao consulta permissoes', () => {
  it('ADMIN gere mesmo sem chave; AGENT nao gere mesmo com todas as chaves', async () => {
    const all = ['MANAGE_CONTRACTS', 'MANAGE_BILLING', 'VIEW_CONTRACT_FINANCIALS'];
    const { access, hasPermission } = build(false, { 'u-AGENT': all, 'u-ADMIN': [] });
    expect(await access.canManageContracts(user(Role.ADMIN))).toBe(true);
    expect(await access.canManageBilling(user(Role.ADMIN))).toBe(true);
    expect(await access.canManageContracts(user(Role.AGENT))).toBe(false);
    expect(await access.canManageBilling(user(Role.AGENT))).toBe(false);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('AGENT e AGENT_MASTER ficam mascarados mesmo com a chave; CLIENT_MASTER ve sem a chave', async () => {
    const { access } = build(false, { 'u-AGENT': ['VIEW_CONTRACT_FINANCIALS'], 'u-AGENT_MASTER': ['VIEW_CONTRACT_FINANCIALS'], 'u-CLIENT_MASTER': [] });
    expect(await access.canViewFinancials(user(Role.AGENT))).toBe(false);
    expect(await access.canViewFinancials(user(Role.AGENT_MASTER))).toBe(false);
    expect(await access.canViewFinancials(user(Role.CLIENT_MASTER))).toBe(true);
  });
});
