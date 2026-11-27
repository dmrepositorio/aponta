import { NotFoundException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

/**
 * Fase 0b-2 (#526), tracker #523: caracterização por perfil de
 * TicketsService.findOne (acesso e allowedStatuses) e do contato do solicitante
 * na listagem. Trava o comportamento ATUAL.
 */
const S = TicketStatus;
const ALL_ROLES: Role[] = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const user = (role: Role, extra: Partial<CurrentUserPayload> = {}): CurrentUserPayload => ({
  id: `${role.toLowerCase()}-1`,
  role,
  ...extra,
});

describe('TicketsService: findOne e listagem por perfil (caracterização)', () => {
  let prisma: {
    ticket: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    worklog: { findMany: jest.Mock };
  };
  let service: TicketsService;

  /** Mesa que o usuário NÃO integra (agents/agentGroups vêm filtrados por usuário e vazios). */
  const deskFor = (extra: Record<string, unknown> = {}) => ({
    id: 'desk-1',
    allowCrossDeskInteraction: false,
    allowReopenUnbilled: true,
    allowReopenBilled: true,
    allowPauseResumeSla: true,
    listedGroupsOnly: false,
    agents: [],
    agentGroups: [],
    ...extra,
  });
  const ticketRow = (extra: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    status: S.IN_PROGRESS,
    requesterId: 'someone-else',
    requester: { organizationId: 'org-b' },
    serviceDesk: deskFor(),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    responseDeadline: null,
    resolveDeadline: null,
    slaAccumulatedPauseTime: 0,
    slaPausedAt: null,
    ...extra,
  });
  const open = (role: Role, row: Record<string, unknown>, extra: Partial<CurrentUserPayload> = {}) => {
    prisma.ticket.findUnique.mockResolvedValue(ticketRow(row));
    return service.findOne('ticket-1', user(role, extra));
  };

  beforeEach(() => {
    prisma = {
      ticket: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new TicketsService(prisma as never, { emit: jest.fn() } as never);
  });

  describe('findOne: quem enxerga o chamado', () => {
    it('chamado inexistente: NotFound para todos os perfis', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);
      for (const role of ALL_ROLES) {
        await expect(service.findOne('x', user(role))).rejects.toThrow(NotFoundException);
      }
    });

    it('ADMIN abre qualquer chamado', async () => {
      await expect(open(Role.ADMIN, {})).resolves.toMatchObject({ id: 'ticket-1' });
    });

    it('CLIENT abre só o próprio; o de outro solicitante é NotFound', async () => {
      await expect(open(Role.CLIENT, { requesterId: 'client-1' })).resolves.toMatchObject({ id: 'ticket-1' });
      await expect(open(Role.CLIENT, {})).rejects.toThrow(NotFoundException);
      // a organização igual não basta para CLIENT
      await expect(
        open(Role.CLIENT, { requester: { organizationId: 'org-a' } }, { organizationId: 'org-a' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('CLIENT_MASTER abre o próprio e os da sua organização; de outra organização é NotFound', async () => {
      await expect(open(Role.CLIENT_MASTER, { requesterId: 'client_master-1' })).resolves.toBeDefined();
      await expect(
        open(Role.CLIENT_MASTER, { requester: { organizationId: 'org-a' } }, { organizationId: 'org-a' }),
      ).resolves.toBeDefined();
      await expect(
        open(Role.CLIENT_MASTER, { requester: { organizationId: 'org-b' } }, { organizationId: 'org-a' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('CLIENT_MASTER sem organização só abre o próprio (organização nula não casa)', async () => {
      await expect(
        open(Role.CLIENT_MASTER, { requester: { organizationId: null } }, { organizationId: null }),
      ).rejects.toThrow(NotFoundException);
      await expect(open(Role.CLIENT_MASTER, { requesterId: 'client_master-1' }, { organizationId: null })).resolves.toBeDefined();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])(
      '%s abre se integra a mesa (direto ou por grupo) ou se a mesa aceita interação entre mesas',
      async (role) => {
        await expect(open(role, { serviceDesk: deskFor({ agents: [{ id: user(role).id }] }) })).resolves.toBeDefined();
        await expect(
          open(role, { serviceDesk: deskFor({ agentGroups: [{ members: [{ id: user(role).id }] }] }) }),
        ).resolves.toBeDefined();
        await expect(open(role, { serviceDesk: deskFor({ allowCrossDeskInteraction: true }) })).resolves.toBeDefined();
      },
    );

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s fora da mesa e sem interação entre mesas recebe NotFound', async (role) => {
      await expect(open(role, {})).rejects.toThrow(NotFoundException);
      await expect(
        open(role, { serviceDesk: deskFor({ agentGroups: [{ members: [] }] }) }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s: chamado sem mesa é NotFound', async (role) => {
      await expect(open(role, { serviceDesk: null })).rejects.toThrow(NotFoundException);
    });

    it('a consulta do chamado filtra agents/agentGroups da mesa pelo usuário logado', async () => {
      await open(Role.AGENT, { serviceDesk: deskFor({ allowCrossDeskInteraction: true }) });
      const select = prisma.ticket.findUnique.mock.calls[0][0].include.serviceDesk.select;
      expect(select.agents).toEqual({ where: { id: 'agent-1' }, select: { id: true } });
      expect(select.agentGroups.select.members.where).toEqual({ id: 'agent-1' });
    });

    it('a resposta não vaza solicitante, agents nem agentGroups da mesa', async () => {
      const result = (await open(Role.ADMIN, { serviceDesk: deskFor({ agents: [{ id: 'z' }] }) })) as unknown as {
        requester?: unknown;
        serviceDesk: { agents?: unknown; agentGroups?: unknown };
      };
      expect(result.requester).toBeUndefined();
      expect(result.serviceDesk.agents).toBeUndefined();
      expect(result.serviceDesk.agentGroups).toBeUndefined();
    });
  });

  describe('findOne: allowedStatuses por perfil', () => {
    const statuses = async (role: Role, row: Record<string, unknown>, extra: Partial<CurrentUserPayload> = {}) =>
      ((await open(role, row, extra)) as unknown as { allowedStatuses?: TicketStatus[] }).allowedStatuses;

    it('CLIENT não recebe allowedStatuses (chave ausente)', async () => {
      const result = await open(Role.CLIENT, { requesterId: 'client-1' });
      expect('allowedStatuses' in result).toBe(false);
    });

    it('CLIENT_MASTER, que pode abrir o chamado, recebe allowedStatuses', async () => {
      expect(await statuses(Role.CLIENT_MASTER, { requesterId: 'client_master-1' })).toEqual(
        expect.arrayContaining([S.RESOLVED, S.PENDING_APPROVAL]),
      );
    });

    it('ADMIN e AGENT em IN_PROGRESS recebem as saídas da máquina', async () => {
      const row = { serviceDesk: deskFor({ agents: [{ id: 'agent-1' }] }) };
      const agent = await statuses(Role.AGENT, row);
      const admin = await statuses(Role.ADMIN, row);
      expect(agent).toEqual([S.RESOLVED, S.PENDING_CUSTOMER, S.PENDING_APPROVAL, S.ON_HOLD, S.PENDING_SANKHYA, S.ESCALATED]);
      expect(admin).toEqual(agent);
    });

    it('PENDING_APPROVAL: AGENT recebe lista vazia; AGENT_MASTER, ADMIN e CLIENT_MASTER recebem IN_PROGRESS e RESOLVED', async () => {
      const mk = (id: string) => ({ status: S.PENDING_APPROVAL, serviceDesk: deskFor({ agents: [{ id }] }) });
      expect(await statuses(Role.AGENT, mk('agent-1'))).toEqual([]);
      expect(await statuses(Role.AGENT_MASTER, mk('agent_master-1'))).toEqual([S.IN_PROGRESS, S.RESOLVED]);
      expect(await statuses(Role.ADMIN, mk('x'))).toEqual([S.IN_PROGRESS, S.RESOLVED]);
      expect(await statuses(Role.CLIENT_MASTER, { status: S.PENDING_APPROVAL, requesterId: 'client_master-1' })).toEqual([
        S.IN_PROGRESS,
        S.RESOLVED,
      ]);
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('AGENT_MASTER de qualquer organização recebe a liberação de PENDING_APPROVAL, sem checar organização', async () => {
      const row = { status: S.PENDING_APPROVAL, requester: { organizationId: 'org-b' }, serviceDesk: deskFor({ allowCrossDeskInteraction: true }) };
      expect(await statuses(Role.AGENT_MASTER, row, { organizationId: 'org-zzz' })).toEqual([S.IN_PROGRESS, S.RESOLVED]);
    });

    it('CLOSED: só ADMIN recebe OPEN, e a trava da mesa por faturamento entra na lista', async () => {
      const closed = (d: Record<string, unknown>) => ({ status: S.CLOSED, serviceDesk: deskFor(d) });
      expect(await statuses(Role.ADMIN, closed({}))).toEqual([S.OPEN]);
      expect(await statuses(Role.AGENT_MASTER, closed({ agents: [{ id: 'agent_master-1' }] }))).toEqual([]);
      expect(await statuses(Role.AGENT, closed({ agents: [{ id: 'agent-1' }] }))).toEqual([]);
      // ADMIN: o faturamento vem dos apontamentos não anulados
      prisma.worklog.findMany.mockResolvedValue([{ billable: true, valuationType: 'CONTRACT', value: 10 }]);
      expect(await statuses(Role.ADMIN, closed({ allowReopenBilled: false }))).toEqual([]);
      prisma.worklog.findMany.mockResolvedValue([]);
      expect(await statuses(Role.ADMIN, closed({ allowReopenBilled: false }))).toEqual([S.OPEN]);
      expect(await statuses(Role.ADMIN, closed({ allowReopenUnbilled: false }))).toEqual([]);
    });

    it('os apontamentos só são consultados para ADMIN em chamado CLOSED com mesa', async () => {
      await statuses(Role.ADMIN, { status: S.CLOSED });
      expect(prisma.worklog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.worklog.findMany.mock.calls[0][0]).toMatchObject({ where: { ticketId: 'ticket-1', voidedAt: null } });
      prisma.worklog.findMany.mockClear();
      await statuses(Role.ADMIN, { status: S.IN_PROGRESS });
      await statuses(Role.AGENT, { status: S.CLOSED, serviceDesk: deskFor({ agents: [{ id: 'agent-1' }] }) });
      await statuses(Role.CLIENT_MASTER, { status: S.CLOSED, requesterId: 'client_master-1' });
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it('mesa sem pausa de SLA e agente fora da lista da mesa listada refletem na lista', async () => {
      expect(
        await statuses(Role.AGENT, { serviceDesk: deskFor({ agents: [{ id: 'agent-1' }], allowPauseResumeSla: false }) }),
      ).toEqual([S.RESOLVED, S.PENDING_APPROVAL, S.ESCALATED]);
      expect(
        await statuses(Role.AGENT, { serviceDesk: deskFor({ listedGroupsOnly: true, allowCrossDeskInteraction: true }) }),
      ).toEqual([]);
    });
  });

  describe('listagem: contato do solicitante (telefone e ramal)', () => {
    const requesterSelect = async (role: Role) => {
      prisma.ticket.findMany.mockClear();
      await service.findAll({} as never, user(role));
      return prisma.ticket.findMany.mock.calls[0][0].include.requester.select;
    };

    it.each([Role.ADMIN, Role.AGENT_MASTER, Role.AGENT])('%s recebe phone e extension', async (role) => {
      const select = await requesterSelect(role);
      expect(select).toMatchObject({ phone: true, extension: true, id: true, name: true, email: true });
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it.each([Role.CLIENT_MASTER, Role.CLIENT])('%s não recebe phone nem extension', async (role) => {
      const select = await requesterSelect(role);
      expect(select.phone).toBeUndefined();
      expect(select.extension).toBeUndefined();
      expect(select).toMatchObject({ id: true, name: true, email: true });
    });

    it('o caminho dos vencidos usa a mesma regra de contato', async () => {
      for (const role of [Role.ADMIN, Role.CLIENT]) {
        prisma.ticket.findMany.mockClear();
        await service.findAll({ overdue: 'true' } as never, user(role));
        const select = prisma.ticket.findMany.mock.calls[0][0].include.requester.select;
        expect(select.phone === true).toBe(role === Role.ADMIN);
      }
    });

    it('o recorte de visibilidade da listagem vem por perfil', async () => {
      const whereOf = async (u: CurrentUserPayload) => {
        prisma.ticket.findMany.mockClear();
        await service.findAll({} as never, u);
        return prisma.ticket.findMany.mock.calls[0][0].where;
      };
      expect(await whereOf(user(Role.ADMIN))).toEqual({});
      expect(await whereOf(user(Role.CLIENT))).toEqual({ requesterId: 'client-1' });
      expect(await whereOf(user(Role.CLIENT_MASTER, { organizationId: 'org-a' }))).toMatchObject({
        requester: { organizationId: 'org-a' },
      });
      for (const role of [Role.AGENT, Role.AGENT_MASTER]) {
        expect(await whereOf(user(role))).toMatchObject({ serviceDesk: { OR: expect.any(Array) } });
      }
    });
  });
});
