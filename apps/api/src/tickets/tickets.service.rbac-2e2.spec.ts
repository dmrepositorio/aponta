import { NotFoundException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { legacyMaskAccess } from '../comments/mask-access.testing';
import { legacyTransitionAccess } from './ticket-transition-access.testing';
import { ScopeAccess } from '../core/security/scope-access';
import { SCOPE_KEYS } from '../core/security/scope-resolver';
import { TenantHelper } from '../core/security/tenant.helper';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

/**
 * Lote 2e2 do tracker #523 (#584): TicketsService.findOne/findAll sobre o ScopeAccess.
 * Flag desligada: `where` e autorizacao IDENTICOS aos de hoje (sem consultar permissoes).
 * Ligada: pelo ScopeResolver com as permissoes do usuario; os 5 grupos padrao dao o mesmo resultado.
 */
const ZERO = '00000000-0000-0000-0000-000000000000';
const K = SCOPE_KEYS;
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

type Rec = Record<string, any>;
function matches(rec: Rec, where: Rec): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Rec[]).every((w) => matches(rec, w));
    if (key === 'OR') return (cond as Rec[]).some((w) => matches(rec, w));
    if (cond === undefined) return true;
    const value = rec[key];
    if (cond !== null && typeof cond === 'object') {
      if ('some' in cond) return Array.isArray(value) && value.some((i: Rec) => matches(i, cond.some));
      if ('none' in cond) return Array.isArray(value) && !value.some((i: Rec) => matches(i, cond.none));
      if ('not' in cond) return value !== cond.not;
      return value !== undefined && value !== null && matches(value, cond);
    }
    return value === cond;
  });
}

const userOf = (role: Role, organizationId?: string | null, id = `u-${role}`): CurrentUserPayload => ({ id, role, organizationId });
const defaults = (): Record<string, string[]> =>
  Object.fromEntries(roles.map((r) => [`u-${r}`, DEFAULT_PERMISSION_GROUPS[r].permissions]));

const scopeOf = (flagOn: boolean, grants: Record<string, string[]>) => {
  const getEffectivePermissions = jest.fn(async (id: string) => new Set(grants[id] ?? []));
  const scope = new ScopeAccess({ isRbacPermissionOnly: () => flagOn } as any, { getEffectivePermissions } as any);
  return { scope, getEffectivePermissions };
};

const makePrisma = (row?: Rec | null) => {
  const prisma: any = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue(row ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      // O `count` de autorizacao do findOne avalia o `where` enviado contra a linha.
      count: jest.fn(async ({ where }: { where: Rec }) => (row && matches(row, where) ? 1 : 0)),
    },
    worklog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
};
const serviceOf = (prisma: any, scope?: ScopeAccess) =>
  new TicketsService(prisma, { emit: jest.fn() } as never, legacyMaskAccess(), legacyTransitionAccess(), undefined, scope);

// Linha como o findOne carrega: mesa filtrada para o usuario atual (agents/agentGroups so dele).
const row = (user: CurrentUserPayload, extra: Rec = {}) => ({
  id: 'ticket-1',
  status: TicketStatus.IN_PROGRESS,
  requesterId: 'someone-else',
  requester: { organizationId: 'org-b' },
  serviceDesk: {
    id: 'desk-1',
    allowCrossDeskInteraction: false,
    allowReopenUnbilled: true,
    allowReopenBilled: true,
    allowPauseResumeSla: true,
    listedGroupsOnly: false,
    agents: [],
    agentGroups: [],
  },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  responseDeadline: null,
  resolveDeadline: null,
  slaAccumulatedPause: 0,
  slaAccumulatedPauseTime: 0,
  slaPausedAt: null,
  ...extra,
});

