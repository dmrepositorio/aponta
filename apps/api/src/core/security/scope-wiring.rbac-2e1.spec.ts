import { ForbiddenException } from '@nestjs/common';
import { AppointmentType, Role } from '@prisma/client';
import { AgendaService } from '../../agenda/agenda.service';
import { ContractsService } from '../../contracts/contracts.service';
import { ReportsService } from '../../reports/reports.service';
import { ServiceDesksService } from '../../service-desks/service-desks.service';
import { UserAccess } from '../../users/user-access';
import { UsersService } from '../../users/users.service';
import { VaultService } from '../../vault/vault.service';
import { ScopeAccess } from './scope-access';
import { SCOPE_KEYS } from './scope-resolver';
import { TenantHelper } from './tenant.helper';

/**
 * Lote 2e1 do tracker #523 (#549): os callers de mesas, credenciais, contratos e agenda usam o
 * ScopeAccess. Flag desligada: o `where` enviado ao banco e o do TenantHelper (por perfil).
 * Ligada: o do ScopeResolver com as permissoes do usuario, sem olhar `User.role`.
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

// Um `await` esquecido na checagem de acesso deixaria a promessa rejeitada solta: sem este
// listener o worker do jest cai em vez de a asserção falhar. Cada teste confere que nada ficou solto.
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

describe.each(modes)('ServiceDesksService.findAll (%s)', (_label, flagOn) => {
  const run = async (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = { serviceDesk: { findMany: jest.fn().mockResolvedValue([]) } };
    await new ServiceDesksService(prisma, {} as any, scopeOf(flagOn, grants)).findAll(user);
    return prisma.serviceDesk.findMany.mock.calls[0][0].where;
  };

  it('perfil CLIENT_MASTER com grupo padrao: mesas da organizacao e as globais, nunca internas', async () => {
    const user = actor(Role.CLIENT_MASTER, 'org-a');
    const where = await run(user, { 'u-x': [K.SERVICE_DESKS_ORGANIZATION] });
    expect(where).toEqual(TenantHelper.getServiceDeskWhere(user));
    expect(where).toMatchObject({ active: true, acceptingNewTickets: true, internalUse: false });
  });

  it('CLIENT com VIEW_ALL_SERVICE_DESKS: so a flag ligada segue a permissao', async () => {
    const user = actor(Role.CLIENT, 'org-a');
    const where = await run(user, { 'u-x': [K.SERVICE_DESKS_ALL] });
    expect(where).toEqual(flagOn ? {} : TenantHelper.getServiceDeskWhere(user));
  });

  it('ADMIN sem chave de escopo: so a flag ligada fecha tudo (fail-closed)', async () => {
    const where = await run(actor(Role.ADMIN, 'org-a'), { 'u-x': [] });
    expect(where).toEqual(flagOn ? { id: ZERO } : {});
  });
});

describe.each(modes)('VaultService (%s): escopo de credenciais', (_label, flagOn) => {
  const run = (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = { credentialFolder: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new VaultService(prisma, {} as any, scopeOf(flagOn, grants));
    return { prisma, call: () => service.findFolders(user) };
  };

  it('AGENT com o grupo padrao le o cofre', async () => {
    const { call, prisma } = run(actor(Role.AGENT), { 'u-x': [K.CREDENTIALS_ALL] });
    await call();
    expect(prisma.credentialFolder.findMany).toHaveBeenCalled();
  });

  it('CLIENT e CLIENT_MASTER com o grupo padrao sao barrados', async () => {
    for (const role of [Role.CLIENT, Role.CLIENT_MASTER]) {
      const { call, prisma } = run(actor(role, 'org-a'), { 'u-x': [K.TICKETS_OWN, K.SERVICE_DESKS_ORGANIZATION] });
      await expect(call()).rejects.toThrow(ForbiddenException);
      expect(prisma.credentialFolder.findMany).not.toHaveBeenCalled();
    }
  });

  it('CLIENT barrado tambem em findCredentials e reveal, sem tocar no banco', async () => {
    const prisma: any = {
      credential: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
      credentialFolder: { findMany: jest.fn() },
    };
    const service = new VaultService(prisma, {} as any, scopeOf(flagOn, { 'u-x': [K.TICKETS_OWN] }));
    const client = actor(Role.CLIENT, 'org-a');
    await expect(service.findCredentials({} as any, client)).rejects.toThrow(ForbiddenException);
    await expect(service.reveal('c1', {} as any, client)).rejects.toThrow(ForbiddenException);
    expect(prisma.credential.findMany).not.toHaveBeenCalled();
    expect(prisma.credential.findFirst).not.toHaveBeenCalled();
  });

  it('CLIENT com VIEW_ALL_CREDENTIALS: so a flag ligada libera', async () => {
    const { call } = run(actor(Role.CLIENT, 'org-a'), { 'u-x': [K.CREDENTIALS_ALL] });
    if (flagOn) await expect(call()).resolves.toEqual([]);
    else await expect(call()).rejects.toThrow(ForbiddenException);
  });

  it('AGENT sem VIEW_ALL_CREDENTIALS: so a flag ligada barra', async () => {
    const { call } = run(actor(Role.AGENT), { 'u-x': [K.TICKETS_DESKS] });
    if (flagOn) await expect(call()).rejects.toThrow(ForbiddenException);
    else await expect(call()).resolves.toEqual([]);
  });
});

describe.each(modes)('ContractsService (%s): escopo de contratos', (_label, flagOn) => {
  const run = (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = {
      contract: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ContractsService(prisma, { canViewFinancials: async () => true } as any, scopeOf(flagOn, grants));
    return { prisma, findAll: () => service.findAll(user), findOne: () => service.findOne('k1', user) };
  };

  it('CLIENT_MASTER de A com o grupo padrao: so contratos de A, em findAll e findOne', async () => {
    const { prisma, findAll, findOne } = run(actor(Role.CLIENT_MASTER, 'org-a'), { 'u-x': [K.CONTRACTS_ORGANIZATION] });
    await findAll();
    expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-a' });
    await findOne().catch(() => undefined);
    expect(prisma.contract.findFirst.mock.calls[0][0].where).toEqual({ organizationId: 'org-a', id: 'k1' });
  });

  it('CLIENT_MASTER sem organizacao e barrado nos dois modos', async () => {
    const { findAll, prisma } = run(actor(Role.CLIENT_MASTER, null), { 'u-x': [K.CONTRACTS_ORGANIZATION] });
    await expect(findAll()).rejects.toThrow(ForbiddenException);
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });

  it('findOne tambem barra quem nao tem escopo de contratos, sem consultar o banco', async () => {
    const { findOne, prisma } = run(actor(Role.CLIENT_MASTER, null), { 'u-x': [K.CONTRACTS_ORGANIZATION] });
    await expect(findOne()).rejects.toThrow(ForbiddenException);
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });

  it('CLIENT com VIEW_ORGANIZATION_CONTRACTS: so a flag ligada le os da organizacao', async () => {
    const { findAll, prisma } = run(actor(Role.CLIENT, 'org-a'), { 'u-x': [K.CONTRACTS_ORGANIZATION] });
    if (flagOn) {
      await findAll();
      expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-a' });
    } else {
      await expect(findAll()).rejects.toThrow(ForbiddenException);
    }
  });

  it('AGENT com o grupo padrao: contratos ativos de mesas com vinculo', async () => {
    const { findAll, prisma } = run(actor(Role.AGENT), { 'u-x': [K.CONTRACTS_DESKS] });
    await findAll();
    expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual(TenantHelper.getContractWhere(actor(Role.AGENT)));
  });

  it('ADMIN sem chave de contratos: so a flag ligada barra', async () => {
    const { findAll } = run(actor(Role.ADMIN, 'org-a'), { 'u-x': [] });
    if (flagOn) await expect(findAll()).rejects.toThrow(ForbiddenException);
    else await expect(findAll()).resolves.toEqual([]);
  });
});

describe.each(modes)('AgendaService (%s): escopo de agenda', (_label, flagOn) => {
  const run = (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = {
      appointment: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AgendaService(prisma, {} as any, { canViewOtherUsers: async () => false } as any, scopeOf(flagOn, grants));
    return {
      prisma,
      findAll: () => service.findAll({} as any, user),
      findOne: () => service.findOne('a1', user).catch(() => undefined),
    };
  };

  it('CLIENT_MASTER de A com o grupo padrao: agenda de A sem ausencias, em findAll e findOne', async () => {
    const { prisma, findAll, findOne } = run(actor(Role.CLIENT_MASTER, 'org-a'), { 'u-x': [K.APPOINTMENTS_ORGANIZATION] });
    const expected = { organizationId: 'org-a', type: { not: AppointmentType.ABSENCE } };
    await findAll();
    expect(prisma.appointment.findMany.mock.calls[0][0].where).toMatchObject(expected);
    await findOne();
    expect(prisma.appointment.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'a1', ...expected });
  });

  it('CLIENT_MASTER sem organizacao: fail-closed nos dois modos', async () => {
    const { prisma, findAll } = run(actor(Role.CLIENT_MASTER, undefined), { 'u-x': [K.APPOINTMENTS_ORGANIZATION] });
    await findAll();
    expect(prisma.appointment.findMany.mock.calls[0][0].where).toMatchObject({ id: ZERO });
  });

  it('AGENT com o grupo padrao: so a propria agenda', async () => {
    const { prisma, findAll } = run(actor(Role.AGENT), { 'u-x': [K.APPOINTMENTS_OWN] });
    await findAll();
    expect(prisma.appointment.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u-x' });
  });

  it('AGENT com VIEW_ALL_APPOINTMENTS: so a flag ligada ve a agenda de todos', async () => {
    const { prisma, findAll } = run(actor(Role.AGENT), { 'u-x': [K.APPOINTMENTS_ALL] });
    await findAll();
    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    if (flagOn) expect(where.userId).toBeUndefined();
    else expect(where).toMatchObject({ userId: 'u-x' });
  });
});

describe.each(modes)('UsersService.findAgents (%s): mesas visiveis ao usuario', (_label, flagOn) => {
  const run = async (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = {
      serviceDesk: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new UsersService(prisma, new UserAccess({ isRbacPermissionOnly: () => false } as any), scopeOf(flagOn, grants));
    await service.findAgents(user);
    return prisma.serviceDesk.findMany.mock.calls[0][0].where;
  };

  it('AGENT com o grupo padrao: mesas em que atua', async () => {
    const user = actor(Role.AGENT);
    expect(await run(user, { 'u-x': [K.SERVICE_DESKS_ASSIGNED] })).toEqual(TenantHelper.getServiceDeskWhere(user));
  });

  it('AGENT com VIEW_ALL_SERVICE_DESKS: so a flag ligada enxerga todas as mesas', async () => {
    const user = actor(Role.AGENT);
    expect(await run(user, { 'u-x': [K.SERVICE_DESKS_ALL] })).toEqual(flagOn ? {} : TenantHelper.getServiceDeskWhere(user));
  });
});

describe.each(modes)('ReportsService.getSummary (%s): compromissos do dashboard', (_label, flagOn) => {
  const run = async (user: ReturnType<typeof actor>, grants: Record<string, string[]>) => {
    const prisma: any = {
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      serviceDesk: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ReportsService(prisma, {} as any, { isRbacPermissionOnly: () => false } as any, scopeOf(flagOn, grants));
    await service.getSummary(user);
    return prisma.appointment.findMany.mock.calls.map((c: any[]) => c[0].where);
  };

  it('CLIENT_MASTER de A com o grupo padrao: "todos" so da organizacao A', async () => {
    const calls = await run(actor(Role.CLIENT_MASTER, 'org-a'), { 'u-x': [K.APPOINTMENTS_ORGANIZATION, K.TICKETS_ORGANIZATION] });
    expect(calls[0]).toEqual({ userId: 'u-x' });
    expect(calls[1]).toEqual({ organizationId: 'org-a', type: { not: AppointmentType.ABSENCE } });
  });

  it('AGENT com VIEW_ALL_APPOINTMENTS: so a flag ligada ve todos os compromissos', async () => {
    const calls = await run(actor(Role.AGENT), { 'u-x': [K.APPOINTMENTS_ALL, K.TICKETS_DESKS] });
    expect(calls[1]).toEqual(flagOn ? {} : { userId: 'u-x' });
  });
});
