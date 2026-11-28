import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, ValuationType } from '@prisma/client';
import { WorklogsService } from './worklogs.service';
import type { CurrentUserPayload } from '../tickets/decorators/current-user.decorator';

/**
 * Fase 0b-2 (#526), tracker #523: caracterização por perfil do WorklogsService
 * (quem opera apontamentos, lançar para outro autor, garantia, bonificação,
 * valor manual, empresa comercial, remover/editar alheio e auditoria).
 * Trava o comportamento ATUAL; o harness é local a este spec.
 */
const ALL_ROLES: Role[] = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT];
const TECH_ROLES: Role[] = [Role.ADMIN, Role.AGENT_MASTER, Role.AGENT];
const NON_TECH_ROLES: Role[] = [Role.CLIENT_MASTER, Role.CLIENT];
const user = (role: Role, extra: Partial<CurrentUserPayload> = {}): CurrentUserPayload => ({
  id: `${role.toLowerCase()}-1`,
  role,
  ...extra,
});

describe('WorklogsService: matriz por perfil (caracterização)', () => {
  const dto = {
    startTime: '2026-10-17T12:00:00Z',
    endTime: '2026-10-17T13:00:00Z',
    description: 'Trabalho',
    contractId: 'contract',
  };
  const term = {
    id: 'term',
    approved: true,
    active: true,
    effectiveFrom: new Date('2026-10-01T00:00:00Z'),
    type: 'HOURLY',
    serviceDeskIds: ['desk'],
    hourlyRateCents: 15000,
    includedMinutes: null,
    excessHourlyRateCents: null,
    monthlyFeeCents: null,
    fixedPriceCents: null,
    estimatedMinutes: null,
  };
  const contract = {
    id: 'contract',
    organizationId: 'org',
    approved: true,
    active: true,
    type: 'HOURLY',
    name: 'Avulso',
    startsAt: new Date('2026-01-01'),
    endsAt: null,
    serviceDesks: [{ id: 'desk' }],
    terms: [term],
    includedMinutes: null,
    hoursLimit: null,
    excessHourlyRateCents: 9900,
    lifecycleEvents: [
      { approved: true, active: true, startsAt: new Date('2026-01-01'), endsAt: null, effectiveFrom: new Date('2026-01-01') },
    ],
  };
  const baseTicket = {
    id: 'ticket',
    serviceDeskId: 'desk',
    commercialOrganizationId: 'org',
    commercialOrganization: { id: 'org', name: 'Cliente' },
    requester: { organizationId: 'org', organization: { id: 'org', name: 'Cliente' } },
    serviceDesk: { listedGroupsOnly: false, agents: [], agentGroups: [] },
  };

  let db: any;
  let service: WorklogsService;
  let permissions: { canViewTicketValues: jest.Mock; canEditWorklogStartTime: jest.Mock; hasPermission: jest.Mock };
  let approvals: { notifyPending: jest.Mock };

  beforeEach(() => {
    db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((fn: any) => fn(db)),
      ticket: { findUnique: jest.fn().mockResolvedValue(baseTicket), update: jest.fn() },
      user: { findUnique: jest.fn() },
      serviceDesk: { findFirst: jest.fn().mockResolvedValue({ id: 'desk' }) },
      contract: {
        findMany: jest.fn().mockResolvedValue([contract]),
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
      },
      technicianCostRate: {
        findMany: jest.fn().mockResolvedValue([{ id: 'cost', effectiveFrom: new Date('2026-01-01'), hourlyCostCents: 10000 }]),
      },
      worklog: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'log', ...data })),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: 'log', ...data })),
        delete: jest.fn().mockResolvedValue({ id: 'log' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: 0 } }),
      },
      preAppointment: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'timer', ...data })),
        delete: jest.fn().mockResolvedValue({ id: 'timer' }),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: 'timer', ...data })),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    permissions = {
      canViewTicketValues: jest.fn().mockResolvedValue(true),
      canEditWorklogStartTime: jest.fn().mockResolvedValue(true),
      hasPermission: jest.fn().mockResolvedValue(true),
    };
    approvals = { notifyPending: jest.fn().mockResolvedValue(undefined) };
    service = new WorklogsService(
      db,
      {} as any,
      {} as any,
      permissions as any,
      { isEnabled: jest.fn().mockReturnValue(false), isRbacPermissionOnly: jest.fn().mockReturnValue(false) } as any,
      approvals as any,
    );
  });

  describe('create: quem opera apontamentos', () => {
    it('chamado fora do recorte do perfil (não encontrado) é NotFound antes de qualquer checagem de papel', async () => {
      db.ticket.findUnique.mockResolvedValue(null);
      for (const role of ALL_ROLES) {
        await expect(service.create('ticket', dto, user(role))).rejects.toThrow(NotFoundException);
      }
    });

    it.each(NON_TECH_ROLES)('%s recebe Forbidden e nada é gravado', async (role) => {
      await expect(service.create('ticket', dto, user(role))).rejects.toThrow(ForbiddenException);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it.each(TECH_ROLES)('%s lança apontamento para si, com autor e minutos derivados', async (role) => {
      const result = await service.create('ticket', dto, user(role));
      expect(db.worklog.create.mock.calls[0][0].data).toMatchObject({
        authorId: user(role).id,
        minutes: 60,
        ticketId: 'ticket',
        valuationType: ValuationType.CONTRACT,
        billable: true,
      });
      expect(result).toMatchObject({ authorId: user(role).id });
    });

    it('a busca do chamado aplica o recorte de tenant do perfil', async () => {
      await service.create('ticket', dto, user(Role.ADMIN));
      expect(db.ticket.findUnique.mock.calls[0][0].where).toMatchObject({ id: 'ticket', AND: [{}] });
      db.ticket.findUnique.mockClear();
      await service.create('ticket', dto, user(Role.AGENT));
      expect(db.ticket.findUnique.mock.calls[0][0].where.AND[0]).toMatchObject({ serviceDesk: { OR: expect.any(Array) } });
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s fora da lista de mesa listada recebe Forbidden', async (role) => {
      db.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        serviceDesk: { listedGroupsOnly: true, agents: [], agentGroups: [] },
      });
      await expect(service.create('ticket', dto, user(role))).rejects.toThrow(/vinculados a esta mesa/);
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it('ADMIN fora da lista de mesa listada lança; agente listado também', async () => {
      const listed = (id: string) => ({
        ...baseTicket,
        serviceDesk: { listedGroupsOnly: true, agents: [{ id }], agentGroups: [] },
      });
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, serviceDesk: { listedGroupsOnly: true, agents: [], agentGroups: [] } });
      await expect(service.create('ticket', dto, user(Role.ADMIN))).resolves.toBeDefined();
      db.ticket.findUnique.mockResolvedValue(listed('agent_master-1'));
      await expect(service.create('ticket', dto, user(Role.AGENT_MASTER))).resolves.toBeDefined();
    });
  });

  describe('create: lançar para outro autor', () => {
    it('ADMIN lança para outro técnico: o autor é o técnico e o admin fica como quem registrou', async () => {
      db.user.findUnique.mockResolvedValue({ id: 'tech-2', role: Role.AGENT });
      const result = await service.create('ticket', { ...dto, authorId: 'tech-2' }, user(Role.ADMIN));
      expect(db.worklog.create.mock.calls[0][0].data.authorId).toBe('tech-2');
      expect(result.valuationSnapshot).toMatchObject({ recordedById: 'admin-1', performedById: 'tech-2' });
    });

    it.each([Role.ADMIN, Role.AGENT, Role.AGENT_MASTER])('ADMIN aceita autor %s', async (targetRole) => {
      db.user.findUnique.mockResolvedValue({ id: 'tech-2', role: targetRole });
      await expect(service.create('ticket', { ...dto, authorId: 'tech-2' }, user(Role.ADMIN))).resolves.toBeDefined();
    });

    it.each(NON_TECH_ROLES)('ADMIN não lança para autor %s (BadRequest)', async (targetRole) => {
      db.user.findUnique.mockResolvedValue({ id: 'u-2', role: targetRole });
      await expect(service.create('ticket', { ...dto, authorId: 'u-2' }, user(Role.ADMIN))).rejects.toThrow(
        BadRequestException,
      );
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it('ADMIN com autor inexistente recebe NotFound', async () => {
      db.user.findUnique.mockResolvedValue(null);
      await expect(service.create('ticket', { ...dto, authorId: 'ghost' }, user(Role.ADMIN))).rejects.toThrow(NotFoundException);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s não lança para outro autor (Forbidden), nem consulta o usuário', async (role) => {
      await expect(service.create('ticket', { ...dto, authorId: 'tech-2' }, user(role))).rejects.toThrow(ForbiddenException);
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s informando o próprio id como autor passa', async (role) => {
      await service.create('ticket', { ...dto, authorId: user(role).id }, user(role));
      expect(db.worklog.create.mock.calls[0][0].data.authorId).toBe(user(role).id);
    });
  });

  describe('create: garantia, bonificação, valor manual e faturável', () => {
    const guarantee = { ...dto, valuationType: ValuationType.GUARANTEE, bonusReason: 'Retrabalho' };
    const bonus = { ...dto, valuationType: ValuationType.BONUS, bonusReason: 'Cortesia' };
    const manual = { ...dto, valuationType: ValuationType.MANUAL, value: 50 };

    it('garantia: ADMIN lança sem consultar a permissão LAUNCH_WORKLOG_GUARANTEE', async () => {
      permissions.hasPermission.mockResolvedValue(false);
      const result = await service.create('ticket', guarantee, user(Role.ADMIN));
      expect(result).toMatchObject({ valuationType: ValuationType.GUARANTEE, billable: false, valueCents: 0 });
      expect(permissions.hasPermission).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('garantia: %s sem a permissão recebe Forbidden', async (role) => {
      permissions.hasPermission.mockResolvedValue(false);
      await expect(service.create('ticket', guarantee, user(role))).rejects.toThrow(/garantia/i);
      expect(permissions.hasPermission).toHaveBeenCalledWith(user(role).id, 'LAUNCH_WORKLOG_GUARANTEE');
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('garantia: %s com a permissão lança', async (role) => {
      const result = await service.create('ticket', guarantee, user(role));
      expect(result).toMatchObject({ valuationType: ValuationType.GUARANTEE, billable: false });
    });

    it('garantia é 403 mesmo quando billable=true (a permissão vem antes da validação)', async () => {
      permissions.hasPermission.mockResolvedValue(false);
      await expect(service.create('ticket', { ...guarantee, billable: true }, user(Role.AGENT))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('garantia e bonificação não podem ser faturáveis nem ficar sem motivo (todos os perfis técnicos)', async () => {
      for (const role of TECH_ROLES) {
        await expect(service.create('ticket', { ...guarantee, billable: true }, user(role))).rejects.toThrow(
          /faturável/i,
        );
        await expect(
          service.create('ticket', { ...guarantee, bonusReason: '   ' }, user(role)),
        ).rejects.toThrow(/motivo/i);
      }
    });

    it('bonificação: só ADMIN autoriza', async () => {
      const result = await service.create('ticket', bonus, user(Role.ADMIN));
      expect(result).toMatchObject({ valuationType: ValuationType.BONUS, billable: false, valueCents: 0 });
      expect(result.valuationSnapshot).toMatchObject({ authorizedById: 'admin-1' });
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('bonificação: %s recebe Forbidden, mesmo com a permissão de garantia', async (role) => {
      await expect(service.create('ticket', bonus, user(role))).rejects.toThrow(/admin/i);
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it('valor manual: ADMIN com permissão de ver valores grava o valor informado', async () => {
      const result = await service.create('ticket', manual, user(Role.ADMIN));
      expect(result).toMatchObject({ valuationType: ValuationType.MANUAL, valueCents: 5000 });
    });

    it('valor manual: ADMIN sem permissão de ver valores recebe Forbidden', async () => {
      permissions.canViewTicketValues.mockResolvedValue(false);
      await expect(service.create('ticket', manual, user(Role.ADMIN))).rejects.toThrow(ForbiddenException);
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('valor manual: %s recebe Forbidden mesmo vendo valores', async (role) => {
      await expect(service.create('ticket', manual, user(role))).rejects.toThrow(/valor manual/i);
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it('valor manual inválido (negativo, ausente ou positivo sem faturar) é BadRequest', async () => {
      const admin = user(Role.ADMIN);
      await expect(service.create('ticket', { ...manual, value: -1 }, admin)).rejects.toThrow(BadRequestException);
      await expect(service.create('ticket', { ...manual, value: undefined }, admin)).rejects.toThrow(BadRequestException);
      await expect(service.create('ticket', { ...manual, billable: false }, admin)).rejects.toThrow(BadRequestException);
    });

    it('CONTRACT não faturável é recusado para todos os perfis técnicos (sem atalho via billable=false)', async () => {
      for (const role of TECH_ROLES) {
        await expect(service.create('ticket', { ...dto, billable: false }, user(role))).rejects.toThrow(/Garantia ou Bonificação/);
      }
    });
  });

  describe('create: empresa comercial', () => {
    it.each(TECH_ROLES)('%s: chamado sem empresa comercial é BadRequest e nada é gravado', async (role) => {
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, commercialOrganizationId: null });
      await expect(service.create('ticket', dto, user(role))).rejects.toThrow(/empresa comercial/);
      expect(db.worklog.create).not.toHaveBeenCalled();
    });

    it('empresa comercial sem vínculo com a mesa ativa é BadRequest', async () => {
      db.serviceDesk.findFirst.mockResolvedValue(null);
      await expect(service.create('ticket', dto, user(Role.AGENT))).rejects.toThrow(/mesa/);
    });

    it('setCommercialOrganization: só ADMIN regulariza', async () => {
      db.ticket.update.mockResolvedValue({ commercialOrganizationId: 'new-org' });
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, commercialOrganizationId: 'org' });
      await expect(service.setCommercialOrganization('ticket', 'new-org', user(Role.ADMIN))).resolves.toMatchObject({
        commercialOrganizationId: 'new-org',
      });
      for (const role of [Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT]) {
        db.$transaction.mockClear();
        await expect(service.setCommercialOrganization('ticket', 'new-org', user(role))).rejects.toThrow(ForbiddenException);
        expect(db.$transaction).not.toHaveBeenCalled();
      }
    });

    it('setCommercialOrganization: com apontamentos o ADMIN também é barrado', async () => {
      db.ticket.findUnique.mockResolvedValue({ ...baseTicket, commercialOrganizationId: 'org' });
      db.worklog.count.mockResolvedValue(2);
      await expect(service.setCommercialOrganization('ticket', 'other', user(Role.ADMIN))).rejects.toThrow(/apontamentos/);
    });
  });

  describe('findByTicket e eligibleContracts: quem lê', () => {
    it.each(NON_TECH_ROLES)('%s não lista apontamentos (Forbidden)', async (role) => {
      await expect(service.findByTicket('ticket', user(role))).rejects.toThrow(ForbiddenException);
      expect(db.worklog.findMany).not.toHaveBeenCalled();
    });

    it.each(TECH_ROLES)('%s lista apontamentos não anulados', async (role) => {
      await service.findByTicket('ticket', user(role));
      expect(db.worklog.findMany.mock.calls[0][0].where).toEqual({ ticketId: 'ticket', voidedAt: null });
    });

    it.each(TECH_ROLES)('%s sem VIEW_TICKET_VALUES recebe valores e motivo mascarados', async (role) => {
      permissions.canViewTicketValues.mockResolvedValue(false);
      db.worklog.findMany.mockResolvedValue([
        { id: 'w', value: 10, valueCents: 1000, costCents: 500, bonusReason: 'x', valuationSnapshot: { timeConvention: 'UTC' } },
      ]);
      const [row] = await service.findByTicket('ticket', user(role));
      expect(row).toMatchObject({ value: null, valueCents: null, costCents: null, bonusReason: null, valuationSnapshot: null });
    });

    it('a visibilidade depende da permissão, não do papel (ADMIN com e sem valores)', async () => {
      db.worklog.findMany.mockResolvedValue([{ id: 'w', value: 10, valueCents: 1000, costCents: 500, valuationSnapshot: null }]);
      const [withValues] = await service.findByTicket('ticket', user(Role.ADMIN));
      expect(withValues).toMatchObject({ valueCents: 1000, costCents: 500 });
    });

    it('chamado fora do recorte é NotFound para todos os perfis', async () => {
      db.ticket.findUnique.mockResolvedValue(null);
      for (const role of ALL_ROLES) {
        await expect(service.findByTicket('ticket', user(role))).rejects.toThrow(NotFoundException);
      }
    });

    it.each(NON_TECH_ROLES)('eligibleContracts: %s recebe Forbidden', async (role) => {
      await expect(service.eligibleContracts('ticket', dto.startTime, dto.endTime, user(role))).rejects.toThrow(ForbiddenException);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('eligibleContracts: a tarifa de excesso só vai para ADMIN com VIEW_TICKET_VALUES', async () => {
      const rate = async (role: Role, canView: boolean) => {
        permissions.canViewTicketValues.mockResolvedValue(canView);
        const [row] = await service.eligibleContracts('ticket', dto.startTime, dto.endTime, user(role));
        return row.excessHourlyRateCents;
      };
      expect(await rate(Role.ADMIN, true)).toBe(9900);
      expect(await rate(Role.ADMIN, false)).toBeNull();
      expect(await rate(Role.AGENT_MASTER, true)).toBeNull();
      expect(await rate(Role.AGENT, true)).toBeNull();
    });

    it('eligibleContracts rejeita intervalo inválido', async () => {
      await expect(service.eligibleContracts('ticket', dto.endTime, dto.startTime, user(Role.ADMIN))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('delete: remover apontamento alheio', () => {
    const owned = (authorId: string, extra: Record<string, unknown> = {}) => ({
      id: 'log',
      ticketId: 'ticket',
      authorId,
      contractId: null,
      voidedAt: null,
      valuationSnapshot: { version: 2 },
      ...extra,
    });

    it.each(NON_TECH_ROLES)('%s recebe Forbidden antes de buscar o apontamento', async (role) => {
      await expect(service.delete('ticket', 'log', user(role))).rejects.toThrow(ForbiddenException);
      expect(db.worklog.findUnique).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s remove o próprio apontamento', async (role) => {
      db.worklog.findUnique.mockResolvedValue(owned(user(role).id));
      await service.delete('ticket', 'log', user(role));
      expect(db.worklog.update).toHaveBeenCalledTimes(1);
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s não remove apontamento de outro (Forbidden), sem alterar nada', async (role) => {
      db.worklog.findUnique.mockResolvedValue(owned('someone-else'));
      await expect(service.delete('ticket', 'log', user(role))).rejects.toThrow(/outro usuário/);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.worklog.update).not.toHaveBeenCalled();
      expect(db.worklog.delete).not.toHaveBeenCalled();
    });

    it('ADMIN remove apontamento de qualquer autor', async () => {
      db.worklog.findUnique.mockResolvedValue(owned('someone-else'));
      await service.delete('ticket', 'log', user(Role.ADMIN));
      expect(db.worklog.update).toHaveBeenCalledTimes(1);
    });

    it('o apontamento versão 2 é anulado (voidedAt/voidedBy) e o legado é apagado', async () => {
      db.worklog.findUnique.mockResolvedValue(owned('agent-1'));
      await service.delete('ticket', 'log', user(Role.AGENT));
      expect(db.worklog.update.mock.calls[0][0].data).toMatchObject({ voidedBy: 'agent-1', voidedAt: expect.any(Date) });
      expect(db.worklog.delete).not.toHaveBeenCalled();
      db.worklog.update.mockClear();
      db.worklog.findUnique.mockResolvedValue(owned('agent-1', { valuationSnapshot: null }));
      await service.delete('ticket', 'log', user(Role.AGENT));
      expect(db.worklog.delete).toHaveBeenCalledTimes(1);
      expect(db.worklog.update).not.toHaveBeenCalled();
    });

    it('apontamento de outro chamado ou inexistente é NotFound', async () => {
      db.worklog.findUnique.mockResolvedValue(owned('agent-1', { ticketId: 'other-ticket' }));
      await expect(service.delete('ticket', 'log', user(Role.ADMIN))).rejects.toThrow(NotFoundException);
      db.worklog.findUnique.mockResolvedValue(null);
      await expect(service.delete('ticket', 'log', user(Role.ADMIN))).rejects.toThrow(NotFoundException);
    });

    it('o apontamento já anulado não é anulado de novo (autor e hora originais ficam)', async () => {
      db.worklog.findUnique.mockResolvedValue(owned('agent-1', { voidedAt: new Date(), voidedBy: 'agent-1' }));
      await service.delete('ticket', 'log', user(Role.ADMIN));
      expect(db.worklog.update).not.toHaveBeenCalled();
    });
  });

  describe('editar apontamento alheio: não existe operação de edição', () => {
    it('o serviço não expõe update de apontamento (só criar, listar, remover e auditar)', () => {
      const methods = Object.getOwnPropertyNames(WorklogsService.prototype);
      expect(methods).not.toEqual(expect.arrayContaining(['update']));
      expect(methods.filter((name) => /^(update|edit)(?!.*Pre)/i.test(name))).toEqual([]);
    });
  });

  describe('auditByTicket: auditoria financeira', () => {
    it('ADMIN com VIEW_TICKET_VALUES recebe todos os apontamentos, inclusive anulados', async () => {
      db.worklog.findMany.mockResolvedValue([{ id: 'a' }]);
      await expect(service.auditByTicket('ticket', user(Role.ADMIN))).resolves.toEqual([{ id: 'a' }]);
      expect(db.worklog.findMany.mock.calls[0][0].where).toEqual({ ticketId: 'ticket' });
    });

    it('ADMIN sem VIEW_TICKET_VALUES recebe Forbidden', async () => {
      permissions.canViewTicketValues.mockResolvedValue(false);
      await expect(service.auditByTicket('ticket', user(Role.ADMIN))).rejects.toThrow(ForbiddenException);
    });

    it.each([Role.AGENT_MASTER, Role.AGENT, Role.CLIENT_MASTER, Role.CLIENT])(
      '%s recebe Forbidden mesmo com VIEW_TICKET_VALUES',
      async (role) => {
        await expect(service.auditByTicket('ticket', user(role))).rejects.toThrow(ForbiddenException);
        expect(db.worklog.findMany).not.toHaveBeenCalled();
      },
    );

    it('chamado inexistente é NotFound para o ADMIN autorizado', async () => {
      db.ticket.findUnique.mockResolvedValue(null);
      await expect(service.auditByTicket('ticket', user(Role.ADMIN))).rejects.toThrow(NotFoundException);
    });
  });

  describe('pré-apontamentos (cronômetro) por perfil', () => {
    const timer = (authorId: string, extra: Record<string, unknown> = {}) => ({
      id: 'timer',
      ticketId: 'ticket',
      authorId,
      beginning: new Date('2026-10-17T12:00:00Z'),
      ending: null,
      pausedAt: null,
      pausedMs: 0,
      lockedReason: null,
      ...extra,
    });

    it.each(NON_TECH_ROLES)('%s não opera cronômetro (criar, listar, parar, pausar, retomar, remover)', async (role) => {
      const u = user(role);
      await expect(service.createPreAppointment('ticket', {}, u)).rejects.toThrow(ForbiddenException);
      await expect(service.findPreAppointments('ticket', u)).rejects.toThrow(ForbiddenException);
      await expect(service.stopPreAppointment('ticket', 'timer', {}, u)).rejects.toThrow(ForbiddenException);
      await expect(service.pausePreAppointment('ticket', 'timer', u)).rejects.toThrow(ForbiddenException);
      await expect(service.resumePreAppointment('ticket', 'timer', u)).rejects.toThrow(ForbiddenException);
      await expect(service.deletePreAppointment('ticket', 'timer', u)).rejects.toThrow(ForbiddenException);
      expect(db.preAppointment.create).not.toHaveBeenCalled();
      expect(db.preAppointment.update).not.toHaveBeenCalled();
      expect(db.preAppointment.delete).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s não mexe no cronômetro de outro autor (parar, pausar, retomar, remover)', async (role) => {
      const u = user(role);
      db.preAppointment.findUnique.mockResolvedValue(timer('someone-else', { pausedAt: new Date() }));
      await expect(service.stopPreAppointment('ticket', 'timer', {}, u)).rejects.toThrow(/outro usuário/);
      await expect(service.pausePreAppointment('ticket', 'timer', u)).rejects.toThrow(/outro usuário/);
      await expect(service.resumePreAppointment('ticket', 'timer', u)).rejects.toThrow(/outro usuário/);
      await expect(service.deletePreAppointment('ticket', 'timer', u)).rejects.toThrow(/outro usuário/);
      expect(db.preAppointment.update).not.toHaveBeenCalled();
      expect(db.preAppointment.delete).not.toHaveBeenCalled();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s opera o próprio cronômetro', async (role) => {
      const u = user(role);
      db.preAppointment.findUnique.mockResolvedValue(timer(u.id));
      await expect(service.pausePreAppointment('ticket', 'timer', u)).resolves.toBeDefined();
      await expect(service.deletePreAppointment('ticket', 'timer', u)).resolves.toBeDefined();
    });

    it('ADMIN opera o cronômetro de outro autor', async () => {
      const admin = user(Role.ADMIN);
      db.preAppointment.findUnique.mockResolvedValue(timer('someone-else'));
      await expect(service.pausePreAppointment('ticket', 'timer', admin)).resolves.toBeDefined();
      await expect(service.stopPreAppointment('ticket', 'timer', { ending: '2026-10-17T13:00:00Z' }, admin)).resolves.toBeDefined();
      await expect(service.deletePreAppointment('ticket', 'timer', admin)).resolves.toBeDefined();
    });

    it('o cronômetro encerrado pelo sistema só é removido por quem edita a hora inicial', async () => {
      db.preAppointment.findUnique.mockResolvedValue(timer('agent-1', { lockedReason: 'WINDOW_CLOSED' }));
      permissions.canEditWorklogStartTime.mockResolvedValue(false);
      await expect(service.deletePreAppointment('ticket', 'timer', user(Role.AGENT))).rejects.toThrow(/sistema/);
      await expect(service.deletePreAppointment('ticket', 'timer', user(Role.ADMIN))).rejects.toThrow(/sistema/);
      permissions.canEditWorklogStartTime.mockResolvedValue(true);
      await expect(service.deletePreAppointment('ticket', 'timer', user(Role.AGENT))).resolves.toBeDefined();
    });

    it.each([Role.AGENT, Role.AGENT_MASTER])('%s fora da lista de mesa listada não cria nem lista cronômetro', async (role) => {
      db.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        serviceDesk: { listedGroupsOnly: true, agents: [], agentGroups: [] },
      });
      await expect(service.createPreAppointment('ticket', {}, user(role))).rejects.toThrow(/vinculados a esta mesa/);
      await expect(service.findPreAppointments('ticket', user(role))).rejects.toThrow(/vinculados a esta mesa/);
    });
  });
});
