import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { DeskAccess } from '../service-desks/desk-access';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2d (#548, tracker #523): recorte do catalogo por Cliente nos dois modos da flag
 * `rbac-permission-only`. Desligada: por perfil. Ligada: so por permissao.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const desk = (organizations: { id: string }[], over: Record<string, unknown> = {}) => ({
  active: true,
  acceptingNewTickets: true,
  internalUse: false,
  openByAgentsOnly: false,
  listedGroupsOnly: false,
  unlistedCanCreateTicket: true,
  allowCrossDeskInteraction: true,
  agents: [],
  agentGroups: [],
  organizations,
  ...over,
});
const item = (id: string, organizations: { id: string }[], over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  isActive: true,
  defaultServiceDesk: desk(organizations, over),
});
const catalog = () => [
  {
    id: 'cat',
    name: 'cat',
    items: [
      item('global', []),
      item('org-a', [{ id: 'org-a' }]),
      item('org-b', [{ id: 'org-b' }]),
      item('internal', [], { internalUse: true }),
    ],
  },
];
const ids = (result: { items: { id: string }[] }[]) => result.flatMap((c) => c.items.map((i) => i.id));
const user = (role: Role, organizationId: string | null = role.startsWith('CLIENT') ? 'org-a' : null) => ({ id: `u-${role}`, role, organizationId });
const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));

const build = (flagOn: boolean, grants: Record<string, string[]> = defaultGrants()) => {
  const access = new DeskAccess(
    { isRbacPermissionOnly: () => flagOn } as any,
    { getEffectivePermissions: async (id: string) => new Set(grants[id] ?? []) } as any,
  );
  const findMany = jest.fn().mockResolvedValue(catalog());
  return new CatalogService({ serviceCatalogCategory: { findMany } } as any, access);
};

describe.each(modes)('CatalogService.findActiveCatalog com grupos padrao (%s)', (_label, flagOn) => {
  it.each([Role.CLIENT, Role.CLIENT_MASTER])('%s ignora o organizationId recebido e nao ve mesa interna nem de outro Cliente', async (role) => {
    const result = await build(flagOn).findActiveCatalog(user(role), 'org-b');
    expect(ids(result)).toEqual(['global', 'org-a']);
  });

  it.each([Role.AGENT, Role.AGENT_MASTER, Role.ADMIN])('%s sem organizationId recebe todos os itens', async (role) => {
    const result = await build(flagOn).findActiveCatalog(user(role));
    expect(ids(result)).toEqual(['global', 'org-a', 'org-b', 'internal']);
  });

  it.each([Role.AGENT, Role.AGENT_MASTER, Role.ADMIN])('%s com organizationId recebe so itens globais e do Cliente pedido', async (role) => {
    const result = await build(flagOn).findActiveCatalog(user(role), 'org-b');
    expect(ids(result)).toEqual(['global', 'org-b', 'internal']);
  });
});

describe('CatalogService.findActiveCatalog: flag ligada decide so por permissao', () => {
  it('AGENT so com escopo de organizacao e tratado como cliente: o organizationId do pedido nao vale', async () => {
    const service = build(true, { 'u-AGENT': ['VIEW_ORGANIZATION_SERVICE_DESKS'] });
    const result = await service.findActiveCatalog(user(Role.AGENT, 'org-a'), 'org-b');
    expect(ids(result)).toEqual(['global', 'org-a']);
  });

  it('CLIENT com VIEW_ALL_SERVICE_DESKS ve o catalogo inteiro e pode filtrar por Cliente', async () => {
    const service = build(true, { 'u-CLIENT': ['VIEW_ALL_SERVICE_DESKS', 'VIEW_ORGANIZATION_SERVICE_DESKS'] });
    expect(ids(await service.findActiveCatalog(user(Role.CLIENT, 'org-a')))).toEqual(['global', 'org-a', 'org-b', 'internal']);
    expect(ids(await service.findActiveCatalog(user(Role.CLIENT, 'org-a'), 'org-b'))).toEqual(['global', 'org-b', 'internal']);
  });

  it('ADMIN sem nenhuma chave nao recebe item algum (sem bypass)', async () => {
    const service = build(true, { 'u-ADMIN': [] });
    expect(ids(await service.findActiveCatalog(user(Role.ADMIN)))).toEqual([]);
  });

  it('CLIENT com USE_INTERNAL_SERVICE_DESKS ve a mesa interna da propria organizacao', async () => {
    const service = build(true, { 'u-CLIENT': ['VIEW_ORGANIZATION_SERVICE_DESKS', 'USE_INTERNAL_SERVICE_DESKS'] });
    expect(ids(await service.findActiveCatalog(user(Role.CLIENT)))).toEqual(['global', 'org-a', 'internal']);
  });
});

describe('CatalogService.findActiveCatalog: flag desligada ignora permissoes', () => {
  it('CLIENT com todas as chaves de atendimento segue tratado como cliente', async () => {
    const service = build(false, { 'u-CLIENT': ['VIEW_ALL_SERVICE_DESKS', 'USE_INTERNAL_SERVICE_DESKS'] });
    expect(ids(await service.findActiveCatalog(user(Role.CLIENT, 'org-a'), 'org-b'))).toEqual(['global', 'org-a']);
  });
});
