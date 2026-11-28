import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { TicketTransitionAccess } from './ticket-transition-access';
import { legacyMaskAccess } from '../comments/mask-access.testing';
import { DEFAULT_PERMISSION_GROUPS } from '../permission-groups/default-permission-groups';

/**
 * Lote 2f (#550): reabertura de chamado fechado (changeStatus e allowedStatuses do findOne)
 * nos dois modos da flag `rbac-permission-only`, com os grupos padrao reais.
 */
const S = TicketStatus;
const roles = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT] as const;
const modes = [
  ['flag desligada', false],
  ['flag ligada', true],
] as const;
const user = (role: Role) => ({ id: `u-${role}`, role, organizationId: 'org-1' });
const defaultGrants = () => Object.fromEntries(roles.map((role) => [`u-${role}`, DEFAULT_PERMISSION_GROUPS[role].permissions]));
const deskRow = (extra: Record<string, unknown> = {}) => ({
  id: 'desk-1',
  allowCrossDeskInteraction: true,
  allowReopenUnbilled: true,
  allowReopenBilled: true,
  allowPauseResumeSla: true,
  listedGroupsOnly: false,
  agents: [],
  agentGroups: [],
  reopenDefaultReplyUnbilled: 'Reaberto sem faturamento',
  reopenDefaultReplyBilled: 'Reaberto faturado',
  ...extra,
});

const setup = (flagOn: boolean, grants: Record<string, string[]> = defaultGrants(), desk: unknown = null) => {
  const prisma: any = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue({ id: 't1', status: S.CLOSED, serviceDeskId: 'desk-1', requesterId: 'u-x', requester: { organizationId: 'org-1' }, serviceDesk: desk }),
      update: jest.fn(async ({ data }: any) => ({ id: 't1', ...data, requester: { email: 'a@b.c' } })),
    },
    serviceDesk: { findUnique: jest.fn().mockResolvedValue(desk) },
    worklog: { findMany: jest.fn().mockResolvedValue([]) },
    ticketAudit: { create: jest.fn() },
    comment: { create: jest.fn() },
  };
  const permissions = { hasPermission: jest.fn(async (id: string, ...keys: string[]) => (grants[id] ?? []).some((k) => keys.includes(k))) };
  const access = new TicketTransitionAccess({ isRbacPermissionOnly: () => flagOn } as any, permissions as any);
  return { prisma, service: new TicketsService(prisma, { emit: jest.fn() } as any, legacyMaskAccess(), access) };
};

describe.each(modes)('reabertura de chamado fechado com grupos padrao: %s', (_label, flagOn) => {
  it.each(roles)('%s: changeStatus CLOSED -> OPEN so passa para ADMIN', async (role) => {
    const { service, prisma } = setup(flagOn);
    if (role === Role.ADMIN) {
      await expect(service.changeStatus('t1', S.OPEN, user(role))).resolves.toMatchObject({ status: S.OPEN });
      expect(prisma.ticket.update.mock.calls[0][0].data).toMatchObject({ status: S.OPEN, closedAt: null });
    } else {
      await expect(service.changeStatus('t1', S.OPEN, user(role))).rejects.toThrow(BadRequestException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    }
  });

  it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER])('%s: allowedStatuses de CLOSED so tem OPEN para ADMIN', async (role) => {
    const { service } = setup(flagOn, defaultGrants(), deskRow());
    const result = (await service.findOne('t1', user(role))) as unknown as { allowedStatuses: TicketStatus[] };
    expect(result.allowedStatuses).toEqual(role === Role.ADMIN ? [S.OPEN] : []);
  });

  it('o CLIENT segue sem allowedStatuses', async () => {
    const { service, prisma } = setup(flagOn);
    prisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: S.CLOSED, requesterId: 'u-CLIENT', requester: { organizationId: 'org-1' }, serviceDesk: null });
    const result = (await service.findOne('t1', user(Role.CLIENT))) as unknown as { allowedStatuses?: unknown };
    expect(result.allowedStatuses).toBeUndefined();
  });
});

