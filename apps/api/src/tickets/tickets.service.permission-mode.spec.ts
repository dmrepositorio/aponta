import { Role } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { MaskAccess } from '../comments/mask-access';
import { legacyTransitionAccess } from './ticket-transition-access.testing';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2c (#547): telefone e ramal do solicitante na listagem, nos dois modos da flag
 * `rbac-permission-only`. Com os grupos padrão o resultado ligado é igual ao desligado.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const user = (role: Role) => ({ id: `u-${role}`, role, organizationId: 'org-1' });
const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const isTeam = (role: Role) => role === Role.ADMIN || role === Role.AGENT_MASTER || role === Role.AGENT;

const setup = (flagOn: boolean, grants: Record<string, string[]> = defaultGrants()) => {
  const prisma: any = { ticket: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
  const permissions = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
  const access = new MaskAccess({ isRbacPermissionOnly: () => flagOn } as any, permissions as any);
  return { prisma, service: new TicketsService(prisma, { emit: jest.fn() } as any, access, legacyTransitionAccess()) };
};
const selectOf = (prisma: any) => prisma.ticket.findMany.mock.calls[0][0].include.requester.select;

describe.each(modes)('contato do solicitante com grupos padrão: %s', (_label, flagOn) => {
  it.each(roles)('%s: phone e extension só para a equipe', async (role) => {
    const { service, prisma } = setup(flagOn);
    await service.findAll({} as any, user(role));
    expect(selectOf(prisma).phone === true).toBe(isTeam(role));
    expect(selectOf(prisma).extension === true).toBe(isTeam(role));
    expect(selectOf(prisma)).toMatchObject({ id: true, name: true, email: true });
  });

  it.each(roles)('%s: o caminho dos vencidos usa a mesma regra', async (role) => {
    const { service, prisma } = setup(flagOn);
    await service.findAll({ overdue: 'true' } as any, user(role));
    expect(selectOf(prisma).phone === true).toBe(isTeam(role));
    expect(selectOf(prisma).extension === true).toBe(isTeam(role));
  });
});

describe('contato do solicitante com flag ligada: só a permissão decide', () => {
  it('AGENT sem VIEW_REQUESTER_CONTACT_INFO não recebe phone nem extension', async () => {
    const { service, prisma } = setup(true, { 'u-AGENT': ['VIEW_AND_OPEN_TICKETS'] });
    await service.findAll({} as any, user(Role.AGENT));
    expect(selectOf(prisma).phone).toBeUndefined();
    expect(selectOf(prisma).extension).toBeUndefined();
  });

  it('CLIENT_MASTER com VIEW_REQUESTER_CONTACT_INFO recebe phone e extension', async () => {
    const { service, prisma } = setup(true, { 'u-CLIENT_MASTER': ['VIEW_REQUESTER_CONTACT_INFO'] });
    await service.findAll({} as any, user(Role.CLIENT_MASTER));
    expect(selectOf(prisma)).toMatchObject({ phone: true, extension: true });
  });

  it('o recorte de visibilidade da listagem segue por perfil (lote 2e)', async () => {
    const { service, prisma } = setup(true);
    await service.findAll({} as any, user(Role.CLIENT));
    expect(prisma.ticket.findMany.mock.calls[0][0].where).toMatchObject({ requesterId: 'u-CLIENT' });
  });
});
describe.each(modes)('clone de withTransaction mantém a decisão de máscara: %s', (_label, flagOn) => {
  it.each(roles)('%s: findAll pelo clone expõe phone e extension só para a equipe', async (role) => {
    const { service, prisma } = setup(flagOn);
    const clone = service.withTransaction(prisma, []);
    await clone.findAll({} as any, user(role));
    expect(selectOf(prisma).phone === true).toBe(isTeam(role));
    expect(selectOf(prisma).extension === true).toBe(isTeam(role));
  });

  it('findAll pelo clone: só com a flag ligada a permissão decide (AGENT sem a chave)', async () => {
    const { service, prisma } = setup(flagOn, { 'u-AGENT': ['VIEW_AND_OPEN_TICKETS'] });
    const clone = service.withTransaction(prisma, []);
    await clone.findAll({} as any, user(Role.AGENT));
    expect(selectOf(prisma).phone === true).toBe(!flagOn);
  });
});
