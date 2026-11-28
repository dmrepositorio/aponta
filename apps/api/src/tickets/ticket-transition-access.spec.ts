import { Role } from '@prisma/client';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import { TicketTransitionAccess } from './ticket-transition-access';

/**
 * Lote 2f (#550), tracker #523: quem reabre chamado fechado, nos dois modos da flag
 * `rbac-permission-only`, com os grupos padrao reais. Hoje so ADMIN reabre, e
 * REVIEW_REOPEN_CLOSED_TICKETS so existe no grupo do ADMIN: os modos coincidem.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;
const user = (role: Role) => ({ id: `u-${role}`, role });
const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));

const setup = (flagOn: boolean, grants: Record<string, string[]> = defaultGrants()) => {
  const hasPermission = jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k)));
  return { hasPermission, access: new TicketTransitionAccess({ isRbacPermissionOnly: () => flagOn } as any, { hasPermission } as any) };
};

describe.each(modes)('canReopenClosed com grupos padrao: %s', (_label, flagOn) => {
  it.each(roles)('%s: so ADMIN reabre', async (role) => {
    const { access } = setup(flagOn);
    await expect(access.canReopenClosed(user(role))).resolves.toBe(role === Role.ADMIN);
  });
});

describe('canReopenClosed com flag desligada: so o perfil decide', () => {
  it('AGENT com REVIEW_REOPEN_CLOSED_TICKETS continua sem reabrir e a permissao nem e consultada', async () => {
    const { access, hasPermission } = setup(false, { 'u-AGENT': ['REVIEW_REOPEN_CLOSED_TICKETS'] });
    await expect(access.canReopenClosed(user(Role.AGENT))).resolves.toBe(false);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('ADMIN reabre mesmo sem a permissao no grupo', async () => {
    const { access } = setup(false, { 'u-ADMIN': [] });
    await expect(access.canReopenClosed(user(Role.ADMIN))).resolves.toBe(true);
  });
});

describe('canReopenClosed com flag ligada: so a permissao decide', () => {
  it.each([Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT])('%s com REVIEW_REOPEN_CLOSED_TICKETS reabre', async (role) => {
    const { access, hasPermission } = setup(true, { [`u-${role}`]: ['REVIEW_REOPEN_CLOSED_TICKETS'] });
    await expect(access.canReopenClosed(user(role))).resolves.toBe(true);
    expect(hasPermission).toHaveBeenCalledWith(`u-${role}`, 'REVIEW_REOPEN_CLOSED_TICKETS');
  });

  it('ADMIN sem REVIEW_REOPEN_CLOSED_TICKETS nao reabre (sem bypass do perfil)', async () => {
    const { access } = setup(true, { 'u-ADMIN': ['EDIT_TICKETS'] });
    await expect(access.canReopenClosed(user(Role.ADMIN))).resolves.toBe(false);
  });

  it('outra chave de reabertura (EDIT_CLOSED_TICKETS) nao serve', async () => {
    const { access } = setup(true, { 'u-AGENT': ['EDIT_CLOSED_TICKETS', 'MANAGE_NEW_TICKET_AUTHORIZATION'] });
    await expect(access.canReopenClosed(user(Role.AGENT))).resolves.toBe(false);
  });
});
