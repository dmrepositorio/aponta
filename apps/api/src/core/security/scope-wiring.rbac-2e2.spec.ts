import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgendaService } from '../../agenda/agenda.service';
import { CommercialReportsService } from '../../reports/commercial-reports.service';
import { ReportsService } from '../../reports/reports.service';
import { WorklogsService } from '../../worklogs/worklogs.service';
import { ScopeAccess } from './scope-access';
import { SCOPE_KEYS } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e2 do tracker #523 (#584): os callers de `getTicketWhere` (agenda ligada a chamado, relatorios,
 * relatorio comercial e apontamentos) usam o ScopeAccess. Flag desligada: o `where` enviado ao banco e o
 * do TenantHelper (por perfil). Ligada: o do ScopeResolver com as permissoes do usuario.
 */
const K = SCOPE_KEYS;
const ZERO = '00000000-0000-0000-0000-000000000000';

const scopeOf = (flagOn: boolean, grants: Record<string, string[]>) =>
  new ScopeAccess(
    { isRbacPermissionOnly: () => flagOn } as any,
    { getEffectivePermissions: jest.fn(async (id: string) => new Set(grants[id] ?? [])) } as any,
  );
const actor = (role: Role, organizationId?: string | null, id = 'u-x') => ({ id, role, organizationId });
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;

