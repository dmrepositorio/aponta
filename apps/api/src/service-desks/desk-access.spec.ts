import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DeskAccess } from './desk-access';
import {
  assertDeskAllowsOpen,
  assertListedAgentMayMutate,
  isDeskUsableBy,
  type DeskActor,
  type DeskCatalogContext,
} from './desk-policy';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2d (#548, tracker #523): politica de mesas nos dois modos da flag
 * `rbac-permission-only`. Desligada: por perfil. Ligada: so por permissao.
 */
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

const user = (role: Role, organizationId: string | null = role.startsWith('CLIENT') ? 'org-a' : null) => ({
  id: `u-${role}`,
  role,
  organizationId,
});

const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));

const build = (flagOn: boolean, grants: Record<string, string[]> = defaultGrants()) => {
  const getEffectivePermissions = jest.fn(async (userId: string) => new Set(grants[userId] ?? []));
  const access = new DeskAccess({ isRbacPermissionOnly: () => flagOn } as any, { getEffectivePermissions } as any);
  return { access, getEffectivePermissions };
};

const requester = { name: 'Ana', email: 'ana@exemplo.test', phone: '1', extension: '2' };
const openDesk = {
  active: true,
  acceptingNewTickets: true,
  internalUse: false,
  openByAgentsOnly: false,
  catalogRequiredOnOpen: false,
  requireRequesterName: false,
  requireRequesterEmail: false,
  requireRequesterPhone: false,
  requireRequesterExtension: false,
  requireResourceGroup: false,
  requireAttachments: false,
  listedGroupsOnly: false,
  unlistedCanCreateTicket: true,
  agents: [] as { id: string }[],
  agentGroups: [] as { members?: { id: string }[] }[],
};
const open = (desk: typeof openDesk, u: ReturnType<typeof user>, actor: DeskActor) =>
  assertDeskAllowsOpen({ desk, user: u, requester, attachmentCount: 0, actor });

const catalogDesk = (over: Partial<DeskCatalogContext> = {}): DeskCatalogContext => ({
  active: true,
  acceptingNewTickets: true,
  internalUse: false,
  openByAgentsOnly: false,
  listedGroupsOnly: false,
  unlistedCanCreateTicket: false,
  allowCrossDeskInteraction: false,
  agents: [],
  agentGroups: [],
  organizations: [],
  ...over,
});

describe('DeskAccess.resolve: grupos padrao dao o mesmo ator nos dois modos', () => {
  const expected: Record<(typeof roles)[number], DeskActor> = {
    ADMIN: { canUseInternalDesks: true, scope: 'ALL' },
    AGENT_MASTER: { canUseInternalDesks: true, scope: 'ASSIGNED' },
    AGENT: { canUseInternalDesks: true, scope: 'ASSIGNED' },
    CLIENT_MASTER: { canUseInternalDesks: false, scope: 'ORGANIZATION' },
    CLIENT: { canUseInternalDesks: false, scope: 'ORGANIZATION' },
  };

  describe.each(modes)('%s', (_label, flagOn) => {
    it.each(roles)('%s', async (role) => {
      const { access } = build(flagOn);
      expect(await access.resolve(user(role))).toEqual(expected[role]);
    });
  });
});

