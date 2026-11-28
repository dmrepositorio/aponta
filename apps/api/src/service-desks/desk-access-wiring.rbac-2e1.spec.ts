import { ForbiddenException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { CommentsService } from '../comments/comments.service';
import { legacyMaskAccess } from '../comments/mask-access.testing';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';
import { assertStatusChangeAllowed } from '../tickets/ticket-status-transitions';
import { TicketsService } from '../tickets/tickets.service';
import { legacyTransitionAccess } from '../tickets/ticket-transition-access.testing';
import { WorklogsService } from '../worklogs/worklogs.service';
import { DeskAccess } from './desk-access';
import type { DeskActor } from './desk-policy';

/**
 * Lote 2e1 do tracker #523 (#549): os callers de assertListedAgentMayMutate passam o ator da
 * mesa (DeskAccess). Flag desligada: por perfil (hoje). Ligada: so por permissao, sem olhar
 * `User.role`. A mesa so para listados (`listedGroupsOnly`) e o caso que separa os dois modos.
 */
const REACHED = 'passou da trava de mesa';
const NOT_LISTED = /Somente grupos ou agentes vinculados/;

const ALL = 'VIEW_ALL_SERVICE_DESKS';
const ASSIGNED = 'VIEW_ASSIGNED_SERVICE_DESKS';
const INTERNAL = 'POST_INTERNAL_NOTES';
const OPERATE = 'CREATE_EDIT_WORKLOGS';

const listedOnlyDesk = (agentIds: string[] = []) => ({
  listedGroupsOnly: true,
  agents: agentIds.map((id) => ({ id })),
  agentGroups: [],
  allowCancelTicket: true,
});

const deskAccessOf = (flagOn: boolean, grants: Record<string, string[]>) =>
  new DeskAccess(
    { isRbacPermissionOnly: () => flagOn } as any,
    { getEffectivePermissions: jest.fn(async (id: string) => new Set(grants[id] ?? [])) } as any,
  );

const actor = (role: Role, id = 'u-x') => ({ id, role, organizationId: 'org-a' });

const sentinel = () => jest.fn(async () => {
  throw new Error(REACHED);
});

describe.each([
  ['comentario interno', async (flagOn: boolean, grants: Record<string, string[]>, role: Role, desk: any) => {
    const comment = { create: jest.fn(async () => { throw new Error(REACHED); }) };
    const prisma: any = {
      ticket: { findUnique: jest.fn(async () => ({ id: 't1', requesterId: 'u-x', serviceDesk: desk })) },
      comment,
    };
    const permissions: any = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
    const { MaskAccess } = await import('../comments/mask-access');
    const mask = new MaskAccess({ isRbacPermissionOnly: () => true } as any, permissions);
    const service = new CommentsService(prisma, { emit: jest.fn() } as any, mask, deskAccessOf(flagOn, grants));
    return () => service.create('t1', { content: 'n', isInternal: true }, actor(role));
  }],
  ['tickets.cancel', async (flagOn: boolean, grants: Record<string, string[]>, role: Role, desk: any) => {
    const prisma: any = {
      ticket: { findUnique: jest.fn(async () => ({ id: 't1', status: TicketStatus.OPEN, serviceDeskId: 'd1' })), update: sentinel() },
      serviceDesk: { findUnique: jest.fn(async () => desk) },
    };
    const service = new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return () => service.cancel('t1', actor(role));
  }],
  ['tickets.changeStage', async (flagOn: boolean, grants: Record<string, string[]>, role: Role, desk: any) => {
    const prisma: any = {
      ticket: { findUnique: jest.fn(async () => ({ id: 't1', status: TicketStatus.OPEN, serviceDeskId: 'd1' })) },
      serviceDesk: { findUnique: jest.fn(async () => desk) },
      ticketStage: { findFirst: sentinel() },
    };
    const service = new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return () => service.changeStage('t1', 's1', actor(role));
  }],
  ['worklogs.findPreAppointments', async (flagOn: boolean, grants: Record<string, string[]>, role: Role, desk: any) => {
    const prisma: any = {
      ticket: { findUnique: jest.fn(async () => ({ id: 't1', serviceDesk: desk })) },
      preAppointment: { findMany: sentinel() },
    };
    const permissions: any = {
      hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))),
      getEffectivePermissions: jest.fn(async (id: string) => new Set(grants[id] ?? [])),
    };
    const service = new WorklogsService(
      prisma, {} as any, {} as any, permissions, { isRbacPermissionOnly: () => flagOn } as any, {} as any, deskAccessOf(flagOn, grants),
    );
    return () => service.findPreAppointments('t1', actor(role));
  }],
] as const)('%s', (_name, build) => {
  const base = [INTERNAL, OPERATE];

  it('flag ligada, AGENT com escopo de todas as mesas nao fica preso a lista (so a permissao decide)', async () => {
    const run = await build(true, { 'u-x': [...base, ALL] }, Role.AGENT, listedOnlyDesk());
    await expect(run()).rejects.toThrow(REACHED);
  });

  it('flag desligada, o mesmo AGENT decide por perfil (escopo ASSIGNED) e fica preso a lista', async () => {
    const run = await build(false, { 'u-x': [...base, ALL] }, Role.AGENT, listedOnlyDesk());
    await expect(run()).rejects.toThrow(NOT_LISTED);
  });

  it('flag ligada, usuario com perfil CLIENT mas escopo de mesas em que atua fica preso a lista', async () => {
    const run = await build(true, { 'u-x': [...base, ASSIGNED] }, Role.CLIENT, listedOnlyDesk());
    await expect(run()).rejects.toThrow(NOT_LISTED);
  });

  it('flag ligada, escopo de mesas em que atua e listado na mesa: passa', async () => {
    const run = await build(true, { 'u-x': [...base, ASSIGNED] }, Role.AGENT, listedOnlyDesk(['u-x']));
    await expect(run()).rejects.toThrow(REACHED);
  });

  it('flag ligada com o grupo padrao do AGENT: igual a hoje (preso a lista)', async () => {
    const run = await build(true, { 'u-x': DEFAULT_PERMISSION_GROUPS[Role.AGENT].permissions }, Role.AGENT, listedOnlyDesk());
    await expect(run()).rejects.toThrow(NOT_LISTED);
  });

  it('flag ligada com o grupo padrao do ADMIN: nao fica preso (todas as mesas)', async () => {
    const run = await build(true, { 'u-x': DEFAULT_PERMISSION_GROUPS[Role.ADMIN].permissions }, Role.ADMIN, listedOnlyDesk());
    await expect(run()).rejects.toThrow(REACHED);
  });

  it('flag ligada sem nenhuma chave de escopo de mesas: nao fica preso (so o escopo ASSIGNED e travado)', async () => {
    const run = await build(true, { 'u-x': base }, Role.AGENT, listedOnlyDesk());
    await expect(run()).rejects.toThrow(REACHED);
  });
});

