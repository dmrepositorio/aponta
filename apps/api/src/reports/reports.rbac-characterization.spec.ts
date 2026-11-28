import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { CommercialReportsService } from './commercial-reports.service';

/**
 * Caracterização por perfil (#527, Fase 0b-3 do tracker #523): trava o comportamento
 * ATUAL de relatórios por Role. Nenhum teste aqui muda código de produção; o que
 * parecer defeito está marcado como CARACTERIZAÇÃO e é decidido no #523.
 */
const ORG = 'org-own';

const actors = {
  admin: { id: 'u-admin', role: Role.ADMIN },
  agentMaster: { id: 'u-agent-master', role: Role.AGENT_MASTER },
  agent: { id: 'u-agent', role: Role.AGENT },
  clientMaster: { id: 'u-client-master', role: Role.CLIENT_MASTER, organizationId: ORG },
  clientMasterNoOrg: { id: 'u-client-master-2', role: Role.CLIENT_MASTER },
  client: { id: 'u-client', role: Role.CLIENT },
};

describe('ReportsService: matriz por perfil (caracterização)', () => {
  let prisma: any;
  let canViewTicketValues: jest.Mock;
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      worklog: { findMany: jest.fn().mockResolvedValue([]) },
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      serviceDesk: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    canViewTicketValues = jest.fn().mockResolvedValue(true);
    service = new ReportsService(prisma, { canViewTicketValues } as any, { isRbacPermissionOnly: () => false } as any);
  });

  describe('getWorkload: só Role.AGENT é restrito ao próprio relatório (reports.service.ts:30)', () => {
    it('AGENT: força authorId do próprio usuário mesmo pedindo outro agente', async () => {
      await service.getWorkload(actors.agent, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-agent');
    });

    it('AGENT: sem alvo informado, também filtra pelo próprio id', async () => {
      await service.getWorkload(actors.agent);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-agent');
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('AGENT_MASTER: NÃO é restrito ao próprio relatório; usa o alvo pedido', async () => {
      await service.getWorkload(actors.agentMaster, 'u-outro');
      expect(prisma.worklog.findMany.mock.calls[0][0].where.authorId).toBe('u-outro');
    });

    // CARACTERIZAÇÃO: comportamento atual, pode ser defeito (ver #523)
    it('AGENT_MASTER: sem alvo informado, não filtra por autor (vê todos da mesa)', async () => {
      await service.getWorkload(actors.agentMaster);
      expect(prisma.worklog.findMany.mock.calls[0][0].where).not.toHaveProperty('authorId');
    });

    it('ADMIN: sem filtro de tenant e com o alvo pedido', async () => {
      await service.getWorkload(actors.admin, 'u-outro');
      const where = prisma.worklog.findMany.mock.calls[0][0].where;
      expect(where.ticket).toEqual({});
      expect(where.authorId).toBe('u-outro');
    });

    it('AGENT/AGENT_MASTER: escopo de mesa vem do TenantHelper (agentes da mesa ou cross-desk)', async () => {
      await service.getWorkload(actors.agent);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({
        serviceDesk: {
          OR: [
            { agents: { some: { id: 'u-agent' } } },
            { agentGroups: { some: { members: { some: { id: 'u-agent' } } } } },
            { allowCrossDeskInteraction: true },
          ],
        },
      });
    });

    it('CLIENT: escopo restrito aos chamados que ele abriu', async () => {
      await service.getWorkload(actors.client);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({ requesterId: 'u-client' });
    });

    it('CLIENT_MASTER com organização: escopo da organização; sem organização: só os próprios chamados', async () => {
      await service.getWorkload(actors.clientMaster);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({ requester: { organizationId: ORG } });
      await service.getWorkload(actors.clientMasterNoOrg);
      expect(prisma.worklog.findMany.mock.calls[1][0].where.ticket).toEqual({ requesterId: 'u-client-master-2' });
    });

    it('papel fora do mapa (fail-closed): 403 antes de ler apontamentos', async () => {
      await expect(service.getWorkload({ id: 'x', role: 'UNKNOWN' as Role })).rejects.toThrow(ForbiddenException);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it('apontamentos anulados ficam fora do relatório para todos', async () => {
      await service.getWorkload(actors.admin);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.voidedAt).toBeNull();
    });
  });

  describe('getBilling: ADMIN e CLIENT_MASTER com organização (reports.service.ts:63)', () => {
    it.each([
      ['AGENT', actors.agent],
      ['AGENT_MASTER', actors.agentMaster],
      ['CLIENT', actors.client],
      ['CLIENT_MASTER sem organização', actors.clientMasterNoOrg],
    ])('%s: 403 antes de checar permissão ou ler apontamentos', async (_label, user) => {
      await expect(service.getBilling(user)).rejects.toThrow(ForbiddenException);
      expect(canViewTicketValues).not.toHaveBeenCalled();
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['ADMIN', actors.admin],
      ['CLIENT_MASTER', actors.clientMaster],
    ])('%s: 403 sem a permissão VIEW_TICKET_VALUES, antes de ler apontamentos', async (_label, user) => {
      canViewTicketValues.mockResolvedValue(false);
      await expect(service.getBilling(user)).rejects.toThrow(ForbiddenException);
      expect(canViewTicketValues).toHaveBeenCalledWith(user.id);
      expect(prisma.worklog.findMany).not.toHaveBeenCalled();
    });

    it('ADMIN com permissão: lê sem filtro de tenant', async () => {
      await service.getBilling(actors.admin);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
    });

    it('CLIENT_MASTER com permissão: lê no escopo da própria organização', async () => {
      await service.getBilling(actors.clientMaster);
      expect(prisma.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({ requester: { organizationId: ORG } });
    });

    it('CLIENT_MASTER: descarta linha cuja organização histórica (snapshot) é de outro cliente (reports.service.ts:96)', async () => {
      const row = (organizationId: string, minutes: number) => ({
        billable: true,
        minutes,
        startTime: new Date('2026-01-10T10:00:00Z'),
        valuationSnapshot: { organizationId, organizationName: organizationId },
        ticket: { requester: { organization: { id: ORG, name: 'Atual' } } },
      });
      prisma.worklog.findMany.mockResolvedValue([row(ORG, 30), row('org-antiga', 90)]);

      const res = await service.getBilling(actors.clientMaster);

      expect(res.map((r) => [r.organizationId, r.billableMinutes])).toEqual([[ORG, 30]]);
    });

    it('ADMIN: mesma entrada enxerga as duas organizações (o descarte é só do CLIENT_MASTER)', async () => {
      const row = (organizationId: string, minutes: number) => ({
        billable: true,
        minutes,
        startTime: new Date('2026-01-10T10:00:00Z'),
        valuationSnapshot: { organizationId, organizationName: organizationId },
        ticket: { requester: { organization: { id: ORG, name: 'Atual' } } },
      });
      prisma.worklog.findMany.mockResolvedValue([row(ORG, 30), row('org-antiga', 90)]);

      const res = await service.getBilling(actors.admin);

      expect(res.map((r) => [r.organizationId, r.billableMinutes])).toEqual([
        ['org-antiga', 90],
        [ORG, 30],
      ]);
    });
  });

  describe('getResponseTimeComparison e getSummary: escopo por perfil e fail-closed', () => {
    it('CLIENT é aceito e fica no escopo dos próprios chamados', async () => {
      await service.getResponseTimeComparison(actors.client, new Date('2026-11-20T12:00:00Z'));
      expect(prisma.ticket.findMany.mock.calls[0][0].where).toMatchObject({ requesterId: 'u-client' });
    });

    it('papel fora do mapa: 403 em getResponseTimeComparison e getSummary', async () => {
      const ghost = { id: 'x', role: 'UNKNOWN' as Role };
      await expect(service.getResponseTimeComparison(ghost)).rejects.toThrow(ForbiddenException);
      await expect(service.getSummary(ghost)).rejects.toThrow(ForbiddenException);
      expect(prisma.ticket.findMany).not.toHaveBeenCalled();
    });

    it('getSummary: a lista de agentes do dashboard só considera AGENT, AGENT_MASTER e ADMIN (reports.service.ts:510)', async () => {
      await service.getSummary(actors.admin);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        role: { in: [Role.AGENT, Role.AGENT_MASTER, Role.ADMIN] },
      });
    });

    it('getSummary: "todos os compromissos" segue o escopo de agenda do perfil; "meus" é sempre do usuário', async () => {
      await service.getSummary(actors.agentMaster);
      const calls = prisma.appointment.findMany.mock.calls.map((c: any[]) => c[0].where);
      expect(calls).toEqual([{ userId: 'u-agent-master' }, { userId: 'u-agent-master' }]);

      prisma.appointment.findMany.mockClear();
      await service.getSummary(actors.clientMaster);
      const cm = prisma.appointment.findMany.mock.calls.map((c: any[]) => c[0].where);
      expect(cm[0]).toEqual({ userId: 'u-client-master' });
      expect(cm[1]).toMatchObject({ organizationId: ORG, type: { not: 'ABSENCE' } });
    });
  });
});

describe('CommercialReportsService: ADMIN-only (commercial-reports.service.ts:29)', () => {
  let db: any;
  let canViewTicketValues: jest.Mock;
  let service: CommercialReportsService;

  beforeEach(() => {
    db = { contract: { findMany: jest.fn().mockResolvedValue([]) }, worklog: { findMany: jest.fn().mockResolvedValue([]) } };
    canViewTicketValues = jest.fn().mockResolvedValue(true);
    service = new CommercialReportsService(db, { canViewTicketValues } as any, { isRbacPermissionOnly: () => false } as any);
  });

  it.each([
    ['AGENT_MASTER', actors.agentMaster],
    ['AGENT', actors.agent],
    ['CLIENT_MASTER', actors.clientMaster],
    ['CLIENT', actors.client],
  ])('%s: 403 sem sequer consultar a permissão de valores nem os contratos', async (_label, user) => {
    await expect(service.getCommercial(user)).rejects.toThrow(ForbiddenException);
    expect(canViewTicketValues).not.toHaveBeenCalled();
    expect(db.contract.findMany).not.toHaveBeenCalled();
  });

  it('ADMIN sem VIEW_TICKET_VALUES: 403 antes de ler contratos', async () => {
    canViewTicketValues.mockResolvedValue(false);
    await expect(service.getCommercial(actors.admin)).rejects.toThrow(ForbiddenException);
    expect(canViewTicketValues).toHaveBeenCalledWith('u-admin');
    expect(db.contract.findMany).not.toHaveBeenCalled();
  });

  it('ADMIN com permissão: lê contratos e apontamentos sem filtro de tenant', async () => {
    db.contract.findMany.mockResolvedValue([
      {
        id: 'c1', name: 'C', organizationId: 'o', organization: { name: 'Empresa' }, type: 'HOURLY',
        terms: [], lifecycleEvents: [], hourlyRateCents: 100,
      },
    ]);
    await service.getCommercial(actors.admin, { month: '2026-09' });
    expect(db.contract.findMany).toHaveBeenCalledTimes(1);
    expect(db.worklog.findMany.mock.calls[0][0].where.ticket).toEqual({});
  });

  it('ADMIN: competência inválida é 400 (não 403) e nada é lido', async () => {
    await expect(service.getCommercial(actors.admin, { month: '2026-13' })).rejects.toMatchObject({ status: 400 });
    expect(db.contract.findMany).not.toHaveBeenCalled();
  });

  it('ordem das checagens: não-ADMIN com competência inválida recebe 403, não 400', async () => {
    await expect(service.getCommercial(actors.agent, { month: 'foo' })).rejects.toMatchObject({ status: 403 });
  });
});