describe('politica de mesas: matriz dos 5 perfis com grupos padrao, nos dois modos', () => {
  describe.each(modes)('%s', (_label, flagOn) => {
    const actorOf = (role: Role) => build(flagOn).access.resolve(user(role));
    const listed = {
      ...openDesk,
      listedGroupsOnly: true,
      unlistedCanCreateTicket: false,
      agents: [{ id: 'u-AGENT' }],
      agentGroups: [{ members: [{ id: 'u-AGENT_MASTER' }] }],
    };
    const unlistedMutate = { listedGroupsOnly: true, agents: [], agentGroups: [] as [] };

    it.each([Role.CLIENT, Role.CLIENT_MASTER])('%s e barrado em mesa interna e em mesa so para atendentes', async (role) => {
      const actor = await actorOf(role);
      expect(() => open({ ...openDesk, internalUse: true }, user(role), actor)).toThrow(ForbiddenException);
      expect(() => open({ ...openDesk, openByAgentsOnly: true }, user(role), actor)).toThrow(ForbiddenException);
    });

    it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT])('%s abre mesa interna e mesa so para atendentes', async (role) => {
      const actor = await actorOf(role);
      expect(() => open({ ...openDesk, internalUse: true, openByAgentsOnly: true }, user(role), actor)).not.toThrow();
    });

    it.each(roles)('%s nao abre mesa inativa (nem o ADMIN)', async (role) => {
      const actor = await actorOf(role);
      expect(() => open({ ...openDesk, active: false }, user(role), actor)).toThrow(BadRequestException);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s sem vinculo e barrado em mesa listada', async (role) => {
      const actor = await actorOf(role);
      const stranger = { ...user(role), id: 'other' };
      expect(() => open(listed, stranger, actor)).toThrow(ForbiddenException);
      expect(() => assertListedAgentMayMutate({ desk: unlistedMutate, user: stranger, actor })).toThrow(ForbiddenException);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s listado abre e manipula', async (role) => {
      const actor = await actorOf(role);
      expect(() => open(listed, user(role), actor)).not.toThrow();
      expect(() => assertListedAgentMayMutate({ desk: listed, user: user(role), actor })).not.toThrow();
    });

    // CARACTERIZACAO: comportamento atual, pode ser defeito (desk-policy.ts:168-169, ver #523). Preservado.
    it.each([Role.ADMIN, Role.CLIENT_MASTER, Role.CLIENT])('%s passa pela trava de mesa listada, sem vinculo', async (role) => {
      const actor = await actorOf(role);
      expect(() => open(listed, user(role), actor)).not.toThrow();
      expect(() => assertListedAgentMayMutate({ desk: unlistedMutate, user: user(role), actor })).not.toThrow();
    });

    it('ADMIN usa qualquer mesa ativa, de outro Cliente, interna ou so de atendentes', async () => {
      const actor = await actorOf(Role.ADMIN);
      for (const over of [{ internalUse: true }, { openByAgentsOnly: true }, { organizations: [{ id: 'org-b' }] }, { listedGroupsOnly: true }]) {
        expect(isDeskUsableBy(catalogDesk(over), user(Role.ADMIN), actor)).toBe(true);
      }
      expect(isDeskUsableBy(catalogDesk({ active: false }), user(Role.ADMIN), actor)).toBe(false);
    });

    it.each([Role.CLIENT, Role.CLIENT_MASTER])('%s usa so mesa global ou da propria organizacao, nao interna', async (role) => {
      const actor = await actorOf(role);
      const u = user(role);
      expect(isDeskUsableBy(catalogDesk(), u, actor)).toBe(true);
      expect(isDeskUsableBy(catalogDesk({ organizations: [{ id: 'org-a' }] }), u, actor)).toBe(true);
      expect(isDeskUsableBy(catalogDesk({ organizations: [{ id: 'org-b' }] }), u, actor)).toBe(false);
      expect(isDeskUsableBy(catalogDesk({ internalUse: true }), u, actor)).toBe(false);
      expect(isDeskUsableBy(catalogDesk({ openByAgentsOnly: true }), u, actor)).toBe(false);
      expect(isDeskUsableBy(catalogDesk({ organizations: [{ id: 'org-a' }] }), { ...u, organizationId: null }, actor)).toBe(false);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s usa mesa em que atua; sem vinculo, so com interacao entre mesas', async (role) => {
      const actor = await actorOf(role);
      const u = user(role);
      expect(isDeskUsableBy(catalogDesk({ agents: [{ id: u.id }] }), u, actor)).toBe(true);
      expect(isDeskUsableBy(catalogDesk({ agentGroups: [{ members: [{ id: u.id }] }] }), u, actor)).toBe(true);
      expect(isDeskUsableBy(catalogDesk(), u, actor)).toBe(false);
      expect(isDeskUsableBy(catalogDesk({ allowCrossDeskInteraction: true }), u, actor)).toBe(true);
    });
  });
});