describe('reabertura com flag ligada: so a permissao decide', () => {
  it('AGENT com REVIEW_REOPEN_CLOSED_TICKETS reabre e o allowedStatuses lista OPEN', async () => {
    const grants = { 'u-AGENT': ['REVIEW_REOPEN_CLOSED_TICKETS', 'EDIT_TICKETS'] };
    const { service, prisma } = setup(true, grants, deskRow());
    const listed = (await service.findOne('t1', user(Role.AGENT))) as unknown as { allowedStatuses: TicketStatus[] };
    expect(listed.allowedStatuses).toEqual([S.OPEN]);
    await expect(service.changeStatus('t1', S.OPEN, user(Role.AGENT))).resolves.toMatchObject({ status: S.OPEN });
    expect(prisma.ticket.update.mock.calls[0][0].data).toMatchObject({ closedAt: null });
  });

  it('ADMIN sem REVIEW_REOPEN_CLOSED_TICKETS nao reabre nem recebe OPEN', async () => {
    const { service } = setup(true, { 'u-ADMIN': ['EDIT_TICKETS'] }, deskRow());
    const listed = (await service.findOne('t1', user(Role.ADMIN))) as unknown as { allowedStatuses: TicketStatus[] };
    expect(listed.allowedStatuses).toEqual([]);
    await expect(service.changeStatus('t1', S.OPEN, user(Role.ADMIN))).rejects.toThrow(BadRequestException);
  });

  it('com mesa: a trava de faturado e a resposta padrao seguem a reabertura por permissao', async () => {
    const grants = { 'u-AGENT': ['REVIEW_REOPEN_CLOSED_TICKETS'] };
    const blocked = setup(true, grants, deskRow({ allowReopenBilled: false }));
    blocked.prisma.worklog.findMany.mockResolvedValue([{ billable: true, valuationType: 'FIXED', value: 100 }]);
    await expect(blocked.service.changeStatus('t1', S.OPEN, user(Role.AGENT))).rejects.toThrow(ForbiddenException);
    expect(blocked.prisma.ticket.update).not.toHaveBeenCalled();

    const open = setup(true, grants, deskRow());
    await open.service.changeStatus('t1', S.OPEN, user(Role.AGENT));
    expect(open.prisma.comment.create.mock.calls[0][0].data).toMatchObject({ content: 'Reaberto sem faturamento', authorId: 'u-AGENT' });
  });
});

describe('reabertura com flag desligada: so o perfil decide', () => {
  it('AGENT com REVIEW_REOPEN_CLOSED_TICKETS segue sem reabrir', async () => {
    const { service } = setup(false, { 'u-AGENT': ['REVIEW_REOPEN_CLOSED_TICKETS'] });
    await expect(service.changeStatus('t1', S.OPEN, user(Role.AGENT))).rejects.toThrow(BadRequestException);
  });

  it('ADMIN sem a permissao reabre e a resposta padrao da mesa e gravada', async () => {
    const { service, prisma } = setup(false, { 'u-ADMIN': [] }, deskRow());
    await service.changeStatus('t1', S.OPEN, user(Role.ADMIN));
    expect(prisma.comment.create.mock.calls[0][0].data).toMatchObject({ content: 'Reaberto sem faturamento' });
  });
});

describe('reabertura: o que so vale quando a reabertura e permitida', () => {
  it('flag ligada, ADMIN sem a permissao: nem consulta apontamentos nem grava resposta padrao', async () => {
    const { service, prisma } = setup(true, { 'u-ADMIN': [] }, deskRow());
    await expect(service.changeStatus('t1', S.OPEN, user(Role.ADMIN))).rejects.toThrow(BadRequestException);
    expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it.each(modes)('%s: transicao comum com mesa nao consulta apontamentos nem grava resposta de reabertura', async (_label, flagOn) => {
    const { service, prisma } = setup(flagOn, defaultGrants(), deskRow());
    prisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: S.OPEN, serviceDeskId: 'desk-1' });
    await service.changeStatus('t1', S.IN_PROGRESS, user(Role.ADMIN));
    expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('flag ligada: o allowedStatuses respeita a trava de faturado da mesa para quem reabre por permissao', async () => {
    const grants = { 'u-AGENT': ['REVIEW_REOPEN_CLOSED_TICKETS'] };
    const blocked = setup(true, grants, deskRow({ allowReopenBilled: false }));
    blocked.prisma.worklog.findMany.mockResolvedValue([{ billable: true, valuationType: 'FIXED', value: 100 }]);
    const result = (await blocked.service.findOne('t1', user(Role.AGENT))) as unknown as { allowedStatuses: TicketStatus[] };
    expect(result.allowedStatuses).toEqual([]);
    expect(blocked.prisma.worklog.findMany).toHaveBeenCalled();
  });

  it('flag ligada, ADMIN sem a permissao: o findOne nao consulta apontamentos', async () => {
    const { service, prisma } = setup(true, { 'u-ADMIN': [] }, deskRow());
    await service.findOne('t1', user(Role.ADMIN));
    expect(prisma.worklog.findMany).not.toHaveBeenCalled();
  });
});