// Um `await` esquecido deixaria uma promessa dentro do `where` (ou uma rejeicao solta): sem este listener
// o worker do jest cai em vez de a asserção falhar. Cada teste confere que nada ficou solto.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeAll(() => {
  process.on('unhandledRejection', onUnhandled);
});
afterAll(() => {
  process.off('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  const leaked = unhandled.splice(0);
  expect(leaked).toEqual([]);
});

// Perfis e o grupo padrao de chamados que cada um tem (PASSO 0).
const masterOrgA = actor(Role.CLIENT_MASTER, 'org-a');
const masterGrants = { 'u-x': [K.TICKETS_ORGANIZATION, K.TICKETS_OWN] };
const orgWhere = { requester: { organizationId: 'org-a' } };

describe.each(modes)('AgendaService.create com chamado (%s): vinculo respeita o escopo de chamados', (_label, flagOn) => {
  const run = (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = { ticket: { findFirst: jest.fn().mockResolvedValue(null) } };
    const access = { canManageSchedules: async () => false, isOrganizationScoped: async () => false };
    const service = new AgendaService(prisma, {} as any, access as any, scopeOf(flagOn, grants));
    const call = () => service.create({ ticketId: 't1', startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T11:00:00Z' } as any, user);
    return { prisma, call };
  };

  it('AGENT com o grupo padrao: o chamado precisa estar numa mesa com vinculo', async () => {
    const user = actor(Role.AGENT);
    const { prisma, call } = run(user, { 'u-x': [K.TICKETS_DESKS] });
    await expect(call()).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findFirst.mock.calls[0][0].where).toEqual({ id: 't1', ...TenantHelper.getTicketWhere(user) });
  });

  it('CLIENT_MASTER de A: so chamados de A (nunca de B) na agenda ligada a chamado', async () => {
    const { prisma, call } = run(masterOrgA, masterGrants);
    await expect(call()).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findFirst.mock.calls[0][0].where).toEqual({ id: 't1', ...orgWhere });
  });

  it('ADMIN sem chave de escopo: so a flag ligada fecha tudo (UUID zero)', async () => {
    const { prisma, call } = run(actor(Role.ADMIN, 'org-a'), { 'u-x': [] });
    await expect(call()).rejects.toThrow(NotFoundException);
    const where = prisma.ticket.findFirst.mock.calls[0][0].where;
    if (flagOn) expect(where).toEqual({ id: ZERO });
    else expect(where).toEqual({ id: 't1' });
  });

  it('AGENT so com VIEW_OWN_TICKETS: so a flag ligada restringe aos proprios', async () => {
    const { prisma, call } = run(actor(Role.AGENT), { 'u-x': [K.TICKETS_OWN] });
    await expect(call()).rejects.toThrow(NotFoundException);
    const where = prisma.ticket.findFirst.mock.calls[0][0].where;
    if (flagOn) expect(where).toEqual({ id: 't1', requesterId: 'u-x' });
    else expect(where).toEqual({ id: 't1', ...TenantHelper.getTicketWhere(actor(Role.AGENT)) });
  });
});

describe.each(modes)('ReportsService (%s): escopo de chamados nos relatorios', (_label, flagOn) => {
  const build = (grants: Record<string, string[]>) => {
    const prisma: any = {
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
      ticket: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const effective = new Set(grants['u-x'] ?? []);
    const permissions: any = {
      getEffectivePermissions: jest.fn(async () => effective),
      hasPermission: jest.fn(async (_id: string, key: string) => effective.has(key)),
      canViewTicketValues: jest.fn(async () => true),
    };
    const flags: any = { isRbacPermissionOnly: () => flagOn };
    const scope = scopeOf(flagOn, grants);
    return { prisma, service: new ReportsService(prisma, permissions, flags, scope) };
  };
  const swallow = (p: Promise<unknown>) => p.catch(() => undefined);

  it('getWorkload: AGENT com o grupo padrao le so as mesas com vinculo', async () => {
    const user = actor(Role.AGENT);
    const { prisma, service } = build({ 'u-x': [K.TICKETS_DESKS, 'VIEW_AGENT_REPORTS'] });
    await swallow(service.getWorkload(user));
    expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual(TenantHelper.getTicketWhere(user));
  });

  it('getWorkload: CLIENT_MASTER de A nunca le chamados de B', async () => {
    const { prisma, service } = build({ 'u-x': [...masterGrants['u-x'], 'VIEW_AGENT_REPORTS'] });
    await swallow(service.getWorkload(masterOrgA));
    expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual(orgWhere);
  });

  it('getWorkload: sem escopo nenhum e fail-closed (Forbidden), sem consultar o banco', async () => {
    const { prisma, service } = build({ 'u-x': ['VIEW_AGENT_REPORTS'] });
    const spy = actor('SPY' as Role);
    await expect(service.getWorkload(spy)).rejects.toThrow(ForbiddenException);
    expect(prisma.worklog.findMany).not.toHaveBeenCalled();
  });

  it('getWorkload: ADMIN sem chave de escopo so e barrado com a flag ligada', async () => {
    const { prisma, service } = build({ 'u-x': [] });
    const result = service.getWorkload(actor(Role.ADMIN, 'org-a'));
    if (flagOn) {
      await expect(result).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    } else {
      await swallow(result);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
    }
  });

  it('getBilling: CLIENT_MASTER de A le so os chamados de A', async () => {
    const { prisma, service } = build({ 'u-x': [...masterGrants['u-x'], 'VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT'] });
    await swallow(service.getBilling(masterOrgA));
    expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual(orgWhere);
  });

  it('getBilling: CLIENT_MASTER sem organizacao so le os proprios', async () => {
    const user = actor(Role.CLIENT_MASTER, null);
    const { prisma, service } = build({ 'u-x': [...masterGrants['u-x'], 'VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_ADMIN_REPORTS'] });
    await swallow(service.getBilling(user));
    // flag desligada nega antes (CLIENT_MASTER sem organizacao); ligada com VIEW_ADMIN_REPORTS segue o escopo
    if (flagOn) expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({ requesterId: 'u-x' });
    else expect(prisma.worklog.findMany).not.toHaveBeenCalled();
  });

  it('getBilling: sem escopo de chamados e fail-closed (Forbidden) com a flag ligada', async () => {
    const { prisma, service } = build({ 'u-x': ['VIEW_CLIENT_CONSUMPTION_STATEMENT_REPORT', 'VIEW_ADMIN_REPORTS'] });
    const result = service.getBilling(actor(Role.ADMIN, 'org-a'));
    if (flagOn) {
      await expect(result).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    } else {
      await swallow(result);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
    }
  });

  it('getResponseTimeComparison: CLIENT_MASTER de A le so os chamados de A', async () => {
    const { prisma, service } = build({ 'u-x': masterGrants['u-x'] });
    await swallow(service.getResponseTimeComparison(masterOrgA));
    expect(prisma.ticket.findMany.mock.calls[0][0].where).toMatchObject(orgWhere);
  });

  it('getResponseTimeComparison: sem escopo e fail-closed (Forbidden)', async () => {
    const { prisma, service } = build({ 'u-x': [] });
    await expect(service.getResponseTimeComparison(actor('SPY' as Role))).rejects.toThrow(ForbiddenException);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it('getSummary: AGENT com o grupo padrao le so as mesas com vinculo; CLIENT_MASTER so a organizacao', async () => {
    const agent = actor(Role.AGENT);
    const a = build({ 'u-x': [K.TICKETS_DESKS] });
    await swallow(a.service.getSummary(agent));
    expect(a.prisma.ticket.findMany.mock.calls[0][0].where).toEqual(TenantHelper.getTicketWhere(agent));
    const b = build({ 'u-x': masterGrants['u-x'] });
    await swallow(b.service.getSummary(masterOrgA));
    expect(b.prisma.ticket.findMany.mock.calls[0][0].where).toEqual(orgWhere);
  });

  it('getSummary: sem escopo e fail-closed (Forbidden); CLIENT com VIEW_ALL_TICKETS so le tudo com a flag ligada', async () => {
    const closed = build({ 'u-x': [] });
    await expect(closed.service.getSummary(actor('SPY' as Role))).rejects.toThrow(ForbiddenException);
    expect(closed.prisma.ticket.findMany).not.toHaveBeenCalled();
    const wide = build({ 'u-x': [K.TICKETS_ALL] });
    await swallow(wide.service.getSummary(actor(Role.CLIENT)));
    expect(wide.prisma.ticket.findMany.mock.calls[0][0].where).toEqual(flagOn ? {} : { requesterId: 'u-x' });
  });
});

describe.each(modes)('CommercialReportsService.getCommercial (%s): escopo de chamados no relatorio', (_label, flagOn) => {
  const run = async (user: ReturnType<typeof actor>, grants: string[]) => {
    const contract = { id: 'k1', organization: { name: 'o' }, terms: [], lifecycleEvents: [] };
    const prisma: any = {
      contract: { findMany: jest.fn().mockResolvedValue([contract]) },
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const effective = new Set(grants);
    const permissions: any = {
      hasPermission: jest.fn(async (_id: string, key: string) => effective.has(key)),
      canViewTicketValues: jest.fn(async () => true),
    };
    const flags: any = { isRbacPermissionOnly: () => flagOn };
    const service = new CommercialReportsService(prisma, permissions, flags, scopeOf(flagOn, { [user.id]: grants }));
    await service.getCommercial(user as any, { contractId: 'k1' }).catch(() => undefined);
    return prisma;
  };

  it('ADMIN com o grupo padrao: sem filtro de chamados nos dois modos', async () => {
    const prisma = await run(actor(Role.ADMIN, 'org-a'), ['VIEW_COMMERCIAL_RESULT', K.TICKETS_ALL, K.TICKETS_OWN]);
    expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
  });

  it('quem tem o resultado comercial mas so VIEW_OWN_TICKETS: so a flag ligada restringe aos proprios', async () => {
    const prisma = await run(actor(Role.ADMIN, 'org-a'), ['VIEW_COMMERCIAL_RESULT', K.TICKETS_OWN]);
    const where = prisma.worklog.findMany.mock.calls[0][0].where.ticket;
    expect(where).toEqual(flagOn ? { requesterId: 'u-x' } : {});
  });
});

describe.each(modes)('WorklogsService (%s): escopo de chamados nos apontamentos', (_label, flagOn) => {
  const build = (grants: string[]) => {
    const effective = new Set(grants);
    const prisma: any = {
      ticket: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction = jest.fn(async (cb: (db: any) => unknown) => cb(prisma));
    const permissions: any = {
      hasPermission: jest.fn(async () => true),
      canViewTicketValues: jest.fn(async () => true),
      getEffectivePermissions: jest.fn(async () => effective),
    };
    const flags: any = { isRbacPermissionOnly: () => flagOn };
    const service = new WorklogsService(prisma, {} as any, {} as any, permissions, flags, {} as any, undefined, scopeOf(flagOn, { 'u-x': grants }));
    return { prisma, service };
  };
  const dto = { startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T11:00:00Z' } as any;
  const callers: Array<[string, (s: WorklogsService, u: any) => Promise<unknown>]> = [
    ['create', (s, u) => s.create('t1', dto, u)],
    ['eligibleContracts', (s, u) => s.eligibleContracts('t1', dto.startTime, dto.endTime, u)],
    ['findByTicket', (s, u) => s.findByTicket('t1', u)],
    ['createPreAppointment', (s, u) => s.createPreAppointment('t1', { startTime: dto.startTime } as any, u)],
    ['findPreAppointments', (s, u) => s.findPreAppointments('t1', u)],
  ];

  it.each(callers)('%s: CLIENT_MASTER de A so enxerga chamados de A (nunca de B)', async (name, call) => {
    const { prisma, service } = build(masterGrants['u-x']);
    if (!flagOn && name === 'eligibleContracts') {
      // desligada, o CLIENT_MASTER nem opera apontamentos: barrado antes de consultar o chamado
      await expect(call(service, masterOrgA)).rejects.toThrow(ForbiddenException);
      expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
      return;
    }
    await expect(call(service, masterOrgA)).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findUnique.mock.calls[0][0].where).toEqual({ id: 't1', AND: [orgWhere] });
  });

  it.each(callers)('%s: AGENT com o grupo padrao so enxerga mesas com vinculo', async (_name, call) => {
    const agent = actor(Role.AGENT);
    const { prisma, service } = build([K.TICKETS_DESKS, 'CREATE_EDIT_WORKLOGS']);
    await expect(call(service, agent)).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findUnique.mock.calls[0][0].where).toEqual({ id: 't1', AND: [TenantHelper.getTicketWhere(agent)] });
  });

  it.each(callers)('%s: ADMIN sem chave de escopo so e barrado com a flag ligada (UUID zero)', async (_name, call) => {
    const { prisma, service } = build([]);
    await expect(call(service, actor(Role.ADMIN, 'org-a'))).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findUnique.mock.calls[0][0].where).toEqual({ id: 't1', AND: [flagOn ? { id: ZERO } : {}] });
  });
});

describe('callers sem ScopeAccess (specs que montam o service a mao): where do TenantHelper, como hoje', () => {
  const agent = actor(Role.AGENT);
  const expected = TenantHelper.getTicketWhere(agent);

  it('WorklogsService.findByTicket', async () => {
    const prisma: any = { ticket: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new WorklogsService(prisma, {} as any, {} as any, {} as any, { isRbacPermissionOnly: () => false } as any, {} as any);
    await expect(service.findByTicket('t1', agent)).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findUnique.mock.calls[0][0].where).toEqual({ id: 't1', AND: [expected] });
  });

  it('AgendaService.create com chamado', async () => {
    const prisma: any = { ticket: { findFirst: jest.fn().mockResolvedValue(null) } };
    const access = { canManageSchedules: async () => false, isOrganizationScoped: async () => false };
    const service = new AgendaService(prisma, {} as any, access as any);
    const dto = { ticketId: 't1', startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T11:00:00Z' } as any;
    await expect(service.create(dto, agent)).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findFirst.mock.calls[0][0].where).toEqual({ id: 't1', ...expected });
  });

  it('ReportsService.getSummary', async () => {
    const prisma: any = {
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
      serviceDesk: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ReportsService(prisma, {} as any, { isRbacPermissionOnly: () => false } as any);
    await service.getSummary(agent).catch(() => undefined);
    expect(prisma.ticket.findMany.mock.calls[0][0].where).toEqual(expected);
  });

  it('CommercialReportsService.getCommercial', async () => {
    const prisma: any = {
      contract: { findMany: jest.fn().mockResolvedValue([{ id: 'k1', organization: { name: 'o' }, terms: [], lifecycleEvents: [] }]) },
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const permissions: any = { canViewTicketValues: async () => true };
    const service = new CommercialReportsService(prisma, permissions, { isRbacPermissionOnly: () => false } as any);
    await service.getCommercial(actor(Role.ADMIN, 'org-a') as any, { contractId: 'k1' }).catch(() => undefined);
    expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
  });
});