describe('DeskAccess: flag ligada decide so por permissao', () => {
  it('ADMIN sem nenhuma chave nao tem escopo nem abre mesa interna (sem bypass)', async () => {
    const { access } = build(true, { 'u-ADMIN': [] });
    const actor = await access.resolve(user(Role.ADMIN));
    expect(actor).toEqual({ canUseInternalDesks: false, scope: 'NONE' });
    expect(isDeskUsableBy(catalogDesk(), user(Role.ADMIN), actor)).toBe(false);
    expect(() => open({ ...openDesk, internalUse: true }, user(Role.ADMIN), actor)).toThrow(ForbiddenException);
  });

  it('AGENT sem USE_INTERNAL_SERVICE_DESKS e barrado em mesa interna e so de atendentes', async () => {
    const { access } = build(true, { 'u-AGENT': ['VIEW_ASSIGNED_SERVICE_DESKS'] });
    const actor = await access.resolve(user(Role.AGENT));
    expect(() => open({ ...openDesk, internalUse: true }, user(Role.AGENT), actor)).toThrow(ForbiddenException);
    expect(() => open({ ...openDesk, openByAgentsOnly: true }, user(Role.AGENT), actor)).toThrow(ForbiddenException);
  });

  it('CLIENT com USE_INTERNAL_SERVICE_DESKS abre mesa interna e usa mesa interna da organizacao', async () => {
    const { access } = build(true, { 'u-CLIENT': ['VIEW_ORGANIZATION_SERVICE_DESKS', 'USE_INTERNAL_SERVICE_DESKS'] });
    const actor = await access.resolve(user(Role.CLIENT));
    expect(() => open({ ...openDesk, internalUse: true, openByAgentsOnly: true }, user(Role.CLIENT), actor)).not.toThrow();
    expect(isDeskUsableBy(catalogDesk({ internalUse: true }), user(Role.CLIENT), actor)).toBe(true);
  });

  it('AGENT com VIEW_ALL_SERVICE_DESKS nao fica preso a mesa listada (o escopo mais amplo vence)', async () => {
    const { access } = build(true, { 'u-AGENT': ['VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_SERVICE_DESKS'] });
    const actor = await access.resolve(user(Role.AGENT));
    expect(actor.scope).toBe('ALL');
    const listed = { ...openDesk, listedGroupsOnly: true, unlistedCanCreateTicket: false };
    expect(() => open(listed, user(Role.AGENT), actor)).not.toThrow();
    expect(() => assertListedAgentMayMutate({ desk: listed, user: user(Role.AGENT), actor })).not.toThrow();
    expect(isDeskUsableBy(catalogDesk({ organizations: [{ id: 'org-b' }] }), user(Role.AGENT), actor)).toBe(true);
  });

  it('ADMIN so com VIEW_ASSIGNED_SERVICE_DESKS fica preso a mesa listada', async () => {
    const { access } = build(true, { 'u-ADMIN': ['VIEW_ASSIGNED_SERVICE_DESKS'] });
    const actor = await access.resolve(user(Role.ADMIN));
    const listed = { listedGroupsOnly: true, agents: [], agentGroups: [] as [] };
    expect(() => assertListedAgentMayMutate({ desk: listed, user: user(Role.ADMIN), actor })).toThrow(ForbiddenException);
  });

  it('precedencia dos escopos: ALL vence ASSIGNED, que vence ORGANIZATION', async () => {
    const grants = {
      'u-a': ['VIEW_ORGANIZATION_SERVICE_DESKS', 'VIEW_ASSIGNED_SERVICE_DESKS', 'VIEW_ALL_SERVICE_DESKS'],
      'u-b': ['VIEW_ORGANIZATION_SERVICE_DESKS', 'VIEW_ASSIGNED_SERVICE_DESKS'],
      'u-c': ['VIEW_ORGANIZATION_SERVICE_DESKS'],
      'u-d': ['VIEW_TICKET_VALUES'],
    };
    const { access } = build(true, grants);
    const scopeOf = async (id: string) => (await access.resolve({ id, role: Role.CLIENT })).scope;
    expect(await scopeOf('u-a')).toBe('ALL');
    expect(await scopeOf('u-b')).toBe('ASSIGNED');
    expect(await scopeOf('u-c')).toBe('ORGANIZATION');
    expect(await scopeOf('u-d')).toBe('NONE');
  });

  it('o perfil nao pesa: CLIENT com chaves de atendimento age como atendente', async () => {
    const { access } = build(true, { 'u-CLIENT': ['VIEW_ASSIGNED_SERVICE_DESKS', 'USE_INTERNAL_SERVICE_DESKS'] });
    const actor = await access.resolve(user(Role.CLIENT));
    expect(actor).toEqual({ canUseInternalDesks: true, scope: 'ASSIGNED' });
    const listed = { ...openDesk, listedGroupsOnly: true, unlistedCanCreateTicket: false };
    expect(() => open(listed, user(Role.CLIENT), actor)).toThrow(ForbiddenException);
  });
});

describe('DeskAccess: flag desligada decide so por perfil e nao consulta permissoes', () => {
  it('AGENT com todas as chaves continua preso a mesa listada e sem escopo total', async () => {
    const all = ['VIEW_ALL_SERVICE_DESKS', 'USE_INTERNAL_SERVICE_DESKS', 'VIEW_ASSIGNED_SERVICE_DESKS'];
    const { access, getEffectivePermissions } = build(false, { 'u-AGENT': all });
    const actor = await access.resolve(user(Role.AGENT));
    expect(actor.scope).toBe('ASSIGNED');
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('ADMIN sem chaves segue com escopo total; CLIENT com a chave interna segue barrado', async () => {
    const { access } = build(false, { 'u-ADMIN': [], 'u-CLIENT': ['USE_INTERNAL_SERVICE_DESKS'] });
    expect(await access.resolve(user(Role.ADMIN))).toEqual({ canUseInternalDesks: true, scope: 'ALL' });
    expect((await access.resolve(user(Role.CLIENT))).canUseInternalDesks).toBe(false);
  });

  it('sem ator explicito, as funcoes de politica decidem pelo perfil', () => {
    expect(() => assertDeskAllowsOpen({ desk: { ...openDesk, internalUse: true }, user: user(Role.CLIENT), requester, attachmentCount: 0 })).toThrow(
      ForbiddenException,
    );
    expect(isDeskUsableBy(catalogDesk({ internalUse: true }), user(Role.ADMIN))).toBe(true);
  });
});