describe('assertStatusChangeAllowed: ator da mesa', () => {
  const desk: any = {
    ...listedOnlyDesk(),
    allowPauseResumeSla: true,
    allowReopenUnbilled: true,
    allowReopenBilled: true,
  };
  const check = (role: Role, deskActor?: DeskActor) => () =>
    assertStatusChangeAllowed({
      desk,
      user: { id: 'u-x', role },
      from: TicketStatus.OPEN,
      to: TicketStatus.IN_PROGRESS,
      billed: false,
      deskActor,
    });

  it('sem ator, decide pelo perfil: AGENT preso a lista, ADMIN livre', () => {
    expect(check(Role.AGENT)).toThrow(ForbiddenException);
    expect(check(Role.ADMIN)).not.toThrow();
  });

  it('com ator de escopo ASSIGNED, o perfil ADMIN tambem fica preso a lista', () => {
    expect(check(Role.ADMIN, { canUseInternalDesks: true, scope: 'ASSIGNED' })).toThrow(NOT_LISTED);
  });

  it('com ator de escopo ALL, o perfil AGENT nao fica preso a lista', () => {
    expect(check(Role.AGENT, { canUseInternalDesks: true, scope: 'ALL' })).not.toThrow();
  });
});

/**
 * Demais callers do ator da mesa. Aqui o prisma e estrito: qualquer acesso nao previsto lanca
 * REACHED; o que importa e se a trava de lista (mensagem NOT_LISTED / acesso de criacao) dispara.
 */