describe.each(modes)('TicketsService.findAll (%s): where por perfil', (_label, flagOn) => {
  const run = async (user: CurrentUserPayload, grants: Record<string, string[]>, query: Rec = {}) => {
    const prisma = makePrisma();
    const { scope, getEffectivePermissions } = scopeOf(flagOn, grants);
    await serviceOf(prisma, scope).findAll(query as never, user);
    return { where: prisma.ticket.findMany.mock.calls[0][0].where, prisma, getEffectivePermissions };
  };

  it.each(roles.flatMap((role) => [['org-a'], [null], [undefined]].map(([org]) => [role, org] as const)))(
    'grupo padrao de %s, organizationId=%s: mesmo where do TenantHelper',
    async (role, org) => {
      const user = userOf(role, org);
      const { where } = await run(user, defaults());
      expect(where).toEqual(TenantHelper.getTicketWhere(user));
    },
  );

  it('CLIENT_MASTER de A: a organizacao de A fica no filtro mesmo se pedir organizationId de B (nunca le B)', async () => {
    const user = userOf(Role.CLIENT_MASTER, 'org-a');
    const { where } = await run(user, defaults(), { organizationId: 'org-b' });
    expect(where.requester).toEqual({
      AND: [{ organizationId: 'org-a' }, { organizationId: 'org-b' }],
    });
  });

  it('CLIENT_MASTER sem organizacao: so os proprios', async () => {
    const { where } = await run(userOf(Role.CLIENT_MASTER, null), defaults());
    expect(where.requesterId).toBe('u-CLIENT_MASTER');
    expect(where.requester).toBeUndefined();
  });

  it('desligada nao consulta permissoes; ligada consulta as do usuario', async () => {
    const { getEffectivePermissions } = await run(userOf(Role.AGENT), defaults());
    if (flagOn) expect(getEffectivePermissions).toHaveBeenCalledWith('u-AGENT');
    else expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('ADMIN sem chave de escopo: so a flag ligada fecha tudo (fail-closed, UUID zero)', async () => {
    const { where } = await run(userOf(Role.ADMIN), { 'u-ADMIN': [] });
    if (flagOn) expect(where).toMatchObject({ id: ZERO });
    else expect(where.id).toBeUndefined();
  });

  it('CLIENT com VIEW_ALL_TICKETS: so a flag ligada le todos', async () => {
    const { where } = await run(userOf(Role.CLIENT), { 'u-CLIENT': [K.TICKETS_ALL] });
    if (flagOn) expect(where.requesterId).toBeUndefined();
    else expect(where.requesterId).toBe('u-CLIENT');
  });
});

describe.each(modes)('TicketsService.findOne (%s): autorizacao por perfil', (_label, flagOn) => {
  const mine = 'u-self';
  type Case = { name: string; role: Role; org: string | null; extra: (u: CurrentUserPayload) => Rec; allowed: boolean };
  const own = (u: CurrentUserPayload) => ({ requesterId: u.id, requester: { organizationId: 'org-z' } });
  const sameOrg = () => ({ requester: { organizationId: 'org-a' } });
  const otherOrg = () => ({ requester: { organizationId: 'org-b' } });
  const linkedDesk = (u: CurrentUserPayload) => ({
    serviceDesk: { ...row(u).serviceDesk, agents: [{ id: u.id }] },
  });
  const linkedByGroup = (u: CurrentUserPayload) => ({
    serviceDesk: { ...row(u).serviceDesk, agentGroups: [{ members: [{ id: u.id }] }] },
  });
  const crossDesk = (u: CurrentUserPayload) => ({
    serviceDesk: { ...row(u).serviceDesk, allowCrossDeskInteraction: true },
  });
  const cases: Case[] = [
    { name: 'ADMIN abre qualquer chamado', role: Role.ADMIN, org: 'org-a', extra: otherOrg, allowed: true },
    { name: 'CLIENT abre o proprio', role: Role.CLIENT, org: 'org-a', extra: own, allowed: true },
    { name: 'CLIENT nao abre o de colega da mesma organizacao', role: Role.CLIENT, org: 'org-a', extra: sameOrg, allowed: false },
    { name: 'CLIENT_MASTER abre os da sua organizacao', role: Role.CLIENT_MASTER, org: 'org-a', extra: sameOrg, allowed: true },
    { name: 'CLIENT_MASTER de A nunca abre os de B', role: Role.CLIENT_MASTER, org: 'org-a', extra: otherOrg, allowed: false },
    { name: 'CLIENT_MASTER sem organizacao abre o proprio', role: Role.CLIENT_MASTER, org: null, extra: own, allowed: true },
    { name: 'CLIENT_MASTER sem organizacao nao abre o de organizacao nula', role: Role.CLIENT_MASTER, org: null, extra: () => ({ requester: { organizationId: null } }), allowed: false },
    { name: 'AGENT vinculado a mesa abre', role: Role.AGENT, org: null, extra: linkedDesk, allowed: true },
    { name: 'AGENT vinculado por grupo abre', role: Role.AGENT_MASTER, org: null, extra: linkedByGroup, allowed: true },
    { name: 'AGENT sem vinculo abre se a mesa aceita interacao entre mesas', role: Role.AGENT, org: null, extra: crossDesk, allowed: true },
    { name: 'AGENT sem vinculo e sem cross-desk nao abre', role: Role.AGENT, org: null, extra: () => ({}), allowed: false },
    { name: 'AGENT nao abre o proprio chamado de mesa sem vinculo', role: Role.AGENT, org: null, extra: own, allowed: false },
  ];

  it.each(cases)('$name', async ({ role, org, extra, allowed }) => {
    const user = userOf(role, org, mine);
    const grants = { [mine]: DEFAULT_PERMISSION_GROUPS[role].permissions };
    const prisma = makePrisma(row(user, extra(user)));
    const { scope, getEffectivePermissions } = scopeOf(flagOn, grants);
    const result = serviceOf(prisma, scope).findOne('ticket-1', user);
    if (allowed) await expect(result).resolves.toMatchObject({ id: 'ticket-1' });
    else await expect(result).rejects.toThrow(NotFoundException);
    if (flagOn) {
      expect(getEffectivePermissions).toHaveBeenCalledWith(mine);
      expect(prisma.ticket.count).toHaveBeenCalledTimes(1);
    } else {
      expect(getEffectivePermissions).not.toHaveBeenCalled();
      expect(prisma.ticket.count).not.toHaveBeenCalled();
    }
  });

  it('chamado inexistente: NotFound sem consultar o escopo', async () => {
    const { scope, getEffectivePermissions } = scopeOf(flagOn, defaults());
    const prisma = makePrisma(null);
    await expect(serviceOf(prisma, scope).findOne('x', userOf(Role.ADMIN))).rejects.toThrow(NotFoundException);
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('ADMIN sem chave de escopo: so a flag ligada nega (NotFound, fail-closed)', async () => {
    const user = userOf(Role.ADMIN, 'org-a', mine);
    const { scope } = scopeOf(flagOn, { [mine]: [] });
    const result = serviceOf(makePrisma(row(user, {})), scope).findOne('ticket-1', user);
    if (flagOn) await expect(result).rejects.toThrow(NotFoundException);
    else await expect(result).resolves.toMatchObject({ id: 'ticket-1' });
  });

  it('CLIENT com VIEW_ALL_TICKETS: so a flag ligada abre o de outro solicitante', async () => {
    const user = userOf(Role.CLIENT, 'org-a', mine);
    const { scope } = scopeOf(flagOn, { [mine]: [K.TICKETS_ALL] });
    const result = serviceOf(makePrisma(row(user, otherOrg())), scope).findOne('ticket-1', user);
    if (flagOn) await expect(result).resolves.toMatchObject({ id: 'ticket-1' });
    else await expect(result).rejects.toThrow(NotFoundException);
  });

  it('o where da autorizacao e o do escopo e leva o id do chamado', async () => {
    const user = userOf(Role.CLIENT_MASTER, 'org-a', mine);
    const { scope } = scopeOf(flagOn, { [mine]: DEFAULT_PERMISSION_GROUPS[Role.CLIENT_MASTER].permissions });
    const prisma = makePrisma(row(user, sameOrg()));
    await serviceOf(prisma, scope).findOne('ticket-1', user);
    if (flagOn) {
      expect(prisma.ticket.count).toHaveBeenCalledWith({
        where: { id: 'ticket-1', AND: [{ requester: { organizationId: 'org-a' } }] },
      });
    }
  });

  it('allowedStatuses: CLIENT nao recebe a lista; os demais perfis recebem (decisao por perfil preservada)', async () => {
    const clientUser = userOf(Role.CLIENT, 'org-a', mine);
    const { scope } = scopeOf(flagOn, { [mine]: DEFAULT_PERMISSION_GROUPS[Role.CLIENT].permissions });
    const asClient = await serviceOf(makePrisma(row(clientUser, own(clientUser))), scope).findOne('ticket-1', clientUser);
    expect((asClient as any).allowedStatuses).toBeUndefined();

    const admin = userOf(Role.ADMIN, 'org-a', mine);
    const { scope: adminScope } = scopeOf(flagOn, { [mine]: DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions });
    const asAdmin = await serviceOf(makePrisma(row(admin, {})), adminScope).findOne('ticket-1', admin);
    expect(Array.isArray((asAdmin as any).allowedStatuses)).toBe(true);
  });
});

describe('TicketsService.withTransaction propaga o ScopeAccess (flag ligada, permissao diferente do perfil)', () => {
  const grantsOwnOnly = { 'u-ADMIN': [K.TICKETS_OWN] };

  it('findAll da copia transacional filtra pelas permissoes, nao pelo perfil', async () => {
    const { scope } = scopeOf(true, grantsOwnOnly);
    const base = serviceOf(makePrisma(), scope);
    const tx = makePrisma();
    await base.withTransaction(tx as never, []).findAll({} as never, userOf(Role.ADMIN, 'org-a'));
    expect(tx.ticket.findMany.mock.calls[0][0].where).toMatchObject({ requesterId: 'u-ADMIN' });
  });

  it('findOne da copia transacional autoriza pelas permissoes, nao pelo perfil', async () => {
    const { scope } = scopeOf(true, grantsOwnOnly);
    const base = serviceOf(makePrisma(), scope);
    const admin = userOf(Role.ADMIN, 'org-a');
    const tx = makePrisma(row(admin, {}));
    await expect(base.withTransaction(tx as never, []).findOne('ticket-1', admin)).rejects.toThrow(NotFoundException);
    expect(tx.ticket.count).toHaveBeenCalledTimes(1);
  });
});

describe('TicketsService sem ScopeAccess (specs que montam o service a mao): decide por perfil como hoje', () => {
  it.each(roles)('findAll de %s usa o where do TenantHelper, sem consultar permissoes', async (role) => {
    const prisma = makePrisma();
    const user = userOf(role, 'org-a');
    await serviceOf(prisma, undefined).findAll({} as never, user);
    expect(prisma.ticket.findMany.mock.calls[0][0].where).toEqual(TenantHelper.getTicketWhere(user));
  });

  it('CLIENT_MASTER de A continua preso a organizacao A e ADMIN continua sem filtro', async () => {
    const master = makePrisma();
    await serviceOf(master, undefined).findAll({} as never, userOf(Role.CLIENT_MASTER, 'org-a'));
    expect(master.ticket.findMany.mock.calls[0][0].where.requester).toEqual({ organizationId: 'org-a' });
    const admin = makePrisma();
    await serviceOf(admin, undefined).findAll({} as never, userOf(Role.ADMIN, 'org-a'));
    expect(admin.ticket.findMany.mock.calls[0][0].where.requester).toBeUndefined();
    expect(admin.ticket.findMany.mock.calls[0][0].where.requesterId).toBeUndefined();
  });
});