const NOT_LISTED_ANY = /Somente grupos ou agentes vinculados|Você não tem acesso para criar tickets/;
const strict = (overrides: Record<string, any>) =>
  new Proxy(overrides, {
    get: (target, prop: string) =>
      prop in target
        ? target[prop]
        : new Proxy({}, { get: () => async () => { throw new Error(REACHED); } }),
  }) as any;
const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};
const deskRow = (agentIds: string[] = []) => ({
  ...listedOnlyDesk(agentIds),
  active: true,
  acceptingNewTickets: true,
  internalUse: false,
  openByAgentsOnly: false,
  unlistedCanCreateTicket: false,
  allowAddSlaHours: true,
  slaControlEnabled: true,
  allowPauseResumeSla: true,
  allowReopenUnbilled: true,
  allowReopenBilled: true,
  priorities: [],
  stages: [],
  agentGroups: [],
});
const ticketRow = { id: 't1', status: TicketStatus.OPEN, serviceDeskId: 'd1', requesterId: 'u-r' };

const others: Array<[string, (flagOn: boolean, grants: Record<string, string[]>, role: Role) => () => Promise<unknown>]> = [
  ['tickets.update', (flagOn, grants, role) => {
    const prisma = strict({
      ticket: { findUnique: async () => ticketRow },
      serviceDesk: { findUnique: async () => deskRow() },
    });
    const service = new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return () => service.update('t1', { title: 'novo' } as any, actor(role));
  }],
  ['tickets.addSlaHours', (flagOn, grants, role) => {
    const prisma = strict({
      ticket: { findUnique: async () => ticketRow },
      serviceDesk: { findUnique: async () => deskRow() },
    });
    const service = new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return () => service.addSlaHours('t1', 2, actor(role));
  }],
  ['tickets.changeStatus', (flagOn, grants, role) => {
    const prisma = strict({
      ticket: { findUnique: async () => ticketRow },
      serviceDesk: { findUnique: async () => deskRow() },
    });
    const service = new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return () => service.changeStatus('t1', TicketStatus.IN_PROGRESS, actor(role));
  }],
  ['tickets.allowedStatuses (leitura)', (flagOn, grants, role) => {
    const service = new TicketsService(strict({}), { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return async () => {
      const list: TicketStatus[] = await (service as any).allowedStatusesForReader({ ...ticketRow, serviceDesk: deskRow() }, actor(role));
      if (list.length === 0) throw new Error('Somente grupos ou agentes vinculados (lista vazia)');
    };
  }],
  ['tickets.create', (flagOn, grants, role) => {
    const prisma = strict({
      serviceDesk: { findUnique: async () => deskRow() },
      businessHour: { findMany: async () => [] },
      holiday: { findMany: async () => [] },
      user: { findUnique: async () => ({ name: 'n', email: 'e@x', phone: null, extension: null }) },
    });
    const service = new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return () => service.create({ title: 't', description: 'd', serviceDeskId: 'd1' } as any, actor(role));
  }],
  ['worklogs.create', (flagOn, grants, role) => {
    const prisma = strict({ ticket: { findUnique: async () => ({ id: 't1', serviceDesk: listedOnlyDesk(), requester: {} }) } });
    const service = worklogsOf(prisma, flagOn, grants);
    return () => service.create('t1', { startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z' } as any, actor(role));
  }],
  ['worklogs.eligibleContracts (contexto comercial)', (flagOn, grants, role) => {
    const db = strict({
      $queryRaw: async () => [],
      ticket: { findUnique: async () => ({ id: 't1', serviceDeskId: 'd1', serviceDesk: listedOnlyDesk(), commercialOrganizationId: null }) },
    });
    const prisma = strict({ $transaction: async (cb: any) => cb(db) });
    const service = worklogsOf(prisma, flagOn, grants, { canViewTicketValues: async () => true });
    return () => service.eligibleContracts('t1', '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', actor(role));
  }],
];

function worklogsOf(prisma: any, flagOn: boolean, grants: Record<string, string[]>, extra: Record<string, unknown> = {}) {
  const permissions: any = {
    hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))),
    getEffectivePermissions: jest.fn(async (id: string) => new Set(grants[id] ?? [])),
    ...extra,
  };
  return new WorklogsService(prisma, {} as any, {} as any, permissions, { isRbacPermissionOnly: () => flagOn } as any, {} as any, deskAccessOf(flagOn, grants));
}

describe.each(others)('%s: ator da mesa', (_name, build) => {
  const base = [OPERATE, 'EDIT_TICKETS', 'VIEW_AND_OPEN_TICKETS'];

  it('flag desligada: AGENT decide por perfil (escopo ASSIGNED) e fica preso a lista', async () => {
    expect(await failure(build(false, { 'u-x': [...base, ALL] }, Role.AGENT))).toMatch(NOT_LISTED_ANY);
  });

  it('flag ligada: AGENT com escopo de todas as mesas nao fica preso a lista', async () => {
    expect(await failure(build(true, { 'u-x': [...base, ALL] }, Role.AGENT))).not.toMatch(NOT_LISTED_ANY);
  });

  it('flag ligada: perfil ADMIN com escopo de mesas em que atua fica preso a lista', async () => {
    expect(await failure(build(true, { 'u-x': [...base, ASSIGNED] }, Role.ADMIN))).toMatch(NOT_LISTED_ANY);
  });
});

/**
 * A copia transacional (`withTransaction`) usada pelo WorklogsService (changeStage e create de
 * comentario) tem de carregar o DeskAccess: sem ele o ator fica `undefined` e a trava de mesa
 * volta a decidir por `User.role` mesmo com a flag ligada.
 */
describe('withTransaction propaga o DeskAccess', () => {
  const ticketsInTx = (flagOn: boolean, grants: Record<string, string[]>) => {
    const prisma: any = strict({
      ticket: { findUnique: async () => ticketRow },
      serviceDesk: { findUnique: async () => deskRow() },
    });
    const root = new TicketsService(strict({}), { emit: jest.fn() } as any, legacyMaskAccess(), legacyTransitionAccess(), deskAccessOf(flagOn, grants));
    return root.withTransaction(prisma, []);
  };
  const commentsInTx = async (flagOn: boolean, grants: Record<string, string[]>) => {
    const prisma: any = strict({
      ticket: { findUnique: async () => ({ id: 't1', requesterId: 'u-x', serviceDesk: listedOnlyDesk() }) },
    });
    const { MaskAccess } = await import('../comments/mask-access');
    const permissions: any = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
    const mask = new MaskAccess({ isRbacPermissionOnly: () => true } as any, permissions);
    const root = new CommentsService(strict({}), { emit: jest.fn() } as any, mask, deskAccessOf(flagOn, grants));
    return root.withTransaction(prisma, []);
  };

  it('tickets: flag ligada com perfil ADMIN e escopo de mesas em que atua fica preso a lista (changeStage)', async () => {
    const tx = ticketsInTx(true, { 'u-x': [ASSIGNED] });
    expect(await failure(() => tx.changeStage('t1', 's1', actor(Role.ADMIN)))).toMatch(NOT_LISTED);
  });

  it('tickets: flag ligada com perfil AGENT e escopo de todas as mesas nao fica preso (changeStage)', async () => {
    const tx = ticketsInTx(true, { 'u-x': [ALL] });
    expect(await failure(() => tx.changeStage('t1', 's1', actor(Role.AGENT)))).toBe(REACHED);
  });

  it('comentarios: flag ligada com perfil CLIENT e escopo de mesas em que atua fica preso a lista (create)', async () => {
    const tx = await commentsInTx(true, { 'u-x': [INTERNAL, ASSIGNED] });
    expect(await failure(() => tx.create('t1', { content: 'n', isInternal: true }, actor(Role.CLIENT)))).toMatch(NOT_LISTED);
  });

  it('comentarios: flag ligada com perfil AGENT e escopo de todas as mesas nao fica preso (create)', async () => {
    const tx = await commentsInTx(true, { 'u-x': [INTERNAL, ALL] });
    expect(await failure(() => tx.create('t1', { content: 'n', isInternal: true }, actor(Role.AGENT)))).toBe(REACHED);
  });
});
